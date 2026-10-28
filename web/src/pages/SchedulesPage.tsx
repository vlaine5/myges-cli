import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel, StatusBadge, SuccessCallout } from '../components/Ui';
import type { ProviderSchedule, SchedulableProvider } from '../lib/types';

const PROVIDER_LABELS: Record<SchedulableProvider, string> = {
  myges: 'MyGES',
  myefrei: 'myEfrei',
  ensup: 'Ensup (HyperPlanning)',
};

// Displayed Monday first; values stay 0=Sun .. 6=Sat.
const WEEKDAYS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mer' },
  { value: 4, label: 'Jeu' },
  { value: 5, label: 'Ven' },
  { value: 6, label: 'Sam' },
  { value: 0, label: 'Dim' },
];

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function describeSchedule(schedule: Pick<ProviderSchedule, 'days' | 'times'>) {
  if (schedule.days.length === 0 || schedule.times.length === 0) {
    return null;
  }
  const days =
    schedule.days.length === 7
      ? 'Tous les jours'
      : WEEKDAYS.filter((day) => schedule.days.includes(day.value))
          .map((day) => DAY_NAMES[day.value])
          .join(', ')
          .replace(/^./, (first) => first.toUpperCase());
  return `${days} à ${schedule.times.join(', ')}`;
}

/** Slots are defined in the app timezone, so show them there, not in the browser's. */
function formatInZone(value: string | null, timeZone: string) {
  if (!value) return null;
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timeZone || undefined,
  }).format(new Date(value));
}

