import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, Panel, StatusBadge, SuccessCallout } from '../components/Ui';

type ImportProvider = 'myges' | 'myefrei' | 'ensup' | 'generic';
type SourceTab = 'file' | 'url';
type DeleteEventsStrategy = 'none' | 'future' | 'all';
type WizardStep = 'load' | 'preview' | 'import';

interface IcsEventPreview {
  uid: string;
  title: string | null;
  startAt: string;
  endAt: string;
  teacher: string | null;
  room: string | null;
  campus: string | null;
  classes: string[];
  subject: string | null;
  modality: string | null;
  studentCount: number | null;
  status: string | null;
  eventDetectedProvider: string;
  eventDetectionConfidence: string;
  eventDetectionReason: string;
  isNoise: boolean;
}

interface IcsPreviewResult {
  fileDetection: { provider: string; confidence: string; reason: string };
  total: number;
  cancelledCount: number;
  noiseCount: number;
  events: IcsEventPreview[];
  providerBreakdown: Record<string, number>;
}

interface ImportRecord {
  id: string;
  name: string;
  sourceType: 'manual_upload' | 'manual_url';
  provider: string;
  detectedProvider: string | null;
  detectionConfidence: string | null;
  icsUrl: string | null;
  originalFilename: string | null;
  status: string;
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  duplicateCount: number;
  skippedCount: number;
  errorMessage: string | null;
  removedFutureCount: number;
  keptPastCount: number;
  importedAt: string;
  lastReimportAt: string | null;
}

interface ImportResult {
  import: ImportRecord;
  stats: {
    fetched: number;
    created: number;
    updated: number;
    duplicates: number;
    skipped: number;
    cancelled: number;
  };
  detectionResult: {
    detectedProvider: string | null;
    detectionConfidence: string | null;
    detectionReason: string | null;
  };
}

interface ReimportResult extends ImportResult {
  stats: ImportResult['stats'] & {
    removedFutureCount: number;
    keptPastCount: number;
  };
}

const PROVIDER_LABELS: Record<string, string> = {
  myges: 'MyGES',
  myefrei: 'myEfrei',
  ensup: 'Ensup (HyperPlanning)',
  generic: 'Autre / Inconnu',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Faible',
  none: 'Aucune',
};

