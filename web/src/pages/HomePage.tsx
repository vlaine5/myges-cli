import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, Panel } from '../components/Ui';
import { formatDateTime } from '../lib/format';
import type { GlobalEvent } from '../lib/types';
import { AlertBanner } from '../components/AlertBanner';
import { ActivityPanel } from '../components/ActivityPanel';
import { EventDetailPanel } from '../components/EventDetailPanel';

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
  while (grid.length > 35) {
    const lastWeekStart = grid[grid.length - 7];
    if (!lastWeekStart || lastWeekStart.getMonth() === month) {
      break;
    }
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

/** The provider used to color a GlobalEvent: its primary snapshot's provider,
 * falling back to the first linked snapshot if the primary can't be resolved. */
function primaryProvider(event: GlobalEvent): string {
  const primary = event.snapshots.find((s) => s.id === event.primarySnapshotId);
  return (primary ?? event.snapshots[0])?.provider ?? 'generic';
}

export function HomePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [selectedProvider, setSelectedProvider] = useState<string>('all');

  const [events, setEvents] = useState<GlobalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<any | null>(null);
  const [pendingSuggestions, setPendingSuggestions] = useState<number>(0);

  // Cleanup dialog state (bulk-delete raw snapshots — unrelated to GlobalEvent merges)
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupProvider, setCleanupProvider] = useState('');
  const [cleanupScope, setCleanupScope] = useState<'future' | 'all'>('future');
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  const grid = useMemo(() => buildGrid(year, month), [year, month]);
  const rangeStart = grid[0] ?? new Date(year, month, 1);
  const rangeEnd = grid[grid.length - 1] ?? new Date(year, month + 1, 0);

  useEffect(() => {
    void loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const [dash, suggestions] = await Promise.all([
        api.getDashboard(),
        api.getReconciliationSuggestions(),
      ]);
      setDashboard(dash);
      setPendingSuggestions((suggestions as unknown[]).length);
    } catch {
      // Status strip/banner are non-critical — the calendar itself still works.
    }
  }

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const search = new URLSearchParams({
        start: rangeStart.toISOString(),
        end: new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59).toISOString(),
      });
      const data = await api.getGlobalEvents(search);
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

  const visibleEvents = selectedProvider === 'all'
    ? events
    : events.filter((ev) => ev.snapshots.some((s) => s.provider === selectedProvider));

  const eventsForDay = (day: Date) =>
    visibleEvents.filter(ev => isSameDay(new Date(ev.startAt), day))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));

  async function handleCleanup() {
    setCleanupError(null);
    setCleanupResult(null);
    if (!cleanupProvider) {
      setCleanupError('Sélectionnez un provider.');
      return;
    }
    try {
      const res = (await api.deleteEvents({
        provider: cleanupProvider,
        scope: cleanupScope,
      })) as { deletedCount: number };
      setCleanupResult(`${res.deletedCount} événement(s) supprimé(s).`);
      void loadEvents();
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : 'Erreur de nettoyage.');
    }
  }

  // Count GlobalEvents per provider for the legend — a merged (2+ snapshot) event
  // counts once per distinct provider it spans, so the legend reflects what's
  // actually on the grid for that provider filter.
  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ev of events) {
      const providers = new Set(ev.snapshots.map((s) => s.provider));
      for (const p of providers) {
        counts[p] = (counts[p] ?? 0) + 1;
      }
    }
    return counts;
  }, [events]);

  const mergedCount = useMemo(() => events.filter((ev) => ev.snapshots.length > 1).length, [events]);

  const lastJobFailed = dashboard?.lastJob?.status === 'FAILED';

  function refreshAll() {
    void loadEvents();
    void loadStatus();
  }

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Vue d'ensemble</p>
          <h2>Accueil</h2>
        </div>
        <div className="actions-row">
          <button className="button button-secondary" onClick={() => setCleanupOpen(true)}>
            Nettoyage événements
          </button>
        </div>
      </header>

      <AlertBanner
        lastJobFailed={lastJobFailed}
        lastJobError={dashboard?.lastJob?.errorMessage ?? null}
        pendingSuggestions={pendingSuggestions}
      />

      {/* Status strip — condensed from the old Dashboard page */}
      <div className="status-strip">
        <div className="status-tile">
          <span className="status-tile-label">Provider</span>
          <span className="status-tile-value">
            {dashboard?.provider?.configured ? dashboard?.provider?.displayName ?? 'Configuré' : 'Non configuré'}
          </span>
        </div>
        <div className="status-tile">
          <span className="status-tile-label">Google Calendar</span>
          <span className="status-tile-value">{dashboard?.google?.connected ? 'Connecté' : 'Non connecté'}</span>
        </div>
        <div className="status-tile">
          <span className="status-tile-label">Scheduler</span>
          <span className="status-tile-value">
            {dashboard?.settings?.syncEnabled ? 'Actif' : 'Désactivé'}
          </span>
        </div>
        <div className="status-tile">
          <span className="status-tile-label">Dernier job</span>
          <span className="status-tile-value">
            {dashboard?.lastJob ? `${dashboard.lastJob.status} — ${formatDateTime(dashboard.lastJob.startedAt)}` : 'Aucun'}
          </span>
        </div>
      </div>

      <ErrorCallout message={error} />

      <div className="home-grid">
        <Panel title={`${MONTH_NAMES[month]} ${year}${loading ? ' — chargement...' : ` — ${visibleEvents.length} evenement(s)`}`}>
          <div className="cal-nav">
            <button className="button button-secondary" onClick={prevMonth}>&lsaquo; Precedent</button>
            <button className="button button-secondary" onClick={goToday}>Aujourd'hui</button>
            <button className="button button-secondary" onClick={nextMonth}>Suivant &rsaquo;</button>
          </div>

          <div className="form-grid" style={{ marginBottom: '0.75rem' }}>
            <label>
              Provider
              <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)}>
                <option value="all">Tous les providers</option>
                {Object.keys(providerCounts).length > 0
                  ? Object.keys(providerCounts).map((p) => (
                      <option key={p} value={p}>{PROVIDER_LABELS[p] ?? p}</option>
                    ))
                  : (['myges', 'myefrei', 'ensup', 'generic'] as const).map((p) => (
                      <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                    ))}
              </select>
            </label>
          </div>

          {selectedProvider === 'all' && Object.keys(providerCounts).length > 0 && (
            <div className="stats-inline" style={{ marginTop: 0, marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
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
                  onClick={() => setSelectedProvider(p)}
                  title={`Filtrer sur ${PROVIDER_LABELS[p] ?? p}`}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: providerColor(p), display: 'inline-block',
                  }} />
                  {PROVIDER_LABELS[p] ?? p} — {count}
                </span>
              ))}
              {mergedCount > 0 && (
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    fontSize: '0.82rem', padding: '0.2rem 0.5rem',
                    borderRadius: 4, background: 'rgba(79,70,229,0.1)',
                    color: 'var(--accent-dark)', fontWeight: 600,
                    border: '1px solid rgba(79,70,229,0.3)',
                  }}
                  title="Evenements rapprochés entre plusieurs providers"
                >
                  {mergedCount} rapproché(s)
                </span>
              )}
            </div>
          )}

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
                    {dayEvents.slice(0, 3).map(ev => {
                      const merged = ev.snapshots.length > 1;
                      const color = providerColor(primaryProvider(ev));
                      return (
                        <button
                          key={ev.id}
                          className="cal-event"
                          style={{
                            background: color,
                            boxShadow: merged ? `0 0 0 2px #fff, 0 0 0 3px ${color}` : undefined,
                          }}
                          onClick={() => setSelectedId(ev.id)}
                          title={`[${merged ? 'Rapproché · ' : ''}${PROVIDER_LABELS[primaryProvider(ev)] ?? primaryProvider(ev)}] ${formatTime(ev.startAt)} ${ev.title}`}
                        >
                          {formatTime(ev.startAt)} {ev.title}{merged ? ` (×${ev.snapshots.length})` : ''}
                        </button>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <span className="cal-more">+{dayEvents.length - 3} autres</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <ActivityPanel pendingSuggestions={pendingSuggestions} />
      </div>

      <EventDetailPanel
        globalEventId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={refreshAll}
      />

      {cleanupOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 8, padding: '1.5rem',
            maxWidth: 480, width: '90%', boxShadow: '0 8px 32px rgba(15,23,42,0.2)',
          }}>
            <h3 style={{ marginTop: 0 }}>Nettoyage des événements</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              Supprime des événements du snapshot pour un provider. Les événements supprimés ne peuvent pas être restaurés sans re-synchronisation.
            </p>

            <div className="form-grid" style={{ marginTop: '0.75rem' }}>
              <label>
                Provider
                <select value={cleanupProvider} onChange={(e) => setCleanupProvider(e.target.value)}>
                  <option value="">— Choisir —</option>
                  {(['myges', 'myefrei', 'ensup', 'generic'] as const).map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
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

            {cleanupError && <p style={{ color: 'var(--error)', marginTop: '0.5rem', fontSize: '0.85rem' }}>{cleanupError}</p>}
            {cleanupResult && <p style={{ color: 'var(--success)', marginTop: '0.5rem', fontSize: '0.85rem' }}>{cleanupResult}</p>}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="button button-secondary" onClick={() => {
                setCleanupOpen(false);
                setCleanupResult(null);
                setCleanupError(null);
              }}>Fermer</button>
              <button
                className="button"
                style={{ background: 'var(--error)', borderColor: 'var(--error)' }}
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
