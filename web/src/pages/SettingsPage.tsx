import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel, SuccessCallout } from '../components/Ui';
import { formatDateTime } from '../lib/format';

export function SettingsPage() {
  const [settings, setSettings] = useState<any | null>(null);
  const [latestIcs, setLatestIcs] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [settingsResult, lastExport] = await Promise.all([
        api.getSettings(),
        api.getLatestIcsExport(),
      ]);
      setSettings(settingsResult);
      setLatestIcs(lastExport);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les parametres.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await api.saveSettings(settings);
      setSuccess('Parametres sauvegardes.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Sauvegarde impossible.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) {
    return <LoadingBlock label="Chargement des parametres..." />;
  }

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Configuration globale</p>
          <h2>Parametres</h2>
        </div>
      </header>

      <ErrorCallout message={error} />
      <SuccessCallout message={success} />

      <Panel title="Synchronisation">
        <p className="meta-line">
          Les jours et heures de synchronisation de chaque provider se règlent dans{' '}
          <Link to="/planification">Planification</Link>.
        </p>
        <div className="form-grid">
          <label>
            Provider actif
            <select
              value={settings.provider}
              onChange={(event) => setSettings({ ...settings, provider: event.target.value })}
            >
              <option value="myges">myges</option>
              <option value="myefrei">myefrei</option>
              <option value="ensup">ensup</option>
            </select>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.googleSyncEnabled}
              onChange={(event) =>
                setSettings({ ...settings, googleSyncEnabled: event.target.checked })
              }
            />
            Activer la sync Google
          </label>
          <label>
            Lookback days
            <input
              type="number"
              value={settings.syncLookbackDays}
              onChange={(event) =>
                setSettings({ ...settings, syncLookbackDays: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Future days
            <input
              type="number"
              value={settings.syncFutureDays}
              onChange={(event) =>
                setSettings({ ...settings, syncFutureDays: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Timezone
            <input
              value={settings.timezone}
              onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}
            />
          </label>
        </div>
      </Panel>

      <Panel title="Export et debug">
        <div className="form-grid">
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.runSyncOnStartup}
              onChange={(event) =>
                setSettings({ ...settings, runSyncOnStartup: event.target.checked })
              }
            />
            Lancer une sync des providers planifies au demarrage
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.saveLastIcs}
              onChange={(event) => setSettings({ ...settings, saveLastIcs: event.target.checked })}
            />
            Sauvegarder le dernier ICS
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.storeRawPayload}
              onChange={(event) =>
                setSettings({ ...settings, storeRawPayload: event.target.checked })
              }
            />
            Stocker le raw payload
          </label>
          <label>
            Niveau de log
            <select
              value={settings.logLevel}
              onChange={(event) => setSettings({ ...settings, logLevel: event.target.value })}
            >
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </label>
        </div>

        <div className="meta-block">
          <strong>Dernier export ICS</strong>
          <p>{latestIcs ? `${latestIcs.path} - ${formatDateTime(latestIcs.generatedAt)}` : 'Aucun export.'}</p>
        </div>

        <div className="actions-row">
          <button className="button" disabled={saving} onClick={() => void handleSave()}>
            Enregistrer
          </button>
        </div>
      </Panel>
    </div>
  );
}