function sameSet<T>(left: T[], right: T[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

interface ScheduleCardProps {
  initial: ProviderSchedule;
  configured: boolean;
  timeZone: string;
  onSaved: (schedule: ProviderSchedule) => void;
}

function ScheduleCard({ initial, configured, timeZone, onSaved }: ScheduleCardProps) {
  const [draft, setDraft] = useState(initial);
  const [newTime, setNewTime] = useState('08:00');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => setDraft(initial), [initial]);

  const dirty =
    draft.enabled !== initial.enabled ||
    draft.pushToGoogle !== initial.pushToGoogle ||
    !sameSet(draft.days, initial.days) ||
    !sameSet(draft.times, initial.times);
  const description = describeSchedule(draft);
  const incomplete = draft.enabled && !description;
  const nextRun = !dirty && initial.enabled ? formatInZone(initial.nextRunAt, timeZone) : null;

  function toggleDay(day: number) {
    setDraft({
      ...draft,
      days: draft.days.includes(day) ? draft.days.filter((value) => value !== day) : [...draft.days, day],
    });
  }

  function addTime() {
    if (!newTime || draft.times.includes(newTime)) return;
    setDraft({ ...draft, times: [...draft.times, newTime].sort() });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await api.saveSchedule(draft.provider, {
        enabled: draft.enabled,
        days: draft.days,
        times: draft.times,
        pushToGoogle: draft.pushToGoogle,
      });
      onSaved(saved);
      setSuccess('Planification enregistrée.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setError(null);
    setSuccess(null);
    try {
      const result = (await api.runSchedule(draft.provider)) as {
        fetchedCount: number;
        createdCount: number;
        updatedCount: number;
        deletedCount: number;
        googleSyncEnabled: boolean;
      };
      setSuccess(
        result.googleSyncEnabled
          ? `${result.fetchedCount} événement(s) récupéré(s) — Google : ${result.createdCount} créé(s), ${result.updatedCount} modifié(s), ${result.deletedCount} supprimé(s).`
          : `${result.fetchedCount} événement(s) récupéré(s), rien envoyé à Google.`,
      );
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Synchronisation impossible.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Panel
      title={PROVIDER_LABELS[draft.provider]}
      actions={
        configured ? (
          <StatusBadge tone={initial.enabled ? 'ok' : 'muted'}>{initial.enabled ? 'Planifié' : 'Inactif'}</StatusBadge>
        ) : (
          <StatusBadge tone="warn">Non configuré</StatusBadge>
        )
      }
    >
      <div className="schedule-summary">
        <strong>{description ?? 'Aucun créneau'}</strong>
        <span>
          {dirty
            ? 'Modifications non enregistrées'
            : nextRun
              ? `Prochaine : ${nextRun}`
              : initial.enabled
                ? 'Aucune exécution prévue'
                : 'Synchronisation automatique désactivée'}
        </span>
      </div>

      {!configured ? (
        <p className="meta-line">
          Renseigne les identifiants ou un lien ICS dans <Link to="/provider">Provider</Link> pour que ce
          créneau puisse récupérer l&apos;agenda.
        </p>
      ) : null}

      <label className="toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
        />
        Synchroniser automatiquement
      </label>

      <fieldset className="schedule-section">
        <legend>Jours</legend>
        <div className="day-picker">
          {WEEKDAYS.map((day) => (
            <button
              key={day.value}
              type="button"
              className={draft.days.includes(day.value) ? 'day-chip active' : 'day-chip'}
              aria-pressed={draft.days.includes(day.value)}
              aria-label={DAY_NAMES[day.value]}
              onClick={() => toggleDay(day.value)}
            >
              {day.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="schedule-section">
        <legend>Heures</legend>
        <div className="time-list">
          {draft.times.map((time) => (
            <span key={time} className="time-chip">
              {time}
              <button
                type="button"
                aria-label={`Retirer ${time}`}
                onClick={() => setDraft({ ...draft, times: draft.times.filter((value) => value !== time) })}
              >
                ×
              </button>
            </span>
          ))}
          <span className="time-add">
            <input
              type="time"
              value={newTime}
              aria-label="Heure à ajouter"
              onChange={(event) => setNewTime(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addTime();
              }}
            />
            <button
              type="button"
              className="button button-secondary"
              disabled={!newTime || draft.times.includes(newTime)}
              onClick={addTime}
            >
              Ajouter
            </button>
          </span>
        </div>
        {incomplete ? <p className="field-hint">Choisis au moins un jour et une heure.</p> : null}
      </fieldset>

      <label className="toggle">
        <input
          type="checkbox"
          checked={draft.pushToGoogle}
          onChange={(event) => setDraft({ ...draft, pushToGoogle: event.target.checked })}
        />
        Envoyer les modifications vers Google Calendar
      </label>

      <ErrorCallout message={error} />
      <SuccessCallout message={success} />

      <div className="schedule-footer">
        <p className="meta-line">
          {initial.lastRunAt ? (
            <>
              Dernière exécution : {formatInZone(initial.lastRunAt, timeZone)}{' '}
              <StatusBadge tone={initial.lastRunStatus === 'SUCCESS' ? 'ok' : 'error'}>
                {initial.lastRunStatus === 'SUCCESS' ? 'OK' : 'Échec'}
              </StatusBadge>
              {initial.lastJobId ? (
                <>
                  {' '}
                  <Link to={`/sync/${initial.lastJobId}`}>Détail</Link>
                </>
              ) : null}
            </>
          ) : (
            'Jamais exécutée automatiquement'
          )}
        </p>
        <div className="actions-row">
          <button
            className="button button-secondary"
            disabled={running || !configured}
            onClick={() => void runNow()}
          >
            {running ? 'Synchronisation...' : 'Synchroniser maintenant'}
          </button>
          <button className="button" disabled={saving || !dirty || incomplete} onClick={() => void save()}>
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
      {initial.lastRunStatus === 'FAILED' && initial.lastRunError ? (
        <p className="field-hint field-hint-error">{initial.lastRunError}</p>
      ) : null}
    </Panel>
  );
}

export function SchedulesPage() {
  const [schedules, setSchedules] = useState<ProviderSchedule[]>([]);
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [googleReady, setGoogleReady] = useState(true);
  const [timeZone, setTimeZone] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [scheduleRows, providers, google, settings] = await Promise.all([
          api.listSchedules(),
          api.listProviders() as Promise<{ providers: Array<{ provider: string; configured: boolean }> }>,
          api.getGoogleStatus() as Promise<{ connected: boolean }>,
          api.getSettings() as Promise<{ googleSyncEnabled: boolean; timezone: string }>,
        ]);
        setSchedules(scheduleRows);
        setConfigured(Object.fromEntries(providers.providers.map((row) => [row.provider, row.configured])));
        setGoogleReady(google.connected && settings.googleSyncEnabled);
        setTimeZone(settings.timezone);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Impossible de charger la planification.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <LoadingBlock label="Chargement de la planification..." />;
  }

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Automatisation</p>
          <h2>Planification</h2>
          <p className="muted page-intro">
            Choisis quand chaque agenda est relu ({timeZone}). Seules les modifications sont envoyées à Google ; un
            créneau manqué de moins de 12 h est rattrapé.
          </p>
        </div>
      </header>

      <ErrorCallout message={error} />
      {!googleReady ? (
        <div className="callout callout-warn" role="status">
          Google Calendar n&apos;est pas connecté ou sa synchronisation est désactivée : les créneaux mettront à jour
          l&apos;agenda local uniquement. <Link to="/google">Google</Link> · <Link to="/settings">Paramètres</Link>
        </div>
      ) : null}

      <div className="schedule-grid">
        {schedules.map((schedule) => (
          <ScheduleCard
            key={schedule.provider}
            initial={schedule}
            configured={configured[schedule.provider] ?? false}
            timeZone={timeZone}
            onSaved={(saved) =>
              setSchedules((rows) => rows.map((row) => (row.provider === saved.provider ? saved : row)))
            }
          />
        ))}
      </div>
    </div>
  );
}
