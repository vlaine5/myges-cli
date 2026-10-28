import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel, StatusBadge, SuccessCallout } from '../components/Ui';
import { formatDateTime } from '../lib/format';
import type {
  NotificationLogEntry,
  NotificationSettings,
  NotificationSettingsInput,
  SmtpSecurity,
  WebhookFormat,
} from '../lib/types';

const DEFAULT_PORTS: Record<SmtpSecurity, number> = { starttls: 587, tls: 465, none: 25 };

const PROVIDER_LABELS: Record<string, string> = { myges: 'MyGES', myefrei: 'myEfrei', ensup: 'Ensup' };

type Draft = NotificationSettingsInput;

const FIELD_LABELS: Record<string, string> = {
  smtpHost: 'Serveur SMTP',
  smtpPort: 'Port',
  smtpUser: 'Identifiant',
  emailFrom: 'Expéditeur',
  emailTo: 'Destinataires',
  webhookUrl: 'URL du webhook',
  horizonDays: 'Prochains jours',
};

/** The server's per-field reasons, rather than its generic "validation failed". */
function describeError(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
    const fieldErrors = (error.details as { fieldErrors?: Record<string, string[]> } | null)?.fieldErrors ?? {};
    const reasons = Object.entries(fieldErrors).map(
      ([field, messages]) => `${FIELD_LABELS[field] ?? field} : ${messages[0] ?? 'valeur invalide'}`,
    );
    if (reasons.length > 0) return `Vérifie le formulaire. ${reasons.join(' · ')}`;
  }
  return error instanceof Error ? error.message : fallback;
}

