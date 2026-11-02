import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel, StatusBadge } from '../components/Ui';
import { formatDateTime } from '../lib/format';
import type { PlanningChange } from '../lib/types';

const PAGE_SIZE = 200;
const POLL_MS = 20_000;
const PROVIDER_LABELS: Record<string, string> = { myges: 'MyGES', myefrei: 'myEfrei', ensup: 'Ensup' };
const KIND_LABELS = { ADDED: 'Ajouté', UPDATED: 'Modifié', REMOVED: 'Supprimé' } as const;
const KIND_TONES = { ADDED: 'ok', UPDATED: 'warn', REMOVED: 'error' } as const;
const FIELD_LABELS: Record<string, string> = {
  title: 'Intitulé',
  startAt: 'Début',
  endAt: 'Fin',
  room: 'Salle',
  campus: 'Campus',
  teacher: 'Enseignant',
  modality: 'Modalité',
};

function formatValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  return field === 'startAt' || field === 'endAt' ? formatDateTime(String(value)) : String(value);
}

function ChangeLine({ change }: { change: PlanningChange }) {
  return (
    <li style={{ margin: '0.5rem 0' }}>
      <StatusBadge tone={KIND_TONES[change.kind]}>{KIND_LABELS[change.kind]}</StatusBadge>{' '}
      <strong>{change.title}</strong> <span className="meta-line">· {formatDateTime(change.startAt)}</span>
      {change.kind === 'UPDATED' ? (
        <ul style={{ margin: '0.25rem 0 0 1.5rem' }}>
          {change.changedFields.map((field) => (
            <li key={field}>
              {FIELD_LABELS[field] ?? field} : <del>{formatValue(field, change.before?.[field])}</del> →{' '}
              <ins>{formatValue(field, change.after?.[field])}</ins>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ChangesPage() {
  const [changes, setChanges] = useState<PlanningChange[]>([]);
  const [provider, setProvider] = useState('');
  const [kind, setKind] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  // Changes detected after the page was opened are highlighted as new.
  const openedAt = useRef(new Date().toISOString());
  const newest = useRef<string | null>(null);

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const search = new URLSearchParams({ limit: String(PAGE_SIZE), ...extra });
      if (provider) search.set('provider', provider);
      if (kind) search.set('kind', kind);
      return search;
    },
    [provider, kind],
  );

  const reload = useCallback(async () => {
    try {
      const rows = await api.listPlanningChanges(query());
      setChanges(rows);
      setHasMore(rows.length === PAGE_SIZE);
      newest.current = rows[0]?.detectedAt ?? null;
      setLastChecked(new Date().toISOString());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  // Live: only fetches what is newer than what is displayed.
  const poll = useCallback(async () => {
    try {
      const since = newest.current;
      const rows = await api.listPlanningChanges(query(since ? { since } : {}));
      setLastChecked(new Date().toISOString());
      if (since && rows.length > 0) {
        newest.current = rows[0]!.detectedAt;
        setChanges((current) => [...rows, ...current]);
      }
    } catch {
      // keep the list; the next tick retries
    }
  }, [query]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!auto) return undefined;
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [auto, poll]);

  async function loadMore() {
    const last = changes[changes.length - 1];
    if (!last) return;
    const rows = await api.listPlanningChanges(query({ before: new Date(new Date(last.detectedAt).getTime() + 1).toISOString() }));
    setChanges((current) => {
      const known = new Set(current.map((change) => change.id));
      return [...current, ...rows.filter((change) => !known.has(change.id))];
    });
    setHasMore(rows.length === PAGE_SIZE);
  }

  const runs = useMemo(() => {
    const groups = new Map<string, PlanningChange[]>();
    for (const change of changes) groups.set(change.runId, [...(groups.get(change.runId) ?? []), change]);
    return [...groups.values()];
  }, [changes]);

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Historique</p>
          <h2>Modifications du planning</h2>
        </div>
      </header>

      <Panel title="Filtres">
        <div className="form-grid">
          <label>
            Provider
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="">Tous</option>
              {Object.entries(PROVIDER_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">Tous</option>
              {Object.entries(KIND_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Suivi en direct</span>
            <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />
          </label>
        </div>
        <p className="meta-line">
          Comparaison de l'ancien et du nouveau planning à chaque synchronisation.
          {lastChecked ? ` Dernière vérification : ${formatDateTime(lastChecked)}.` : ''}
        </p>
      </Panel>

      <ErrorCallout message={error} />
      {loading ? <LoadingBlock /> : null}
      {!loading && runs.length === 0 ? (
        <Panel title="Aucune modification">
          <p className="meta-line">Rien n'a changé depuis le début du suivi. Les prochaines différences apparaîtront ici.</p>
        </Panel>
      ) : null}

      {runs.map((run) => {
        const first = run[0]!;
        const fresh = first.detectedAt > openedAt.current;
        return (
          <Panel key={first.runId} title={`${PROVIDER_LABELS[first.provider] ?? first.provider} · ${formatDateTime(first.detectedAt)}`}>
            <p className="meta-line">
              {run.length} modification{run.length > 1 ? 's' : ''}
              {fresh ? ' · nouveau' : ''}
            </p>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {run.map((change) => (
                <ChangeLine key={change.id} change={change} />
              ))}
            </ul>
          </Panel>
        );
      })}

      {hasMore ? (
        <div className="actions-row">
          <button className="button button-secondary" onClick={() => void loadMore()}>
            Charger plus ancien
          </button>
        </div>
      ) : null}
    </div>
  );
}
