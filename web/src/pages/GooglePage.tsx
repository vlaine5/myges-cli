import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel, StatusBadge, SuccessCallout } from '../components/Ui';
import { formatDateTime } from '../lib/format';

const GOOGLE_PROVIDERS = [
  { id: 'myges', label: 'MyGES' },
  { id: 'myefrei', label: 'myEfrei' },
  { id: 'ensup', label: 'Ensup' },
] as const;

export function GooglePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<any | null>(null);
  const [oauthConfig, setOauthConfig] = useState<any | null>(null);
  const [calendars, setCalendars] = useState<any[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<'myges' | 'myefrei' | 'ensup'>('myges');
  const [newCalendarName, setNewCalendarName] = useState('Academic Sync - MyGES');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(
    searchParams.get('status') === 'connected' ? 'Connexion Google reussie.' : null,
  );
  // OAuth config form (hidden by default)
  const [showOauthForm, setShowOauthForm] = useState(false);
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [oauthRedirectUrl, setOauthRedirectUrl] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [googleStatus, config] = await Promise.all([
        api.getGoogleStatus(),
        api.getGoogleConfig(),
      ]) as [any, any];
      setStatus(googleStatus);
      setOauthConfig(config);
      setOauthRedirectUrl(config?.redirectUrl ?? `${window.location.origin}/api/google/oauth/callback`);
      if (googleStatus.connected) {
        setCalendars(await api.listGoogleCalendars() as any[]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger Google.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (searchParams.get('status')) {
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const label = GOOGLE_PROVIDERS.find((p) => p.id === selectedProvider)?.label ?? selectedProvider;
    setNewCalendarName(`Academic Sync - ${label}`);
  }, [selectedProvider]);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.startGoogleOAuth() as { authUrl: string };
      window.location.href = result.authUrl;
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Impossible de demarrer OAuth.');
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.disconnectGoogle();
      setSuccess('Connexion Google supprimee.');
      await load();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Deconnexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCalendar() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.createGoogleCalendar({
        provider: selectedProvider,
        summary: newCalendarName,
        timeZone: 'Europe/Paris',
      });
      setSuccess(`Calendrier Google cree pour ${selectedProvider}.`);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Creation impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectCalendar(calendarId: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.selectGoogleCalendar({ provider: selectedProvider, calendarId });
      setSuccess(`Calendrier selectionne pour ${selectedProvider}.`);
      await load();
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : 'Selection impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveOauthConfig() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.saveGoogleConfig({
        clientId: oauthClientId.trim(),
        clientSecret: oauthClientSecret.trim(),
        redirectUrl: oauthRedirectUrl.trim(),
      });
      setSuccess('Credentials OAuth enregistres.');
      setShowOauthForm(false);
      setOauthClientId('');
      setOauthClientSecret('');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingBlock label="Chargement de Google Calendar..." />;
  }

  const configured: boolean = status?.configured ?? false;
  const connected: boolean = status?.connected ?? false;
  const selectedProviderCalendar = status?.providerCalendars?.[selectedProvider] ?? { calendarId: null, calendarSummary: null };

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Synchronisation agenda</p>
          <h2>Google Calendar</h2>
        </div>
        <button className="button button-secondary" onClick={() => void load()}>
          Rafraichir
        </button>
      </header>

      <ErrorCallout message={error} />
      <SuccessCallout message={success} />

      {/* === CAS : NON CONFIGURE === */}
      {!configured ? (
        <Panel title="Configuration requise">
          <p style={{ marginBottom: '1rem' }}>
            Pour connecter Google Calendar, tu dois d'abord renseigner les credentials OAuth Google (Client ID + Client Secret).
            Cree une application OAuth sur <strong>console.cloud.google.com</strong>, active l'API Google Calendar,
            puis colle les credentials ici. C'est une operation unique.
          </p>
          <div className="form-grid">
            <label className="full-width">
              Client ID
              <input
                value={oauthClientId}
                onChange={(e) => setOauthClientId(e.target.value)}
                placeholder="123456789-abc...apps.googleusercontent.com"
                disabled={busy}
              />
            </label>
            <label className="full-width">
              Client Secret
              <input
                type="password"
                value={oauthClientSecret}
                onChange={(e) => setOauthClientSecret(e.target.value)}
                placeholder="GOCSPX-..."
                disabled={busy}
              />
            </label>
            <label className="full-width">
              URL de redirection (a declarer aussi dans Google Cloud)
              <input
                value={oauthRedirectUrl}
                onChange={(e) => setOauthRedirectUrl(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <div className="actions-row">
            <button
              className="button"
              disabled={busy || !oauthClientId || !oauthClientSecret}
              onClick={() => void handleSaveOauthConfig()}
            >
              Enregistrer et continuer
            </button>
          </div>
        </Panel>
      ) : (
        <>
          {/* === CAS : CONFIGURE === */}
          <Panel title={connected ? `Connecte : ${status?.connectedEmail ?? ''}` : 'Non connecte'}>
            <StatusBadge tone={connected ? 'ok' : 'warn'}>
              {connected ? 'Connecte' : 'Non connecte'}
            </StatusBadge>
            {connected ? (
              <>
                <p className="meta-line">Token expire: {formatDateTime(status?.tokenExpiresAt)}</p>
                <div className="meta-block">
                  <strong>Calendriers par provider</strong>
                  {GOOGLE_PROVIDERS.map((provider) => {
                    const cal = status?.providerCalendars?.[provider.id];
                    return (
                      <p key={provider.id} className="meta-line">
                        {provider.label}: {cal?.calendarSummary ?? cal?.calendarId ?? 'Non selectionne'}
                      </p>
                    );
                  })}
                </div>
                <div className="actions-row">
                  <button className="button button-secondary" disabled={busy} onClick={() => void handleConnect()}>
                    Reconnecter
                  </button>
                  <button className="button button-secondary" disabled={busy} onClick={() => void handleDisconnect()}>
                    Deconnecter
                  </button>
                </div>
              </>
            ) : (
              <div style={{ marginTop: '1rem' }}>
                <button
                  className="button"
                  disabled={busy}
                  style={{ fontSize: '1rem', padding: '0.75rem 2rem' }}
                  onClick={() => void handleConnect()}
                >
                  Connecter avec Google
                </button>
              </div>
            )}
            <button
              className="button button-secondary"
              style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}
              onClick={() => setShowOauthForm((v) => !v)}
            >
              {showOauthForm ? 'Masquer les credentials' : 'Modifier les credentials OAuth'}
            </button>
          </Panel>

          {showOauthForm ? (
            <Panel title="Modifier les credentials OAuth">
              <div className="form-grid">
                <label className="full-width">
                  Client ID
                  <input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} placeholder="(inchange)" disabled={busy} />
                </label>
                <label className="full-width">
                  Client Secret
                  <input type="password" value={oauthClientSecret} onChange={(e) => setOauthClientSecret(e.target.value)} placeholder="(inchange)" disabled={busy} />
                </label>
                <label className="full-width">
                  URL de redirection
                  <input value={oauthRedirectUrl} onChange={(e) => setOauthRedirectUrl(e.target.value)} disabled={busy} />
                </label>
              </div>
              <p className="meta-line">Source actuelle: {oauthConfig?.source} — {oauthConfig?.clientIdHint}</p>
              <div className="actions-row">
                <button className="button" disabled={busy || !oauthClientId || !oauthClientSecret} onClick={() => void handleSaveOauthConfig()}>
                  Enregistrer
                </button>
              </div>
            </Panel>
          ) : null}

          {/* === Sélection du calendrier (si connecté) === */}
          {connected ? (
            <>
              <Panel title="Provider cible">
                <div className="form-grid">
                  <label>
                    Provider
                    <select value={selectedProvider} disabled={busy} onChange={(e) => setSelectedProvider(e.target.value as 'myges' | 'myefrei' | 'ensup')}>
                      {GOOGLE_PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="meta-line">
                  Calendrier selectionne: {selectedProviderCalendar.calendarSummary ?? selectedProviderCalendar.calendarId ?? 'Aucun'}
                </p>
              </Panel>

              <Panel title="Choisir un calendrier existant">
                <div className="list-grid">
                  {calendars.map((calendar) => (
                    <button
                      key={calendar.id}
                      className={selectedProviderCalendar.calendarId === calendar.id ? 'list-card selected' : 'list-card'}
                      onClick={() => void handleSelectCalendar(calendar.id)}
                    >
                      <strong>{calendar.summary}</strong>
                      <span>{calendar.id}</span>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Creer un nouveau calendrier">
                <div className="form-grid two-columns">
                  <label>
                    Nom
                    <input value={newCalendarName} onChange={(e) => setNewCalendarName(e.target.value)} />
                  </label>
                </div>
                <div className="actions-row">
                  <button className="button" disabled={busy} onClick={() => void handleCreateCalendar()}>
                    Creer et selectionner
                  </button>
                </div>
              </Panel>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