function isWithin(value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function toDraft(settings: NotificationSettings): Draft {
  const { smtpPasswordSet, webhookUrlSet, webhookUrlHint, ...rest } = settings;
  void smtpPasswordSet;
  void webhookUrlSet;
  void webhookUrlHint;
  return { ...rest, smtpPassword: '', webhookUrl: '' };
}

export function NotificationsPage() {
  const [saved, setSaved] = useState<NotificationSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [log, setLog] = useState<NotificationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'email' | 'webhook' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function refreshLog() {
    setLog(await api.listNotificationLog());
  }

  useEffect(() => {
    void (async () => {
      try {
        const [settings] = await Promise.all([api.getNotificationSettings(), refreshLog()]);
        setSaved(settings);
        setDraft(toDraft(settings));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les notifications.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <LoadingBlock label="Chargement des notifications..." />;
  }
  if (!draft || !saved) {
    return <ErrorCallout message={error ?? 'Impossible de charger les notifications.'} />;
  }

  function update(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function save() {
    if (!draft) return;
    setBusy('save');
    setError(null);
    setSuccess(null);
    try {
      const result = await api.saveNotificationSettings(draft);
      setSaved(result);
      setDraft(toDraft(result));
      setSuccess('Notifications enregistrées.');
    } catch (saveError) {
      setError(describeError(saveError, 'Enregistrement impossible.'));
    } finally {
      setBusy(null);
    }
  }

  /** Deletes a stored secret from the saved settings, leaving other pending edits unsaved. */
  async function removeSecret(secret: 'webhook' | 'password') {
    if (!saved) return;
    setBusy('save');
    setError(null);
    setSuccess(null);
    try {
      const result = await api.saveNotificationSettings({
        ...toDraft(saved),
        ...(secret === 'webhook' ? { webhookUrl: null, webhookEnabled: false } : { smtpPassword: null }),
      });
      setSaved(result);
      update(secret === 'webhook' ? { webhookUrl: '', webhookEnabled: false } : { smtpPassword: '' });
      setSuccess(secret === 'webhook' ? 'URL du webhook supprimée.' : 'Mot de passe SMTP supprimé.');
    } catch (removeError) {
      setError(describeError(removeError, 'Suppression impossible.'));
    } finally {
      setBusy(null);
    }
  }

  async function sendTest(channel: 'email' | 'webhook') {
    setBusy(channel);
    setError(null);
    setSuccess(null);
    try {
      await api.testNotification(channel);
      setSuccess(channel === 'email' ? 'E-mail de test envoyé.' : 'Webhook de test envoyé.');
    } catch (testError) {
      setError(describeError(testError, 'Envoi de test impossible.'));
    } finally {
      setBusy(null);
      void refreshLog().catch(() => undefined);
    }
  }

  const noneSelected = !draft.notifyAdded && !draft.notifyUpdated && !draft.notifyRemoved;
  const dirty =
    JSON.stringify({ ...draft, smtpPassword: '', webhookUrl: '' }) !== JSON.stringify(toDraft(saved)) ||
    Boolean(draft.smtpPassword) ||
    Boolean(draft.webhookUrl);
  const testHint = dirty ? 'Enregistre d’abord : le test utilise les réglages enregistrés.' : undefined;
  const horizonInvalid = !isWithin(draft.horizonDays, 1, 365);
  const portInvalid = !isWithin(draft.smtpPort, 1, 65535);

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Automatisation</p>
          <h2>Notifications</h2>
          <p className="muted page-intro">
            Après chaque synchronisation (manuelle ou <Link to="/planification">planifiée</Link>), le planning est
            comparé à celui d&apos;avant. S&apos;il a changé, tu reçois la liste des cours ajoutés, modifiés ou
            annulés. S&apos;il est identique, rien n&apos;est envoyé.
          </p>
        </div>
      </header>

      <ErrorCallout message={error} />
      <SuccessCallout message={success} />

      <Panel title="Quand notifier">
        <fieldset className="schedule-section">
          <legend>Changements à signaler</legend>
          <div className="notify-types">
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.notifyAdded}
                onChange={(event) => update({ notifyAdded: event.target.checked })}
              />
              Nouveaux cours
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.notifyUpdated}
                onChange={(event) => update({ notifyUpdated: event.target.checked })}
              />
              Cours modifiés (horaire, salle, intervenant…)
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.notifyRemoved}
                onChange={(event) => update({ notifyRemoved: event.target.checked })}
              />
              Cours annulés
            </label>
          </div>
          {noneSelected ? <p className="field-hint">Aucun type coché : aucune notification ne sera envoyée.</p> : null}
        </fieldset>
        <div className="horizon-field">
          <label>
            Ne signaler que les cours des prochains (jours)
            <input
              type="number"
              min={1}
              max={365}
              value={Number.isNaN(draft.horizonDays) ? '' : draft.horizonDays}
              aria-describedby="horizon-hint"
              aria-invalid={horizonInvalid}
              onChange={(event) => update({ horizonDays: event.target.valueAsNumber })}
            />
          </label>
          {horizonInvalid ? <p className="field-hint">Entre un nombre de jours entre 1 et 365.</p> : null}
          <p id="horizon-hint" className="field-note">
            Garde-le sous l&apos;horizon de synchronisation (<Link to="/settings">Paramètres</Link>, « Future days »)
            pour ne pas recevoir chaque jour les cours qui entrent simplement dans la fenêtre.
          </p>
        </div>
      </Panel>

      <div className="schedule-grid">
        <Panel
          title="E-mail"
          actions={
            <StatusBadge tone={saved.emailEnabled ? 'ok' : 'muted'}>{saved.emailEnabled ? 'Actif' : 'Inactif'}</StatusBadge>
          }
        >
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.emailEnabled}
              onChange={(event) => update({ emailEnabled: event.target.checked })}
            />
            Envoyer les changements par e-mail
          </label>
          <div className="form-grid">
            <label className="full-width">
              Serveur SMTP
              <input
                value={draft.smtpHost}
                placeholder="smtp.gmail.com"
                autoComplete="off"
                onChange={(event) => update({ smtpHost: event.target.value })}
              />
            </label>
            <label>
              Sécurité
              <select
                value={draft.smtpSecurity}
                onChange={(event) => {
                  const security = event.target.value as SmtpSecurity;
                  const portWasDefault = draft.smtpPort === DEFAULT_PORTS[draft.smtpSecurity];
                  update({ smtpSecurity: security, ...(portWasDefault ? { smtpPort: DEFAULT_PORTS[security] } : {}) });
                }}
              >
                <option value="starttls">STARTTLS (587)</option>
                <option value="tls">TLS / SSL (465)</option>
                <option value="none">Aucune (25)</option>
              </select>
            </label>
            <label>
              Port
              <input
                type="number"
                min={1}
                max={65535}
                value={Number.isNaN(draft.smtpPort) ? '' : draft.smtpPort}
                aria-invalid={portInvalid}
                onChange={(event) => update({ smtpPort: event.target.valueAsNumber })}
              />
              {portInvalid ? <span className="field-hint">Port entre 1 et 65535.</span> : null}
            </label>
            <label>
              Identifiant
              <input
                value={draft.smtpUser}
                autoComplete="off"
                onChange={(event) => update({ smtpUser: event.target.value })}
              />
            </label>
            <label>
              Mot de passe
              <input
                type="password"
                value={draft.smtpPassword ?? ''}
                autoComplete="new-password"
                placeholder={saved.smtpPasswordSet ? 'Enregistré (vide = inchangé)' : ''}
                onChange={(event) => update({ smtpPassword: event.target.value })}
              />
            </label>
            <label>
              Expéditeur
              <input
                type="email"
                value={draft.emailFrom}
                placeholder="planning@exemple.fr"
                onChange={(event) => update({ emailFrom: event.target.value })}
              />
            </label>
            <label>
              Destinataires
              <input
                value={draft.emailTo}
                placeholder="moi@exemple.fr, autre@exemple.fr"
                onChange={(event) => update({ emailTo: event.target.value })}
              />
            </label>
          </div>
          <p className="field-note">
            Gmail, Outlook : utilise un mot de passe d&apos;application, pas ton mot de passe habituel. Si tu changes
            de serveur ou d&apos;identifiant, ressaisis le mot de passe.
          </p>
          <div className="actions-row">
            <button
              className="button button-secondary"
              disabled={busy !== null || dirty || !saved.smtpHost}
              title={testHint}
              onClick={() => void sendTest('email')}
            >
              {busy === 'email' ? 'Envoi...' : 'Envoyer un e-mail de test'}
            </button>
            {saved.smtpPasswordSet ? (
              <button
                className="button button-secondary"
                disabled={busy !== null}
                onClick={() => void removeSecret('password')}
              >
                Supprimer le mot de passe
              </button>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Webhook"
          actions={
            <StatusBadge tone={saved.webhookEnabled ? 'ok' : 'muted'}>
              {saved.webhookEnabled ? 'Actif' : 'Inactif'}
            </StatusBadge>
          }
        >
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.webhookEnabled}
              onChange={(event) => update({ webhookEnabled: event.target.checked })}
            />
            Envoyer les changements à un webhook
          </label>
          <div className="form-grid">
            <label className="full-width">
              URL
              <input
                type="url"
                value={draft.webhookUrl ?? ''}
                autoComplete="off"
                placeholder={
                  saved.webhookUrlSet
                    ? `Enregistrée (${saved.webhookUrlHint ?? 'masquée'}) — laisser vide pour conserver`
                    : 'https://discord.com/api/webhooks/…'
                }
                onChange={(event) => update({ webhookUrl: event.target.value })}
              />
            </label>
            <label className="full-width">
              Format
              <select
                value={draft.webhookFormat}
                onChange={(event) => update({ webhookFormat: event.target.value as WebhookFormat })}
              >
                <option value="json">JSON détaillé (n8n, Home Assistant, script…)</option>
                <option value="discord">Discord</option>
                <option value="slack">Slack / Mattermost</option>
              </select>
            </label>
          </div>
          <p className="field-note">L&apos;URL est chiffrée et n&apos;est jamais réaffichée.</p>
          <div className="actions-row">
            <button
              className="button button-secondary"
              disabled={busy !== null || dirty || !saved.webhookUrlSet}
              title={testHint}
              onClick={() => void sendTest('webhook')}
            >
              {busy === 'webhook' ? 'Envoi...' : 'Envoyer un webhook de test'}
            </button>
            {saved.webhookUrlSet ? (
              <button
                className="button button-secondary"
                disabled={busy !== null}
                onClick={() => void removeSecret('webhook')}
              >
                Supprimer l&apos;URL
              </button>
            ) : null}
          </div>
        </Panel>
      </div>

      <div className="actions-row save-bar">
        <button
          className="button"
          disabled={busy !== null || !dirty || horizonInvalid || portInvalid}
          onClick={() => void save()}
        >
          {busy === 'save' ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        {dirty ? <span className="muted">Modifications non enregistrées</span> : null}
      </div>

      <Panel title="Derniers envois">
        {log.length === 0 ? (
          <p className="muted">Aucune notification envoyée pour l&apos;instant.</p>
        ) : (
          <ul className="notification-log">
            {log.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.test ? 'Test' : (PROVIDER_LABELS[entry.provider ?? ''] ?? entry.provider)}</strong>
                  {' · '}
                  {entry.channel === 'email' ? 'E-mail' : 'Webhook'} · {entry.summary}
                </div>
                <div className="meta-line">
                  {formatDateTime(entry.createdAt)}{' '}
                  <StatusBadge tone={entry.status === 'SENT' ? 'ok' : 'error'}>
                    {entry.status === 'SENT' ? 'Envoyé' : 'Échec'}
                  </StatusBadge>
                  {entry.error ? <span className="field-hint-error"> {entry.error}</span> : null}
                </div>
                {entry.message ? (
                  <details className="notification-message">
                    <summary>Voir le contenu</summary>
                    <pre>{entry.message}</pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
