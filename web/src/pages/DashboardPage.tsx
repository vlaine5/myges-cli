import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { ErrorCallout, LoadingBlock, Panel, StatusBadge } from '../components/Ui';

export function DashboardPage() {
  const [data, setData] = useState<any | null>(null);
  const [teaching, setTeaching] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const currentYear = new Date().getFullYear();
      const [dashboard, teachingStats] = await Promise.all([
        api.getDashboard(),
        api.getTeachingStats({
          start: `${currentYear}-01-01T00:00:00.000Z`,
        }),
      ]);
      setData(dashboard);
      setTeaching(teachingStats);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger le dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return <LoadingBlock label="Chargement du dashboard..." />;
  }

  const activeProviderId = data?.provider?.provider;
  const activeProviderCalendar = activeProviderId
    ? data?.google?.providerCalendars?.[activeProviderId]
    : null;

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Vue d’ensemble</p>
          <h2>Dashboard</h2>
        </div>
        <button className="button button-secondary" onClick={() => void load()}>
          Rafraichir
        </button>
      </header>

      <ErrorCallout message={error} />

      <div className="stats-grid">
        <Panel title="Provider academique">
          <StatusBadge tone={data?.provider?.configured ? 'ok' : 'warn'}>
            {data?.provider?.configured ? 'Configure' : 'Non configure'}
          </StatusBadge>
          <p className="meta-line">Provider: {data?.provider?.displayName ?? 'N/A'}</p>
          <p className="meta-line">
            Identifiants sauvegardes: {data?.provider?.hasSavedCredentials ? 'Oui' : 'Non'}
          </p>
          <p className="meta-line">Dernier login: {formatDateTime(data?.provider?.lastLoginAt)}</p>
        </Panel>

        <Panel title="Google Calendar">
          <StatusBadge tone={data?.google?.connected ? 'ok' : 'warn'}>
            {data?.google?.connected ? 'Connecte' : 'Non connecte'}
          </StatusBadge>
          <p className="meta-line">
            Calendrier actif: {activeProviderCalendar?.calendarSummary ?? activeProviderCalendar?.calendarId ?? 'N/A'}
          </p>
          <p className="meta-line">Expiration token: {formatDateTime(data?.google?.tokenExpiresAt)}</p>
        </Panel>

        <Panel title="Scheduler">
          <StatusBadge tone={data?.settings?.syncEnabled ? 'ok' : 'muted'}>
            {data?.settings?.syncEnabled ? 'Actif' : 'Desactive'}
          </StatusBadge>
          <p className="meta-line">Prochain run: {formatDateTime(data?.scheduler?.nextRunAt)}</p>
          <p className="meta-line">Run au demarrage: {data?.settings?.runSyncOnStartup ? 'Oui' : 'Non'}</p>
        </Panel>

        <Panel title="Heures d'enseignement">
          <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>
            {teaching?.totalHours?.toFixed?.(1) ?? '0.0'} h
          </p>
          <p className="meta-line">
            {teaching?.totalEvents ?? 0} séance(s) sur la période courante
          </p>
        </Panel>
      </div>

      <Panel title="Dernier job">
        {data?.lastJob ? (
          <div className="detail-grid">
            <div>
              <strong>Statut</strong>
              <p>{data.lastJob.status}</p>
            </div>
            <div>
              <strong>Debut</strong>
              <p>{formatDateTime(data.lastJob.startedAt)}</p>
            </div>
            <div>
              <strong>Fin</strong>
              <p>{formatDateTime(data.lastJob.finishedAt)}</p>
            </div>
            <div>
              <strong>Provider</strong>
              <p>{data.lastJob.provider}</p>
            </div>
            <div>
              <strong>Resultat</strong>
              <p>{data.lastJob.summary ?? data.lastJob.errorMessage ?? 'N/A'}</p>
            </div>
          </div>
        ) : (
          <p className="muted">Aucun job enregistre.</p>
        )}
      </Panel>

      <Panel title="Top classes">
        {teaching?.rows?.length ? (
          <div className="list-grid">
            {teaching.rows.slice(0, 5).map((row: any) => (
              <div key={`${row.provider}-${row.label}`} className="list-card">
                <strong>{row.label}</strong>
                <span>{row.provider}</span>
                <span>{row.hours.toFixed(1)} h</span>
                <span>{row.studentCount ?? '—'} étudiant(s)</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Aucune donnée d'enseignement disponible.</p>
        )}
      </Panel>
    </div>
  );
}
