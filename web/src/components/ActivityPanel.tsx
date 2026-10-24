import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Panel, StatusBadge } from './Ui';
import { formatDateTime } from '../lib/format';
import type { SyncJob } from '../lib/types';

/** Collapsible "recent activity" side panel for the home screen: last few sync
 * jobs plus a count of pending reconciliation suggestions. Collapsed by
 * default so it doesn't compete with the calendar for attention. */
export function ActivityPanel({ pendingSuggestions }: { pendingSuggestions: number }) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSyncHistory(undefined, 5)
      .then((data) => setHistory(data as SyncJob[]))
      .catch(() => { /* non-critical */ })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Panel
      title="Activité récente"
      actions={
        <button className="activity-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Réduire' : 'Détails'}
        </button>
      }
    >
      <div className="activity-summary">
        <StatusBadge tone={history[0]?.status === 'FAILED' ? 'error' : 'muted'}>
          {history[0] ? `Dernier job : ${history[0].status}` : 'Aucun job récent'}
        </StatusBadge>
        <Link to="/matches">
          <StatusBadge tone={pendingSuggestions > 0 ? 'warn' : 'muted'}>
            {pendingSuggestions} suggestion(s) en attente
          </StatusBadge>
        </Link>
      </div>

      {expanded && (
        <div className="activity-list">
          {loading ? (
            <p className="muted">Chargement...</p>
          ) : history.length === 0 ? (
            <p className="muted">Aucune synchronisation enregistrée.</p>
          ) : (
            history.map((job) => (
              <Link key={job.id} to={`/sync/${job.id}`} className="activity-row">
                <span>
                  <strong>{job.provider}</strong> — {job.trigger}
                  {job.dryRun ? ' (dry-run)' : ''}
                </span>
                <span className="activity-row-meta">
                  <StatusBadge tone={job.status === 'FAILED' ? 'error' : job.status === 'SUCCESS' ? 'ok' : 'muted'}>
                    {job.status}
                  </StatusBadge>{' '}
                  {formatDateTime(job.startedAt)}
                </span>
              </Link>
            ))
          )}
          <Link to="/sync" className="activity-row">
            <span>Voir tout l'historique</span>
            <span className="alert-banner-arrow">→</span>
          </Link>
        </div>
      )}
    </Panel>
  );
}
