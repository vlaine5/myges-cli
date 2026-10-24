import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, Panel } from '../components/Ui';

interface CalendarEvent {
  id: string;
  provider: string;
  agendaId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  teacher: string | null;
  room: string | null;
  subject: string | null;
  group: string | null;
}

interface AgendaOption {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
}

const WEEK_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTH_NAMES = [
  'Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre',
];

const PROVIDER_LABELS: Record<string, string> = {
  myges: 'MyGES',
  myefrei: 'myEfrei',
  ensup: 'Ensup',
  generic: 'Autre / ICS',
};

const PROVIDER_COLORS: Record<string, string> = {
  myges: '#2563eb',
  myefrei: '#7c3aed',
  ensup: '#059669',
  generic: '#d97706',
};

function providerColor(p: string): string {
  return PROVIDER_COLORS[p] ?? '#555';
}

function startOfMonth(year: number, month: number) {
  return new Date(year, month, 1);
}

function buildGrid(year: number, month: number): Date[] {
  const first = startOfMonth(year, month);
  const startDow = (first.getDay() + 6) % 7;
  const grid: Date[] = [];
  for (let i = -startDow; grid.length < 42; i++) {
    grid.push(new Date(year, month, 1 + i));
  }
  while (grid.length > 35 && grid[grid.length - 7].getMonth() !== month) {
    grid.splice(grid.length - 7, 7);
  }
  return grid;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  // 'all' means no provider filter; a provider id means filter by that provider
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  // 'all' means no agenda filter
  const [selectedAgenda, setSelectedAgenda] = useState<string>('all');

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [activeProviders, setActiveProviders] = useState<string[]>([]);
  const [agendas, setAgendas] = useState<AgendaOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);

  // Cleanup dialog state
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupProvider, setCleanupProvider] = useState('');
  const [cleanupAgenda, setCleanupAgenda] = useState('');
  const [cleanupScope, setCleanupScope] = useState<'future' | 'all'>('future');
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  const grid = useMemo(() => buildGrid(year, month), [year, month]);
  const rangeStart = grid[0];
  const rangeEnd = grid[grid.length - 1];

  // Load agendas once (static config list)
  useEffect(() => {
    api.listAgendas().then((data) => {
      setAgendas((data as AgendaOption[]).filter((a) => a.enabled));
    }).catch(() => {/* silent */});
  }, []);

  // Load active providers whenever the range changes
  useEffect(() => {
    const start = rangeStart.toISOString();
    const end = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59).toISOString();
    api.getActiveProviders(start, end).then((providers) => {
      setActiveProviders(providers);
    }).catch(() => {/* silent */});
  }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load events whenever range or filters change
  useEffect(() => {
    void loadEvents();
  }, [year, month, selectedProvider, selectedAgenda]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const search = new URLSearchParams({
        start: rangeStart.toISOString(),
        end: new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59).toISOString(),
        refresh: 'false',
      });
      // Only set provider param when not 'all' — backend returns all providers when absent
      if (selectedProvider !== 'all') {
        search.set('provider', selectedProvider);
      }
      if (selectedAgenda !== 'all') {
        search.set('agendaId', selectedAgenda);
      }
      const data = (await api.getEvents(search)) as CalendarEvent[];
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function goToday() {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth());
  }

  // When provider filter changes, reset agenda filter
  function handleProviderChange(p: string) {
    setSelectedProvider(p);
    setSelectedAgenda('all');
  }

  // Agendas filtered by the selected provider (or all if provider='all')
  const filteredAgendas = selectedProvider === 'all'
    ? agendas
    : agendas.filter((a) => a.provider === selectedProvider);

  const eventsForDay = (day: Date) =>
    events.filter(ev => isSameDay(new Date(ev.startAt), day))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));

  async function handleCleanup() {
    setCleanupError(null);
    setCleanupResult(null);
    if (!cleanupProvider && !cleanupAgenda) {
      setCleanupError('Sélectionnez au moins un provider ou un agenda.');
      return;
    }
    try {
      const res = (await api.deleteEvents({
        provider: cleanupProvider || undefined,
        agendaId: cleanupAgenda || undefined,
        scope: cleanupScope,
      })) as { deletedCount: number };
      setCleanupResult(`${res.deletedCount} événement(s) supprimé(s).`);
      void loadEvents();
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : 'Erreur de nettoyage.');
    }
  }

  // Count events per provider for the legend
  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ev of events) {
      counts[ev.provider] = (counts[ev.provider] ?? 0) + 1;
    }
    return counts;
  }, [events]);

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Vue mensuelle</p>
          <h2>Calendrier</h2>
        </div>
        <div className="actions-row">
          <button
            className="button button-secondary"
            onClick={() => setCleanupOpen(true)}
          >
            Nettoyage événements
          </button>
        </div>
      </header>

      {/* Filters */}
      <Panel title="Filtres">
        <div className="form-grid">
          <label>
            Provider
            <select value={selectedProvider} onChange={(e) => handleProviderChange(e.target.value)}>
              <option value="all">Tous les providers</option>
              {/* Show only providers that have events in this range */}
              {activeProviders.length > 0
                ? activeProviders.map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p] ?? p}</option>
                  ))
                : (['myges', 'myefrei', 'ensup', 'generic'] as const).map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                  ))}
            </select>
          </label>

          <label>
            Agenda
            <select
              value={selectedAgenda}
              onChange={(e) => setSelectedAgenda(e.target.value)}
              disabled={filteredAgendas.length === 0}
            >
              <option value="all">Tous les agendas</option>
              {filteredAgendas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({PROVIDER_LABELS[a.provider] ?? a.provider})
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Provider legend — visible in "all providers" mode */}
        {selectedProvider === 'all' && Object.keys(providerCounts).length > 0 && (
          <div className="stats-inline" style={{ marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            {Object.entries(providerCounts).map(([p, count]) => (
              <span
                key={p}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  fontSize: '0.82rem', padding: '0.2rem 0.5rem',
                  borderRadius: 4, background: providerColor(p) + '22',
                  color: providerColor(p), fontWeight: 600,
                  border: `1px solid ${providerColor(p)}44`,
                  cursor: 'pointer',
                }}
                onClick={() => handleProviderChange(p)}
                title={`Filtrer sur ${PROVIDER_LABELS[p] ?? p}`}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: providerColor(p), display: 'inline-block',
                }} />
                {PROVIDER_LABELS[p] ?? p} — {count}
              </span>
            ))}
          </div>
        )}
      </Panel>

      <ErrorCallout message={error} />

      {/* Calendar grid */}
      <Panel title={`${MONTH_NAMES[month]} ${year}${loading ? ' — chargement...' : ` — ${events.length} evenement(s)`}`}>
        <div className="cal-nav">
          <button className="button button-secondary" onClick={prevMonth}>&lsaquo; Precedent</button>
          <button className="button button-secondary" onClick={goToday}>Aujourd'hui</button>
          <button className="button button-secondary" onClick={nextMonth}>Suivant &rsaquo;</button>
        </div>

        <div className="cal-grid">
          {WEEK_DAYS.map(d => (
            <div key={d} className="cal-header-cell">{d}</div>
          ))}
          {grid.map((day, idx) => {
            const isCurrentMonth = day.getMonth() === month;
            const isToday = isSameDay(day, now);
            const dayEvents = eventsForDay(day);
            return (
              <div
                key={idx}
                className={[
                  'cal-cell',
                  isCurrentMonth ? '' : 'cal-cell--outside',
                  isToday ? 'cal-cell--today' : '',
                ].filter(Boolean).join(' ')}
              >
                <span className="cal-day-num">{day.getDate()}</span>
                <div className="cal-events">
                  {dayEvents.slice(0, 3).map(ev => (
                    <button
                      key={ev.id}
                      className="cal-event"
                      style={{ background: providerColor(ev.provider) }}
                      onClick={() => setSelected(ev)}
                      title={`[${PROVIDER_LABELS[ev.provider] ?? ev.provider}] ${formatTime(ev.startAt)} ${ev.title}`}
                    >
                      {formatTime(ev.startAt)} {ev.title}
                    </button>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="cal-more">+{dayEvents.length - 3} autres</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Event detail panel */}
      {selected && (
        <Panel title="Detail de l'evenement">
          <div className="detail-grid">
            <div>
              <strong>Provider</strong>
              <p>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  color: providerColor(selected.provider), fontWeight: 600,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: providerColor(selected.provider), display: 'inline-block',
                  }} />
                  {PROVIDER_LABELS[selected.provider] ?? selected.provider}
                </span>
              </p>
            </div>
            {selected.agendaId && (
              <div>
                <strong>Agenda</strong>
                <p>{agendas.find((a) => a.id === selected.agendaId)?.name ?? selected.agendaId}</p>
              </div>
            )}
            <div><strong>Titre</strong><p>{selected.title}</p></div>
            <div><strong>Debut</strong><p>{formatDateTime(selected.startAt)}</p></div>
            <div><strong>Fin</strong><p>{formatDateTime(selected.endAt)}</p></div>
            {selected.teacher && <div><strong>Enseignant</strong><p>{selected.teacher}</p></div>}
            {selected.room && <div><strong>Salle</strong><p>{selected.room}</p></div>}
            {selected.subject && <div><strong>Matiere</strong><p>{selected.subject}</p></div>}
            {selected.group && <div><strong>Groupe</strong><p>{selected.group}</p></div>}
          </div>
          <div className="actions-row" style={{ marginTop: '0.75rem' }}>
            <button className="button button-secondary" onClick={() => setSelected(null)}>Fermer</button>
          </div>
        </Panel>
      )}

      {/* Cleanup dialog */}
      {cleanupOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--surface, #fff)', borderRadius: 8, padding: '1.5rem',
            maxWidth: 480, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ marginTop: 0 }}>Nettoyage des événements</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted, #888)' }}>
              Supprime des événements du snapshot. Les événements supprimés ne peuvent pas être restaurés sans re-synchronisation.
            </p>

            <div className="form-grid" style={{ marginTop: '0.75rem' }}>
              <label>
                Provider (optionnel)
                <select value={cleanupProvider} onChange={(e) => { setCleanupProvider(e.target.value); setCleanupAgenda(''); }}>
                  <option value="">— Tous les providers —</option>
                  {(['myges', 'myefrei', 'ensup', 'generic'] as const).map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                  ))}
                </select>
              </label>

              <label>
                Agenda spécifique (optionnel)
                <select value={cleanupAgenda} onChange={(e) => setCleanupAgenda(e.target.value)}>
                  <option value="">— Tous les agendas —</option>
                  {(cleanupProvider
                    ? agendas.filter((a) => a.provider === cleanupProvider)
                    : agendas
                  ).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({PROVIDER_LABELS[a.provider] ?? a.provider})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Périmètre
                <select value={cleanupScope} onChange={(e) => setCleanupScope(e.target.value as 'future' | 'all')}>
                  <option value="future">Événements futurs uniquement</option>
                  <option value="all">Tous les événements (passés + futurs)</option>
                </select>
              </label>
            </div>

            {cleanupError && <p style={{ color: 'var(--error, #a03a2e)', marginTop: '0.5rem', fontSize: '0.85rem' }}>{cleanupError}</p>}
            {cleanupResult && <p style={{ color: 'var(--success, #15803d)', marginTop: '0.5rem', fontSize: '0.85rem' }}>{cleanupResult}</p>}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="button button-secondary" onClick={() => {
                setCleanupOpen(false);
                setCleanupResult(null);
                setCleanupError(null);
              }}>Fermer</button>
              <button
                className="button"
                style={{ background: 'var(--error, #a03a2e)', borderColor: 'var(--error, #a03a2e)' }}
                onClick={() => void handleCleanup()}
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
