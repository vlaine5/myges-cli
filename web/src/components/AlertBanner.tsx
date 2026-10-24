import { useNavigate } from 'react-router-dom';

/** Renders nothing when there's nothing actionable. Shows a thin banner when
 * the last sync job failed, and/or when there are pending reconciliation
 * suggestions — each clickable, navigating to the page that explains it. */
export function AlertBanner({
  lastJobFailed,
  lastJobError,
  pendingSuggestions,
}: {
  lastJobFailed: boolean;
  lastJobError: string | null;
  pendingSuggestions: number;
}) {
  const navigate = useNavigate();

  if (!lastJobFailed && pendingSuggestions <= 0) {
    return null;
  }

  return (
    <div>
      {lastJobFailed && (
        <div className="alert-banner alert-banner--error" onClick={() => navigate('/sync')}>
          <span>La dernière synchronisation a échoué{lastJobError ? ` — ${lastJobError}` : ''}.</span>
          <span className="alert-banner-arrow">→</span>
        </div>
      )}
      {pendingSuggestions > 0 && (
        <div className="alert-banner alert-banner--warn" onClick={() => navigate('/matches')}>
          <span>
            {pendingSuggestions} suggestion{pendingSuggestions > 1 ? 's' : ''} de rapprochement en attente.
          </span>
          <span className="alert-banner-arrow">→</span>
        </div>
      )}
    </div>
  );
}