const CONFIDENCE_TONE: Record<string, 'ok' | 'warn' | 'error' | 'muted'> = {
  high: 'ok',
  medium: 'warn',
  low: 'error',
  none: 'muted',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── Delete dialog ──────────────────────────────────────────────────────────

interface DeleteDialogProps {
  imp: ImportRecord;
  onConfirm: (strategy: DeleteEventsStrategy) => void;
  onCancel: () => void;
}

function DeleteDialog({ imp, onConfirm, onCancel }: DeleteDialogProps) {
  const [strategy, setStrategy] = useState<DeleteEventsStrategy>(
    imp.sourceType === 'manual_url' ? 'future' : 'none',
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--surface, #fff)', borderRadius: 8, padding: '1.5rem', maxWidth: 440, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <h3 style={{ marginTop: 0 }}>Supprimer l'import</h3>
        <p style={{ marginBottom: '1rem' }}>Que faire des événements liés à <strong>{imp.name}</strong> ?</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.25rem' }}>
          {[
            { value: 'none', label: 'Conserver tous les événements', desc: "Supprime uniquement la traçabilité de l'import." },
            { value: 'future', label: 'Supprimer les événements futurs exclusifs', desc: 'Événements passés et partagés conservés.' },
            { value: 'all', label: 'Supprimer tous les événements exclusifs', desc: 'Passés et futurs appartenant uniquement à cet import.' },
          ].map(({ value, label, desc }) => (
            <label key={value} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="radio" name="strategy" value={value} checked={strategy === value} onChange={() => setStrategy(value as DeleteEventsStrategy)} style={{ marginTop: '0.2rem' }} />
              <span><strong>{label}</strong><br /><span style={{ fontSize: '0.82rem', color: 'var(--muted, #888)' }}>{desc}</span></span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="button button-secondary" onClick={onCancel}>Annuler</button>
          <button className="button" style={{ background: 'var(--error, #a03a2e)', borderColor: 'var(--error, #a03a2e)' }} onClick={() => onConfirm(strategy)}>Supprimer</button>
        </div>
      </div>
    </div>
  );
}

// ─── Preview table ───────────────────────────────────────────────────────────

interface PreviewTableProps {
  events: IcsEventPreview[];
  hideNoise: boolean;
  filterProvider: string;
}

function PreviewTable({ events, hideNoise, filterProvider }: PreviewTableProps) {
  const visible = events.filter((ev) => {
    if (hideNoise && ev.isNoise) return false;
    if (filterProvider && ev.eventDetectedProvider !== filterProvider) return false;
    return true;
  });

  if (visible.length === 0) {
    return <p className="muted">Aucun événement à afficher avec ces filtres.</p>;
  }

  return (
    <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface, #fff)', zIndex: 1 }}>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--muted)' }}>Date</th>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--muted)' }}>Titre / Matière</th>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--muted)' }}>Enseignant</th>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--muted)' }}>Salle</th>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--muted)' }}>Classes</th>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--muted)' }}>Provider détecté</th>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--muted)' }}>Statut</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((ev) => (
            <tr
              key={ev.uid}
              style={{
                borderBottom: '1px solid var(--border)',
                background: ev.isNoise ? 'rgba(200,100,0,0.05)' : undefined,
                opacity: ev.isNoise ? 0.7 : 1,
              }}
            >
              <td style={{ padding: '0.3rem 0.5rem', whiteSpace: 'nowrap' }}>
                {formatDate(ev.startAt)}
                <br />
                <span style={{ color: 'var(--muted)' }}>
                  {new Date(ev.startAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  {' → '}
                  {new Date(ev.endAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </td>
              <td style={{ padding: '0.3rem 0.5rem', maxWidth: 220 }}>
                <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.title ?? '(sans titre)'}
                </strong>
                {ev.subject && ev.subject !== ev.title && (
                  <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{ev.subject}</span>
                )}
              </td>
              <td style={{ padding: '0.3rem 0.5rem', color: 'var(--muted)' }}>{ev.teacher ?? '—'}</td>
              <td style={{ padding: '0.3rem 0.5rem', color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ev.room ?? '—'}
              </td>
              <td style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
                {ev.classes.join(', ') || '—'}
              </td>
              <td style={{ padding: '0.3rem 0.5rem' }}>
                <StatusBadge tone={CONFIDENCE_TONE[ev.eventDetectionConfidence] ?? 'muted'}>
                  {PROVIDER_LABELS[ev.eventDetectedProvider] ?? ev.eventDetectedProvider}
                </StatusBadge>
                {ev.eventDetectionConfidence !== 'none' && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2 }}>
                    {CONFIDENCE_LABELS[ev.eventDetectionConfidence]}
                  </div>
                )}
              </td>
              <td style={{ padding: '0.3rem 0.5rem' }}>
                {ev.isNoise ? <StatusBadge tone="warn">Bruit</StatusBadge> : null}
                {ev.status === 'CANCELLED' ? <StatusBadge tone="error">Annulé</StatusBadge> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function ImportsPage() {
  // Wizard state
  const [step, setStep] = useState<WizardStep>('load');
  const [tab, setTab] = useState<SourceTab>('file');
  const [provider, setProvider] = useState<ImportProvider>('generic');
  const [name, setName] = useState('');
  const [icsUrl, setIcsUrl] = useState('');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview state
  const [preview, setPreview] = useState<IcsPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [hideNoise, setHideNoise] = useState(true);
  const [filterProvider, setFilterProvider] = useState('');

  // Import state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | ReimportResult | null>(null);

  // History
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ImportRecord | null>(null);

  useEffect(() => {
    void loadImports();
  }, []);

  async function loadImports() {
    setListLoading(true);
    try {
      const data = (await api.listImports()) as ImportRecord[];
      setImports(data);
    } catch {
      // silent
    } finally {
      setListLoading(false);
    }
  }

  function resetWizard() {
    setStep('load');
    setPreview(null);
    setFileContent(null);
    setFileName('');
    setName('');
    setIcsUrl('');
    setProvider('generic');
    setError(null);
    setSuccess(null);
    setResult(null);
    setFilterProvider('');
    setHideNoise(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    if (!name) setName(file.name.replace(/\.ics$/i, ''));
    setError(null);
    try {
      const text = await file.text();
      setFileContent(text);
    } catch {
      setError('Impossible de lire le fichier.');
    }
  }

  async function handlePreview() {
    setError(null);
    setPreviewing(true);
    try {
      let result: IcsPreviewResult;
      if (tab === 'file') {
        if (!fileContent) { setError('Veuillez sélectionner un fichier ICS.'); return; }
        result = (await api.previewIcsFile({ content: fileContent, fallbackProvider: provider })) as IcsPreviewResult;
      } else {
        if (!icsUrl) { setError('Veuillez saisir une URL ICS.'); return; }
        result = (await api.previewIcsUrl({ icsUrl, fallbackProvider: provider })) as IcsPreviewResult;
      }
      setPreview(result);
      // Auto-apply file-level detection as provider if confident
      if (result.fileDetection.confidence === 'high' || result.fileDetection.confidence === 'medium') {
        if (result.fileDetection.provider !== 'generic') {
          setProvider(result.fileDetection.provider as ImportProvider);
        }
      }
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la prévisualisation.');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    setError(null);
    setLoading(true);
    try {
      let importResult: ImportResult;
      const importName = name || `Import ICS — ${new Date().toLocaleDateString('fr-FR')}`;

      if (tab === 'file') {
        if (!fileContent) { setError('Contenu ICS manquant.'); return; }
        importResult = (await api.importIcsFile({
          content: fileContent,
          provider,
          name: importName,
          filename: fileName || undefined,
        })) as ImportResult;
      } else {
        importResult = (await api.importIcsUrl({
          icsUrl,
          provider,
          name: importName,
        })) as ImportResult;
      }

      setResult(importResult);
      setSuccess(
        `Import réussi : ${importResult.stats.created} créé(s), ${importResult.stats.updated} mis à jour, ${importResult.stats.duplicates} doublon(s).`,
      );
      await loadImports();
      setStep('import');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'import.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteConfirm(strategy: DeleteEventsStrategy) {
    if (!deleteTarget) return;
    const imp = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = (await api.deleteImport(imp.id, strategy)) as { removedEventCount: number };
      const msg = strategy === 'none'
        ? `Import "${imp.name}" supprimé.`
        : `Import "${imp.name}" supprimé — ${res.removedEventCount} événement(s) retiré(s).`;
      setSuccess(msg);
      await loadImports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur.');
    }
  }

  async function handleReimport(imp: ImportRecord) {
    setActionLoading(imp.id);
    setError(null);
    try {
      const res = (await api.reimportIcs(imp.id)) as ReimportResult;
      const parts = [
        `${res.stats.created} créé(s)`,
        `${res.stats.updated} mis à jour`,
        `${res.stats.duplicates} doublon(s)`,
      ];
      if (res.stats.removedFutureCount > 0) parts.push(`${res.stats.removedFutureCount} futur(s) supprimé(s)`);
      if (res.stats.keptPastCount > 0) parts.push(`${res.stats.keptPastCount} passé(s) conservé(s)`);
      setSuccess(`Réimport OK : ${parts.join(', ')}.`);
      await loadImports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de réimport.');
    } finally {
      setActionLoading(null);
    }
  }

  function isReimportResult(r: ImportResult | ReimportResult): r is ReimportResult {
    return 'removedFutureCount' in r.stats;
  }

  // Step breadcrumb
  const steps: { key: WizardStep; label: string }[] = [
    { key: 'load', label: '1. Charger' },
    { key: 'preview', label: '2. Prévisualiser' },
    { key: 'import', label: '3. Importer' },
  ];

  return (
    <div className="page-grid">
      {deleteTarget && (
        <DeleteDialog
          imp={deleteTarget}
          onConfirm={(strategy) => void handleDeleteConfirm(strategy)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <header className="page-header">
        <div>
          <p className="eyebrow">Calendriers externes</p>
          <h2>Import ICS</h2>
        </div>
      </header>

      {/* Step breadcrumb */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {steps.map(({ key, label }, i) => (
          <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {i > 0 && <span style={{ color: 'var(--muted)' }}>›</span>}
            <span
              style={{
                fontWeight: step === key ? 700 : 400,
                color: step === key ? 'var(--accent, #0066cc)' : 'var(--muted)',
                fontSize: '0.9rem',
              }}
            >
              {label}
            </span>
          </span>
        ))}
      </div>

      <ErrorCallout message={error} />
      <SuccessCallout message={success} />

      {/* ── Step 1: Load ─────────────────────────────────────────────────── */}
      {step === 'load' && (
        <Panel title="Charger un calendrier ICS">
          <div className="stats-inline" style={{ marginBottom: '1rem' }}>
            <button type="button" className={tab === 'file' ? 'button' : 'button button-secondary'} onClick={() => { setTab('file'); setError(null); }}>
              Fichier .ics
            </button>
            <button type="button" className={tab === 'url' ? 'button' : 'button button-secondary'} onClick={() => { setTab('url'); setError(null); }}>
              URL ICS
            </button>
          </div>

          {tab === 'url' && (
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Les imports par URL peuvent être resynchronisés — les événements futurs supprimés du flux seront retirés.
            </p>
          )}

          <div className="form-grid">
            {tab === 'file' ? (
              <label>
                Fichier ICS
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ics,text/calendar"
                  onChange={(e) => void handleFileChange(e)}
                  style={{ paddingTop: '0.4rem' }}
                />
              </label>
            ) : (
              <label>
                URL ICS
                <input type="url" value={icsUrl} placeholder="https://..." onChange={(e) => setIcsUrl(e.target.value)} />
              </label>
            )}
            <label>
              Nom de l'import (optionnel)
              <input type="text" value={name} placeholder="Mon agenda ENS…" onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Provider par défaut (si non détecté automatiquement)
              <select value={provider} onChange={(e) => setProvider(e.target.value as ImportProvider)}>
                <option value="myges">MyGES</option>
                <option value="myefrei">myEfrei</option>
                <option value="ensup">Ensup (HyperPlanning)</option>
                <option value="generic">Autre / Inconnu</option>
              </select>
            </label>
          </div>

          <div className="actions-row" style={{ marginTop: '1rem' }}>
            <button className="button" onClick={() => void handlePreview()} disabled={previewing}>
              {previewing ? 'Analyse en cours…' : 'Analyser →'}
            </button>
          </div>
        </Panel>
      )}

      {/* ── Step 2: Preview ──────────────────────────────────────────────── */}
      {step === 'preview' && preview && (
        <>
          <Panel title="Résultat de l'analyse">
            {/* File-level detection */}
            <div style={{ marginBottom: '1rem' }}>
              <strong>Détection fichier :</strong>{' '}
              <StatusBadge tone={CONFIDENCE_TONE[preview.fileDetection.confidence] ?? 'muted'}>
                {PROVIDER_LABELS[preview.fileDetection.provider] ?? preview.fileDetection.provider}
              </StatusBadge>{' '}
              <span className="muted">— confiance : {CONFIDENCE_LABELS[preview.fileDetection.confidence] ?? preview.fileDetection.confidence}</span>
              {preview.fileDetection.reason && (
                <p className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>{preview.fileDetection.reason}</p>
              )}
            </div>

            {/* Stats row */}
            <div className="stats-inline" style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <StatusBadge tone="muted">{preview.total} événement(s)</StatusBadge>
              {preview.noiseCount > 0 && <StatusBadge tone="warn">{preview.noiseCount} bruit(s) détecté(s)</StatusBadge>}
              {preview.cancelledCount > 0 && <StatusBadge tone="muted">{preview.cancelledCount} annulé(s)</StatusBadge>}
              {Object.entries(preview.providerBreakdown).map(([p, count]) => (
                <StatusBadge key={p} tone="muted">
                  {PROVIDER_LABELS[p] ?? p} : {count}
                </StatusBadge>
              ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
              <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={hideNoise} onChange={(e) => setHideNoise(e.target.checked)} />
                Masquer les événements de bruit
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontSize: '0.85rem' }}>
                <span>Provider</span>
                <select className="input" value={filterProvider} onChange={(e) => setFilterProvider(e.target.value)} style={{ padding: '0.2rem 0.4rem' }}>
                  <option value="">Tous</option>
                  {Object.keys(preview.providerBreakdown).map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p] ?? p}</option>
                  ))}
                </select>
              </label>
            </div>

            <PreviewTable events={preview.events} hideNoise={hideNoise} filterProvider={filterProvider} />
          </Panel>

          {/* Provider & name confirmation before import */}
          <Panel title="Confirmer l'import">
            <div className="form-grid">
              <label>
                Provider à utiliser pour tous les événements
                <select value={provider} onChange={(e) => setProvider(e.target.value as ImportProvider)}>
                  <option value="myges">MyGES</option>
                  <option value="myefrei">myEfrei</option>
                  <option value="ensup">Ensup (HyperPlanning)</option>
                  <option value="generic">Autre / Inconnu</option>
                </select>
              </label>
              <label>
                Nom de l'import
                <input type="text" value={name} placeholder="Mon agenda…" onChange={(e) => setName(e.target.value)} />
              </label>
            </div>
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: '0.5rem' }}>
              Les événements de bruit ({preview.noiseCount}) seront automatiquement exclus. Les annulés ({preview.cancelledCount}) sont ignorés.
            </p>
            <div className="actions-row" style={{ marginTop: '1rem' }}>
              <button className="button button-secondary" onClick={resetWizard}>← Recommencer</button>
              <button className="button" onClick={() => void handleImport()} disabled={loading}>
                {loading ? 'Import en cours…' : `Importer ${preview.total - preview.noiseCount - preview.cancelledCount} événement(s) →`}
              </button>
            </div>
          </Panel>
        </>
      )}

      {/* ── Step 3: Result ───────────────────────────────────────────────── */}
      {step === 'import' && result && (
        <Panel title="Résultat de l'import">
          <div className="stats-inline" style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <StatusBadge tone="muted">{result.stats.fetched} parsé(s)</StatusBadge>
            <StatusBadge tone="ok">{result.stats.created} créé(s)</StatusBadge>
            {result.stats.updated > 0 && <StatusBadge tone="warn">{result.stats.updated} mis à jour</StatusBadge>}
            {result.stats.duplicates > 0 && <StatusBadge tone="muted">{result.stats.duplicates} doublon(s)</StatusBadge>}
            {result.stats.skipped > 0 && <StatusBadge tone="muted">{result.stats.skipped} filtré(s)</StatusBadge>}
            {result.stats.cancelled > 0 && <StatusBadge tone="muted">{result.stats.cancelled} annulé(s)</StatusBadge>}
            {isReimportResult(result) && result.stats.removedFutureCount > 0 && (
              <StatusBadge tone="error">{result.stats.removedFutureCount} futur(s) supprimé(s)</StatusBadge>
            )}
          </div>
          <div className="detail-grid">
            <div><strong>Provider utilisé</strong><p>{PROVIDER_LABELS[result.import.provider] ?? result.import.provider}</p></div>
            <div><strong>ID de l'import</strong><p style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{result.import.id}</p></div>
          </div>
          <div className="actions-row" style={{ marginTop: '1rem' }}>
            <button className="button button-secondary" onClick={resetWizard}>Nouvel import</button>
          </div>
        </Panel>
      )}

      {/* ── History ──────────────────────────────────────────────────────── */}
      <Panel title={`${imports.length} import(s) précédent(s)`}>
        {imports.length === 0 ? (
          <p className="muted">{listLoading ? 'Chargement…' : 'Aucun import enregistré.'}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Type</th>
                  <th>Provider</th>
                  <th>Statut</th>
                  <th>Importé le</th>
                  <th>Réimporté le</th>
                  <th>Créés</th>
                  <th>MàJ</th>
                  <th>Doublons</th>
                  <th>Supprimés</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((imp) => (
                  <tr key={imp.id}>
                    <td>
                      <strong>{imp.name}</strong>
                      {imp.originalFilename && (
                        <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>{imp.originalFilename}</p>
                      )}
                    </td>
                    <td>
                      {imp.sourceType === 'manual_url' ? (
                        <StatusBadge tone="ok">URL sync</StatusBadge>
                      ) : (
                        <StatusBadge tone="muted">Fichier</StatusBadge>
                      )}
                    </td>
                    <td>
                      <span>{PROVIDER_LABELS[imp.provider] ?? imp.provider}</span>
                      {imp.detectedProvider && imp.detectedProvider !== imp.provider && (
                        <p className="muted" style={{ fontSize: '0.7rem', margin: 0 }}>
                          détecté : {PROVIDER_LABELS[imp.detectedProvider] ?? imp.detectedProvider}
                        </p>
                      )}
                    </td>
                    <td>
                      <StatusBadge tone={imp.status === 'SUCCESS' ? 'ok' : 'error'}>{imp.status}</StatusBadge>
                    </td>
                    <td>{formatDateTime(imp.importedAt)}</td>
                    <td>{formatDateTime(imp.lastReimportAt)}</td>
                    <td>{imp.createdCount}</td>
                    <td>{imp.updatedCount}</td>
                    <td>{imp.duplicateCount}</td>
                    <td>
                      {imp.removedFutureCount > 0 ? (
                        <StatusBadge tone="error">{imp.removedFutureCount}</StatusBadge>
                      ) : '—'}
                    </td>
                    <td>
                      <div className="actions-row" style={{ gap: '0.25rem' }}>
                        {imp.sourceType === 'manual_url' && imp.status !== 'FAILED' && (
                          <button
                            className="button button-secondary"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                            onClick={() => void handleReimport(imp)}
                            disabled={actionLoading === imp.id}
                          >
                            {actionLoading === imp.id ? '…' : 'Resync'}
                          </button>
                        )}
                        <button
                          className="button button-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: 'var(--error, #a03a2e)' }}
                          onClick={() => setDeleteTarget(imp)}
                        >
                          Suppr.
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
