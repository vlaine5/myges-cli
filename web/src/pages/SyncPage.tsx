import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel, SuccessCallout } from '../components/Ui';
import { formatDateTime, formatMaybe } from '../lib/format';

function defaultDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function SyncPage() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<'myges' | 'myefrei' | 'ensup'>('myges');
  const [start, setStart] = useState(defaultDate(-7));
  const [end, setEnd] = useState(defaultDate(30));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  async function loadHistory() {
    setLoading(true);
    try {
      setHistory((await api.getSyncHistory(provider)) as any[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Historique indisponible.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const load = async () => {
      await loadHistory();
    };

    void load();
    // Le chargement dépend uniquement du provider sélectionné.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  async function runSync(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        start: `${start}T00:00:00.000Z`,
        end: `${end}T23:59:59.999Z`,
        provider,
      };
      const syncResult = dryRun
        ? await api.dryRunSyncForProvider(payload)
        : await api.runSyncForProvider(payload);
      setResult(syncResult);
      setSuccess(dryRun ? `Dry-run execute pour ${provider}.` : `Sync executee pour ${provider}.`);
      await loadHistory();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Execution de la sync impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingBlock label="Chargement de l historique de sync..." />;
  }

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Pilotage</p>
          <h2>Synchronisation</h2>
        </div>
      </header>

      <Panel title="Execution manuelle">
        <div className="form-grid">
          <label>
            Provider
            <select value={provider} onChange={(event) => setProvider(event.target.value as 'myges' | 'myefrei' | 'ensup')}>
              <option value="myges">MyGES</option>
              <option value="myefrei">myEfrei</option>
              <option value="ensup">Ensup (HyperPlanning)</option>
            </select>
          </label>
          <label>
            Debut
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            Fin
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
        </div>

        <div className="actions-row">
          <button className="button button-secondary" disabled={busy} onClick={() => void runSync(true)}>
            Dry-run
          </button>
          <button className="button" disabled={busy} onClick={() => void runSync(false)}>
            Lancer la sync
          </button>
          <button
            className="button button-secondary"
            onClick={() =>
              api.downloadIcs({
                save: true,
                provider,
                start: `${start}T00:00:00.000Z`,
                end: `${end}T23:59:59.999Z`,
              })
            }
          >
            Export ICS
          </button>
        </div>
      </Panel>

      <ErrorCallout message={error} />
      <SuccessCallout message={success} />

      {result ? (
        <Panel title="Dernier resultat manuel">
          <div className="detail-grid">
            <div>
              <strong>Provider</strong>
              <p>{result.provider}</p>
            </div>
            <div>
              <strong>Fetched</strong>
              <p>{result.fetchedCount}</p>
            </div>
            <div>
              <strong>Created</strong>
              <p>{result.createdCount}</p>
            </div>
            <div>
              <strong>Updated</strong>
              <p>{result.updatedCount}</p>
            </div>
            <div>
              <strong>Deleted</strong>
              <p>{result.deletedCount}</p>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel title="Historique des jobs">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Debut</th>
                <th>Provider</th>
                <th>Statut</th>
                <th>Trigger</th>
                <th>Fetched</th>
                <th>Cree</th>
                <th>Maj</th>
                <th>Suppr.</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {history.map((job) => (
                <tr key={job.id}>
                  <td>{formatDateTime(job.startedAt)}</td>
                  <td>{job.provider}</td>
                  <td>{job.status}</td>
                  <td>{job.trigger}</td>
                  <td>{formatMaybe(job.eventsFetched)}</td>
                  <td>{formatMaybe(job.createdCount)}</td>
                  <td>{formatMaybe(job.updatedCount)}</td>
                  <td>{formatMaybe(job.deletedCount)}</td>
                  <td>{job.summary ?? job.errorMessage ?? 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
