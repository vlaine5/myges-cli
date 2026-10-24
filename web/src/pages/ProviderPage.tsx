import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel, StatusBadge, SuccessCallout } from '../components/Ui';
import { formatDateTime } from '../lib/format';

type ProviderId = 'myges' | 'myefrei' | 'ensup';

export function ProviderPage() {
  const [settings, setSettings] = useState<any | null>(null);
  const [status, setStatus] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sessionCookie, setSessionCookie] = useState('');
  const [agendaEndpoint, setAgendaEndpoint] = useState('');
  const [icsUrl, setIcsUrl] = useState('');
  const [hasStoredIcsUrl, setHasStoredIcsUrl] = useState(false);
  const [icsSyncing, setIcsSyncing] = useState(false);
  const [icsResult, setIcsResult] = useState<string | null>(null);

  const provider = (settings?.provider ?? 'myges') as ProviderId;

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const settingsResult = await api.getSettings();
      setSettings(settingsResult);
      const providerStatus = await api.getProviderStatus(settingsResult.provider as ProviderId);
      setStatus(providerStatus);
      setAgendaEndpoint(String((providerStatus as any).config?.agendaEndpoint ?? ''));
      setIcsUrl('');
      setHasStoredIcsUrl(Boolean((providerStatus as any).config?.hasIcsUrl));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger le provider.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function changeProvider(nextProvider: ProviderId) {
    if (!settings) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await api.saveSettings({
        ...settings,
        provider: nextProvider,
      });
      setSettings(updated);
      const providerStatus = await api.getProviderStatus(nextProvider);
      setStatus(providerStatus);
      setUsername('');
      setPassword('');
      setSessionCookie('');
      setAgendaEndpoint(String((providerStatus as any).config?.agendaEndpoint ?? ''));
      setIcsUrl('');
      setHasStoredIcsUrl(Boolean((providerStatus as any).config?.hasIcsUrl));
      setSuccess(`Provider actif change vers ${nextProvider}.`);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Changement de provider impossible.');
    } finally {
      setSubmitting(false);
    }
  }

  function buildPayload() {
    if (provider === 'myges') {
      return {
        username,
        password,
      };
    }

    return {
      username: username || undefined,
      password: password || undefined,
      sessionCookie: sessionCookie || undefined,
      config: {
        agendaEndpoint: agendaEndpoint || undefined,
      },
    };
  }

  async function handleIcsSync() {
    if (!icsUrl) return;
    setIcsSyncing(true);
    setIcsResult(null);
    setError(null);
    try {
      const result = await api.syncFromIcs({ provider, icsUrl }) as any;
      setHasStoredIcsUrl(true);
      setIcsUrl('');
      setIcsResult(
        `Sync ICS OK — ${result.fetched} evenements recus, ${result.upserted} mis a jour, ${result.deletedFuture} futurs supprimes, ${result.cancelled} annules.`,
      );
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Sync ICS impossible.');
    } finally {
      setIcsSyncing(false);
    }
  }

  async function handleTest() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await api.testProvider(provider, buildPayload());
      setSuccess(`Connexion ${provider} valide.`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Test de connexion impossible.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      // For myefrei/ensup: if only agendaEndpoint is set (no credentials), use patchConfig
      const isEndpointOnlyUpdate =
        provider !== 'myges' &&
        !sessionCookie &&
        !password &&
        agendaEndpoint;

      if (isEndpointOnlyUpdate) {
        const result = await api.patchProviderConfig(provider, {
          agendaEndpoint: agendaEndpoint || null,
        }) as { ok: boolean; status: any };
        setStatus(result.status);
        setSuccess(`Endpoint ${provider} mis a jour.`);
      } else {
        const result = await api.saveProvider(provider, buildPayload()) as { ok: boolean; status: any };
        setStatus(result.status);
        setPassword('');
        setSessionCookie('');
        setHasStoredIcsUrl(Boolean((result.status as any)?.config?.hasIcsUrl));
        setSuccess(`Configuration ${provider} enregistree.`);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Enregistrement impossible.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !settings) {
    return <LoadingBlock label="Chargement de la configuration provider..." />;
  }

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Source academique</p>
          <h2>Provider</h2>
        </div>
      </header>

      <Panel title="Provider actif">
        <div className="form-grid">
          <label>
            Provider
            <select
              value={provider}
              disabled={submitting}
              onChange={(event) => void changeProvider(event.target.value as ProviderId)}
            >
              <option value="myges">myges</option>
              <option value="myefrei">myefrei</option>
              <option value="ensup">ensup (HyperPlanning)</option>
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="Etat actuel">
        <StatusBadge tone={status?.configured ? 'ok' : 'warn'}>
          {status?.configured ? 'Configure' : 'Non configure'}
        </StatusBadge>
        <p className="meta-line">Provider: {status?.displayName ?? provider}</p>
        <p className="meta-line">Mode auth: {status?.authMode ?? 'N/A'}</p>
        <p className="meta-line">
          Identifiants sauvegardes: {status?.hasSavedCredentials ? 'Oui' : 'Non'}
        </p>
        <p className="meta-line">Dernier login: {formatDateTime(status?.lastLoginAt)}</p>
        <p className="meta-line">Derniere erreur: {status?.lastLoginError ?? 'N/A'}</p>
        {status?.limitations?.length ? (
          <div className="meta-block">
            <strong>Limitations</strong>
            {status.limitations.map((item: string) => (
              <p key={item} className="meta-line">
                {item}
              </p>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel title="Configuration provider">
        <ErrorCallout message={error} />
        <SuccessCallout message={success} />

        <div className="form-grid">
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {provider === 'myefrei' ? (
            <>
              <label className="full-width">
                Session cookie
                <textarea
                  value={sessionCookie}
                  onChange={(event) => setSessionCookie(event.target.value)}
                  rows={5}
                />
              </label>
              <p className="meta-line">
                Colle le header `Cookie` du navigateur pour `www.myefrei.fr`, avec au minimum `myefrei.sid=...`.
              </p>
              <label className="full-width">
                Agenda endpoint
                <input
                  value={agendaEndpoint}
                  onChange={(event) => setAgendaEndpoint(event.target.value)}
                  placeholder="https://www.myefrei.fr/api/..."
                />
              </label>
              <p className="meta-line">
                Pour trouver l endpoint agenda, ouvre myEfrei connecte, filtre `Fetch/XHR` dans DevTools Network, recharge la page agenda, puis copie l URL de la requete JSON qui renvoie les cours.
              </p>
            </>
          ) : null}

          {provider === 'ensup' ? (
            <>
              <label className="full-width">
                Session cookie
                <textarea
                  value={sessionCookie}
                  onChange={(event) => setSessionCookie(event.target.value)}
                  rows={5}
                />
              </label>
              <p className="meta-line">
                Colle le header `Cookie` de ton navigateur apres connexion sur extranet-hp-sqy.ensup.eu (espace enseignants). Cherche les cookies `HPSessionID` ou `ASP.NET_SessionId`.
              </p>
              <label className="full-width">
                Agenda endpoint (URL JSON planning)
                <input
                  value={agendaEndpoint}
                  onChange={(event) => setAgendaEndpoint(event.target.value)}
                  placeholder="https://extranet-hp-sqy.ensup.eu/..."
                />
              </label>
              <p className="meta-line">
                Dans DevTools (onglet Network, filtre XHR/Fetch), connecte-toi sur l espace enseignant HyperPlanning et repere la requete qui retourne ton planning en JSON. Copie cette URL ici.
              </p>
            </>
          ) : null}
        </div>

        <div className="actions-row">
          <button className="button button-secondary" disabled={submitting} onClick={() => void handleTest()}>
            Tester la connexion
          </button>
          <button className="button" disabled={submitting} onClick={() => void handleSave()}>
            Enregistrer
          </button>
        </div>
      </Panel>

      <Panel title="Lien ICS (optionnel)">
        <p className="meta-line">
          Si le provider propose un lien ICS public (ex: myEfrei), tu peux le coller ici pour synchroniser ton agenda.
          Les evenements passes sont conserves meme s'ils disparaissent du flux ICS.
          Les evenements futurs qui changent ou sont supprimes du flux seront mis a jour.
        </p>
        <div className="form-grid">
          <label className="full-width">
            URL ICS
            <input
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder="https://..."
              disabled={icsSyncing}
            />
          </label>
        </div>
        {icsResult ? <p className="meta-line" style={{ color: 'var(--ok)' }}>{icsResult}</p> : null}
        {hasStoredIcsUrl && !icsUrl ? (
          <p className="meta-line">Une URL ICS est déjà enregistrée. Colle une nouvelle URL seulement si tu veux la remplacer.</p>
        ) : null}
        <div className="actions-row">
          <button
            className="button"
            disabled={icsSyncing || !icsUrl}
            onClick={() => void handleIcsSync()}
          >
            {icsSyncing ? 'Synchronisation...' : 'Synchroniser depuis ICS'}
          </button>
        </div>
      </Panel>
    </div>
  );
}
