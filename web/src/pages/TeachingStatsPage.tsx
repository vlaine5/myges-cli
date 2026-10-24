import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel } from '../components/Ui';

interface TeachingRow {
  provider: string;
  label: string;
  subject: string;
  studentCount: number | null;
  hours: number;
  sessionCount: number;
  firstSeen: string;
  lastSeen: string;
}

interface TeachingStats {
  period: { start: string; end: string };
  totalHours: number;
  totalEvents: number;
  availableSubjects: string[];
  rows: TeachingRow[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function toLocalDate(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function TeachingStatsPage() {
  const currentYear = new Date().getFullYear();
  const [stats, setStats] = useState<TeachingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`);
  const [endDate, setEndDate] = useState(toLocalDate(new Date().toISOString()));
  const [provider, setProvider] = useState('');
  const [subject, setSubject] = useState('');

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const result = await api.getTeachingStats({
        start: startDate ? new Date(startDate).toISOString() : undefined,
        end: endDate ? new Date(`${endDate}T23:59:59`).toISOString() : undefined,
        provider: provider || undefined,
        subject: subject || undefined,
      }) as TeachingStats;
      setStats(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les statistiques.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Chargement initial uniquement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Activité formation</p>
          <h2>Heures d&apos;enseignement</h2>
        </div>
        <button className="button button-secondary" onClick={() => void load()}>
          Rafraichir
        </button>
      </header>

      <ErrorCallout message={error} />

      <Panel title="Période">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="meta-line">Du</span>
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="meta-line">Au</span>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="meta-line">Provider</span>
            <select className="input" value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="">Tous</option>
              <option value="myges">MyGES</option>
              <option value="myefrei">myEfrei</option>
              <option value="ensup">Ensup (HyperPlanning)</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '18rem' }}>
            <span className="meta-line">Matière</span>
            <select className="input" value={subject} onChange={(event) => setSubject(event.target.value)}>
              <option value="">Toutes</option>
              {stats?.availableSubjects?.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button className="button" onClick={() => void load()}>
            Appliquer
          </button>
        </div>
      </Panel>

      {loading ? (
        <LoadingBlock label="Calcul des heures..." />
      ) : stats ? (
        <>
          <div className="stats-grid">
            <Panel title="Total heures">
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>
                {stats.totalHours.toFixed(1)} h
              </p>
              <p className="meta-line">
                {stats.totalEvents} événement(s) — {formatDate(stats.period.start)} → {formatDate(stats.period.end)}
              </p>
            </Panel>
            <Panel title="Classes distinctes">
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>
                {new Set(stats.rows.map((r) => `${r.provider}::${r.label}`)).size}
              </p>
              <p className="meta-line">groupes / promotions ({stats.rows.length} ligne(s) classe×matière)</p>
            </Panel>
            <Panel title="Étudiants total">
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>
                {stats.rows.reduce((sum, row) => sum + (row.studentCount ?? 0), 0)}
              </p>
              <p className="meta-line">somme des effectifs par classe</p>
            </Panel>
          </div>

          <Panel title="Détail par classe">
            {stats.rows.length === 0 ? (
              <p className="muted">Aucune donnée sur cette période. Lancez une synchronisation d&apos;abord.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Provider</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Classe / Groupe</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Matière</th>
                      <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Étudiants</th>
                      <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Heures</th>
                      <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Séances</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Dernière séance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.rows.map((row) => (
                      <tr key={`${row.provider}-${row.label}-${row.subject}`} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: 'var(--muted)' }}>{row.provider}</td>
                        <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{row.label}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{row.subject}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                          {row.studentCount !== null ? row.studentCount : <span className="muted">—</span>}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700 }}>{row.hours.toFixed(1)} h</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>{row.sessionCount}</td>
                        <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: 'var(--muted)' }}>{formatDate(row.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                      <td colSpan={4} style={{ padding: '0.5rem 0.75rem' }}>Total</td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>{stats.totalHours.toFixed(1)} h</td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                        {stats.rows.reduce((sum, row) => sum + row.sessionCount, 0)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
