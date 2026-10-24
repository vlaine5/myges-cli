import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, Panel, StatusBadge, SuccessCallout } from '../components/Ui';

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

type Provider = 'myges' | 'myefrei' | 'ensup';
type FetchMode = 'api' | 'ics';

interface AgendaDto {
  id: string;
  name: string;
  provider: Provider;
  fetchMode: FetchMode;
  hasIcsUrl: boolean;
  enabled: boolean;
  syncEnabled: boolean;
  syncDayOfWeek: number | null;
  syncDayName: string | null;
  syncHour: number;
  lookbackDays: number;
  lookaheadDays: number;
  googleCalendarId: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  nextSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const emptyForm = {
  name: '',
  provider: 'myges' as Provider,
  fetchMode: 'api' as FetchMode,
  icsUrl: '',
  enabled: true,
  syncEnabled: false,
  syncDayOfWeek: null as number | null,
  syncHour: 6,
  lookbackDays: 7,
  lookaheadDays: 30,
  googleCalendarId: '',
};

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function AgendasPage() {
  const [agendas, setAgendas] = useState<AgendaDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editing, setEditing] = useState<AgendaDto | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  const [syncResult, setSyncResult] = useState<Record<string, unknown> | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; note: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function loadAgendas() {
    setLoading(true);
    setError(null);
    try {
      const data = (await api.listAgendas()) as AgendaDto[];
      setAgendas(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAgendas();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
    setError(null);
    setSuccess(null);
    setSyncResult(null);
    setTestResult(null);
  }

  function openEdit(agenda: AgendaDto) {
    setEditing(agenda);
    setForm({
      name: agenda.name,
      provider: agenda.provider,
      fetchMode: agenda.fetchMode,
      icsUrl: '',
      enabled: agenda.enabled,
      syncEnabled: agenda.syncEnabled,
      syncDayOfWeek: agenda.syncDayOfWeek,
      syncHour: agenda.syncHour,
      lookbackDays: agenda.lookbackDays,
      lookaheadDays: agenda.lookaheadDays,
      googleCalendarId: agenda.googleCalendarId ?? '',
    });
    setShowForm(true);
    setError(null);
    setSuccess(null);
    setSyncResult(null);
    setTestResult(null);
  }

  function cancelForm() {
    setShowForm(false);
    setEditing(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const payload = {
        name: form.name,
        provider: form.provider,
        fetchMode: form.fetchMode,
        icsUrl: form.fetchMode === 'ics' && form.icsUrl ? form.icsUrl : null,
        enabled: form.enabled,
        syncEnabled: form.syncEnabled,
        syncDayOfWeek: form.syncEnabled ? form.syncDayOfWeek : null,
        syncHour: form.syncHour,
        lookbackDays: form.lookbackDays,
        lookaheadDays: form.lookaheadDays,
        googleCalendarId: form.googleCalendarId || null,
      };
      if (editing) {
        await api.updateAgenda(editing.id, payload);
        setSuccess('Agenda mis a jour.');
      } else {
        await api.createAgenda(payload);
        setSuccess('Agenda cree.');
      }
      setShowForm(false);
      setEditing(null);
      await loadAgendas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(agenda: AgendaDto) {
    if (!confirm(`Supprimer l'agenda "${agenda.name}" ?`)) return;
    setError(null);
    try {
      await api.deleteAgenda(agenda.id);
      await loadAgendas();
      setSuccess(`Agenda "${agenda.name}" supprime.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur.');
    }
  }

  async function handleSync(agenda: AgendaDto, dryRun: boolean) {
    setActionLoading(`${agenda.id}-sync`);
    setError(null);
    setSyncResult(null);
    try {
      const result = (await api.syncAgenda(agenda.id, dryRun)) as Record<string, unknown>;
      setSyncResult(result);
      if (!dryRun) await loadAgendas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de sync.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTest(agenda: AgendaDto) {
    setActionLoading(`${agenda.id}-test`);
    setError(null);
    setTestResult(null);
    try {
      const result = (await api.testAgenda(agenda.id)) as { ok: boolean; note: string };
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de test.');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Sources de cours</p>
          <h2>Agendas</h2>
        </div>
        <button className="button" onClick={openCreate}>
          Nouvel agenda
        </button>
      </header>

      <ErrorCallout message={error} />
      <SuccessCallout message={success} />

      {syncResult && (
        <Panel title="Resultat de sync">
          <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(syncResult, null, 2)}
          </pre>
        </Panel>
      )}

      {testResult && (
        <Panel title="Resultat du test">
          <div className="stats-inline">
            <StatusBadge tone={testResult.ok ? 'ok' : 'error'}>
              {testResult.ok ? 'OK' : 'ECHEC'}
            </StatusBadge>
            <span>{testResult.note}</span>
          </div>
        </Panel>
      )}

      {showForm && (
        <Panel title={editing ? `Modifier — ${editing.name}` : 'Nouvel agenda'}>
          <form onSubmit={(e) => void handleSubmit(e)}>
            <div className="form-grid">
              <label>
                Nom
                <input
                  type="text"
                  value={form.name}
                  required
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>

              <label>
                Provider
                <select
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as Provider }))}
                >
                  <option value="myges">MyGES</option>
                  <option value="myefrei">myEfrei</option>
                  <option value="ensup">Ensup (HyperPlanning)</option>
                </select>
              </label>

              <label>
                Mode de recuperation
                <select
                  value={form.fetchMode}
                  onChange={(e) => setForm((f) => ({ ...f, fetchMode: e.target.value as FetchMode }))}
                >
                  <option value="api">API (credentials provider)</option>
                  <option value="ics">ICS (URL publique ou prive)</option>
                </select>
              </label>

              {form.fetchMode === 'ics' && (
                <label>
                  URL ICS {editing?.hasIcsUrl ? '(laisser vide pour conserver l\'existante)' : '*'}
                  <input
                    type="url"
                    value={form.icsUrl}
                    placeholder="https://..."
                    onChange={(e) => setForm((f) => ({ ...f, icsUrl: e.target.value }))}
                  />
                </label>
              )}

              <label>
                Lookback (jours)
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={form.lookbackDays}
                  onChange={(e) => setForm((f) => ({ ...f, lookbackDays: Number(e.target.value) }))}
                />
              </label>

              <label>
                Lookahead (jours)
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.lookaheadDays}
                  onChange={(e) => setForm((f) => ({ ...f, lookaheadDays: Number(e.target.value) }))}
                />
              </label>

              <label>
                Google Calendar ID (optionnel)
                <input
                  type="text"
                  value={form.googleCalendarId}
                  placeholder="...@group.calendar.google.com"
                  onChange={(e) => setForm((f) => ({ ...f, googleCalendarId: e.target.value }))}
                />
              </label>
            </div>

            <div className="form-grid" style={{ marginTop: '1rem' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                Agenda actif
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.syncEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, syncEnabled: e.target.checked }))}
                />
                Sync automatique activee
              </label>
            </div>

            {form.syncEnabled && (
              <div className="form-grid" style={{ marginTop: '0.5rem' }}>
                <label>
                  Jour de la semaine
                  <select
                    value={form.syncDayOfWeek ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        syncDayOfWeek: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                  >
                    <option value="">— Aucun jour specifique —</option>
                    {DAY_NAMES.map((name, i) => (
                      <option key={i} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Heure (0–23)
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={form.syncHour}
                    onChange={(e) => setForm((f) => ({ ...f, syncHour: Number(e.target.value) }))}
                  />
                </label>
              </div>
            )}

            <div className="actions-row" style={{ marginTop: '1rem' }}>
              <button type="button" className="button button-secondary" onClick={cancelForm}>
                Annuler
              </button>
              <button type="submit" className="button" disabled={loading}>
                {editing ? 'Mettre a jour' : 'Creer'}
              </button>
            </div>
          </form>
        </Panel>
      )}

      <Panel title={`${agendas.length} agenda(s) configure(s)`}>
        {agendas.length === 0 ? (
          <p className="muted">
            {loading ? 'Chargement...' : 'Aucun agenda configure. Cliquez sur "Nouvel agenda".'}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Provider</th>
                  <th>Mode</th>
                  <th>Sync auto</th>
                  <th>Dernier sync</th>
                  <th>Prochain sync</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agendas.map((agenda) => (
                  <tr key={agenda.id}>
                    <td>
                      <strong>{agenda.name}</strong>
                      {!agenda.enabled && <span className="muted"> (desactive)</span>}
                    </td>
                    <td>{agenda.provider}</td>
                    <td>
                      {agenda.fetchMode === 'ics' ? (
                        <StatusBadge tone={agenda.hasIcsUrl ? 'ok' : 'error'}>
                          ICS{agenda.hasIcsUrl ? '' : ' (no URL)'}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="muted">API</StatusBadge>
                      )}
                    </td>
                    <td>
                      {agenda.syncEnabled && agenda.syncDayName ? (
                        <span>
                          {agenda.syncDayName} {String(agenda.syncHour).padStart(2, '0')}h
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{formatDateTime(agenda.lastSyncAt)}</td>
                    <td>{formatDateTime(agenda.nextSyncAt)}</td>
                    <td>
                      {agenda.lastSyncStatus === 'SUCCESS' && (
                        <StatusBadge tone="ok">OK</StatusBadge>
                      )}
                      {agenda.lastSyncStatus === 'FAILED' && (
                        <StatusBadge tone="error" title={agenda.lastSyncError ?? ''}>
                          ERREUR
                        </StatusBadge>
                      )}
                      {!agenda.lastSyncStatus && <StatusBadge tone="muted">Jamais</StatusBadge>}
                    </td>
                    <td>
                      <div className="actions-row" style={{ gap: '0.25rem' }}>
                        <button
                          className="button button-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => void handleTest(agenda)}
                          disabled={actionLoading === `${agenda.id}-test`}
                        >
                          Test
                        </button>
                        <button
                          className="button button-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => void handleSync(agenda, true)}
                          disabled={actionLoading === `${agenda.id}-sync`}
                        >
                          Dry-run
                        </button>
                        <button
                          className="button"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => void handleSync(agenda, false)}
                          disabled={actionLoading === `${agenda.id}-sync`}
                        >
                          Sync
                        </button>
                        <button
                          className="button button-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => openEdit(agenda)}
                        >
                          Editer
                        </button>
                        <button
                          className="button button-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-error, #c0392b)' }}
                          onClick={() => void handleDelete(agenda)}
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
