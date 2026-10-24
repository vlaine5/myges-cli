import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel, StatusBadge, SuccessCallout } from '../components/Ui';
import { formatDateTime } from '../lib/format';
import type { RollbackJobResult, SyncJobEventChange } from '../lib/types';

const ACTION_TONE: Record<string, 'ok' | 'warn' | 'muted' | 'error'> = {
  CREATED: 'ok',
  UPDATED: 'warn',
  DELETED: 'error',
  ROLLED_BACK: 'muted',
};

function safeParse(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function diffFields(beforeJson: string | null, afterJson: string | null) {
  const before = safeParse(beforeJson);
  const after = safeParse(afterJson);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const rows: Array<{ key: string; before: unknown; after: unknown }> = [];
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      rows.push({ key, before: b, after: a });
    }
  }
  return rows;
}

function displayValue(value: unknown) {
  if (value === undefined || value === null) return '—';
  return String(value);
}

export function SyncJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [changes, setChanges] = useState<SyncJobEventChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<RollbackJobResult['results'] | null>(null);

  async function load() {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSyncJobChanges(jobId);
      setChanges(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les changements.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // A change that's already been rolled back keeps its ORIGINAL action (the
  // backend never mutates it) — the rollback is recorded as a separate
  // ROLLED_BACK row whose afterJson references the original change's id.
  const rolledBackIds = useMemo(() => {
    const ids = new Set<string>();
    for (const change of changes) {
      if (change.action === 'ROLLED_BACK') {
        const ref = safeParse(change.afterJson).rolledBackChangeId;
        if (typeof ref === 'string') ids.add(ref);
      }
    }
    return ids;
  }, [changes]);

  async function handleRollbackChange(changeId: string) {
    if (!jobId) return;
    setBusyId(changeId);
    setError(null);
    setSuccess(null);
    try {
      const updated = await api.rollbackSyncChange(jobId, changeId);
      setChanges(updated);
      setSuccess('Changement annulé.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback impossible.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRollbackJob() {
    if (!jobId) return;
    setBulkBusy(true);
    setError(null);
    setSuccess(null);
    setBulkResult(null);
    try {
      const { results } = await api.rollbackSyncJob(jobId);
      setBulkResult(results);
      const failed = results.filter((r) => r.status === 'FAILED').length;
      setSuccess(failed > 0
        ? `Rollback terminé : ${results.length - failed} ok, ${failed} échoué(s).`
        : `Rollback terminé pour ${results.length} changement(s).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback du job impossible.');
    } finally {
      setBulkBusy(false);
    }
  }

  if (loading) {
    return <LoadingBlock label="Chargement des changements du job..." />;
  }

  const rollbackableCount = changes.filter(
    (c) => c.action !== 'ROLLED_BACK' && !rolledBackIds.has(c.id),
  ).length;

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Sync job</p>
          <h2>Détail du job {jobId}</h2>
        </div>
        <button
          className="button"
          style={{ background: 'var(--error)', borderColor: 'var(--error)' }}
          disabled={bulkBusy || rollbackableCount === 0}
          onClick={() => void handleRollbackJob()}
        >
          {bulkBusy ? 'Rollback en cours...' : `Rollback du job entier (${rollbackableCount})`}
        </button>
      </header>

      <ErrorCallout message={error} />
      <SuccessCallout message={success} />

      {bulkResult && (
        <Panel title="Résultat du rollback groupé">
          <div className="list-grid">
            {bulkResult.map((r) => (
              <div key={r.changeId} className="list-card">
                <strong>{r.changeId}</strong>
                <StatusBadge tone={r.status === 'ROLLED_BACK' ? 'ok' : 'error'}>{r.status}</StatusBadge>
                {r.error && <span>{r.error}</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title={`${changes.length} changement(s)`}>
        {changes.length === 0 ? (
          <p className="muted">Aucun changement enregistré pour ce job.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>GlobalEvent</th>
                  <th>Diff</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((change) => {
                  const diff = diffFields(change.beforeJson, change.afterJson);
                  const disabled = change.action === 'ROLLED_BACK' || rolledBackIds.has(change.id);
                  return (
                    <tr key={change.id}>
                      <td>{formatDateTime(change.createdAt)}</td>
                      <td><StatusBadge tone={ACTION_TONE[change.action] ?? 'muted'}>{change.action}</StatusBadge></td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {change.globalEventId ?? '—'}
                      </td>
                      <td>
                        {diff.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          diff.map((row) => (
                            <span className="diff-field" key={row.key}>
                              <strong>{row.key}</strong>{' '}
                              <span className="diff-before">{displayValue(row.before)}</span>{' → '}
                              <span className="diff-after">{displayValue(row.after)}</span>
                            </span>
                          ))
                        )}
                      </td>
                      <td>
                        <button
                          className="button button-secondary"
                          style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                          disabled={disabled || busyId === change.id}
                          onClick={() => void handleRollbackChange(change.id)}
                        >
                          {disabled ? 'Déjà annulé' : busyId === change.id ? '...' : 'Rollback'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
