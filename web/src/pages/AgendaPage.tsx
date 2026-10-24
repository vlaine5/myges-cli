import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, Panel, StatusBadge, SuccessCallout } from '../components/Ui';
import { formatDateTime, formatMaybe } from '../lib/format';

function defaultDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function AgendaPage() {
  const [provider, setProvider] = useState<'myges' | 'myefrei' | 'ensup'>('myges');
  const [start, setStart] = useState(defaultDate(-7));
  const [end, setEnd] = useState(defaultDate(30));
  const [events, setEvents] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const totals = useMemo(
    () => ({
      events: events.length,
      withStudentCount: events.filter((event) => event.studentCount !== null).length,
    }),
    [events],
  );

  // Load active provider from settings on mount
  useEffect(() => {
    void api.getSettings().then((settings: any) => {
      if (settings?.provider && ['myges', 'myefrei', 'ensup'].includes(settings.provider)) {
        setProvider(settings.provider as 'myges' | 'myefrei' | 'ensup');
      }
    }).catch(() => {
      // Silently fail, keep default
    });
  }, []);

  async function load(refresh: boolean) {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const search = new URLSearchParams({
        start: `${start}T00:00:00.000Z`,
        end: `${end}T23:59:59.999Z`,
        refresh: refresh ? 'true' : 'false',
        provider,
      });
      const result = (await api.getEvents(search)) as any[];
      setEvents(result);
      setSelected(result[0] ?? null);
      setSuccess(
        refresh
          ? `Agenda ${provider} recharge depuis la source.`
          : `Agenda ${provider} charge depuis le cache local.`,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Chargement de l agenda impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Apercu agenda</p>
          <h2>Evenements</h2>
        </div>
      </header>

      <Panel title="Filtres">
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
          <button className="button button-secondary" disabled={loading} onClick={() => void load(false)}>
            Charger le cache
          </button>
          <button className="button" disabled={loading} onClick={() => void load(true)}>
            Recharger depuis la source
          </button>
        </div>
      </Panel>

      <ErrorCallout message={error} />
      <SuccessCallout message={success} />

      <div className="stats-inline">
        <StatusBadge tone="ok">{totals.events} evenements</StatusBadge>
        <StatusBadge tone="muted">{totals.withStudentCount} avec studentCount</StatusBadge>
      </div>

      <div className="agenda-grid">
        <Panel title="Liste">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Cours</th>
                  <th>Debut</th>
                  <th>Teacher</th>
                  <th>Salle</th>
                  <th>Eleves</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} onClick={() => setSelected(event)}>
                    <td>{event.provider}</td>
                    <td>{event.title}</td>
                    <td>{formatDateTime(event.startAt)}</td>
                    <td>{formatMaybe(event.teacher)}</td>
                    <td>{formatMaybe(event.room)}</td>
                    <td>{formatMaybe(event.studentCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Detail">
          {selected ? (
            <div className="detail-grid">
              <div>
                <strong>Provider</strong>
                <p>{selected.provider}</p>
              </div>
              <div>
                <strong>Source ID</strong>
                <p>{selected.sourceId}</p>
              </div>
              <div>
                <strong>Titre</strong>
                <p>{selected.title}</p>
              </div>
              <div>
                <strong>Debut</strong>
                <p>{formatDateTime(selected.startAt)}</p>
              </div>
              <div>
                <strong>Fin</strong>
                <p>{formatDateTime(selected.endAt)}</p>
              </div>
              <div>
                <strong>Enseignant</strong>
                <p>{formatMaybe(selected.teacher)}</p>
              </div>
              <div>
                <strong>Campus</strong>
                <p>{formatMaybe(selected.campus)}</p>
              </div>
              <div>
                <strong>Classe(s)</strong>
                <p>{Array.isArray(selected.classes) && selected.classes.length > 0 ? selected.classes.join(', ') : formatMaybe(selected.promotion ?? selected.group)}</p>
              </div>
              <div>
                <strong>Modalite</strong>
                <p>{formatMaybe(selected.modality)}</p>
              </div>
              <div>
                <strong>Type</strong>
                <p>{formatMaybe(selected.reservationType)}</p>
              </div>
              <div>
                <strong>studentCount</strong>
                <p>{formatMaybe(selected.studentCount)}</p>
              </div>
              <div>
                <strong>reservation_id</strong>
                <p>{formatMaybe(selected.reservationId)}</p>
              </div>
            </div>
          ) : (
            <p className="muted">Selectionnez un evenement.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
