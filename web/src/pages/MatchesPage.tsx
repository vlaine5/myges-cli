import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel, StatusBadge, SuccessCallout } from '../components/Ui';
import { formatDateTime } from '../lib/format';
import type { EventMatch } from '../lib/types';

const PROVIDER_LABELS: Record<string, string> = {
  myges: 'MyGES',
  myefrei: 'myEfrei',
  ensup: 'Ensup',
  generic: 'Autre / ICS',
};

const BASIS_LABELS: Record<string, string> = {
  VERIFIED_IDENTIFIER: 'Identifiant vérifié',
  APPROVED_PRIOR_MATCH: 'Correspondance antérieure approuvée',
  FUZZY_RESEMBLANCE: 'Ressemblance (heuristique)',
};

function parseReason(reasonJson: string | null): { reason?: string; candidateCount?: number } {
  if (!reasonJson) return {};
  try {
    return JSON.parse(reasonJson);
  } catch {
    return {};
  }
}

function fieldRow(label: string, snapshotValue: unknown, globalValue: unknown) {
  if (snapshotValue === null && globalValue === null) return null;
  return (
    <>
      <div className="match-field"><strong>{label}</strong>{snapshotValue !== null && snapshotValue !== undefined && snapshotValue !== '' ? String(snapshotValue) : '—'}</div>
      <div className="match-field"><strong>{label}</strong>{globalValue !== null && globalValue !== undefined && globalValue !== '' ? String(globalValue) : '—'}</div>
    </>
  );
}

export function MatchesPage() {
  const [suggestions, setSuggestions] = useState<EventMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getReconciliationSuggestions();
      setSuggestions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les suggestions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleConfirm(match: EventMatch, siblingIds: string[]) {
    setBusyId(match.id);
    setError(null);
    setSuccess(null);
    try {
      await api.confirmSuggestion(match.id);
      // An AMBIGUOUS group's other candidates for the same snapshot are not
      // automatically superseded by the backend (listSuggestions only drops a
      // row once a later REJECTED/UNLINKED entry exists for that exact
      // globalEventId+snapshotId pair) — reject them explicitly so they don't
      // linger as stale suggestions for a snapshot that's now already merged.
      for (const siblingId of siblingIds) {
        await api.rejectSuggestion(siblingId);
      }
      setSuccess('Rapprochement confirmé.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation impossible.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(matchId: string) {
    setBusyId(matchId);
    setError(null);
    setSuccess(null);
    try {
      await api.rejectSuggestion(matchId);
      setSuccess('Suggestion rejetée.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejet impossible.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRejectAll(matchIds: string[]) {
    setBusyId(matchIds[0] ?? null);
    setError(null);
    setSuccess(null);
    try {
      for (const id of matchIds) {
        await api.rejectSuggestion(id);
      }
      setSuccess('Suggestions rejetées.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejet impossible.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <LoadingBlock label="Chargement des suggestions de rapprochement..." />;
  }

  // Group by snapshotId: a snapshot with a single pending row is a SUGGESTED
  // single-candidate case; 2+ rows for the same snapshot are competing
  // AMBIGUOUS candidates the user must pick between.
  const groups = new Map<string, EventMatch[]>();
  for (const match of suggestions) {
    const list = groups.get(match.snapshotId) ?? [];
    list.push(match);
    groups.set(match.snapshotId, list);
  }

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Reconciliation</p>
          <h2>Rapprochements suggérés</h2>
        </div>
        <button className="button button-secondary" onClick={() => void load()}>
          Rafraichir
        </button>
      </header>

      <ErrorCallout message={error} />
      <SuccessCallout message={success} />

      {groups.size === 0 ? (
        <Panel title="Aucune suggestion en attente">
          <p className="muted">
            Aucun rapprochement cross-provider n'attend de décision. Les nouveaux événements qui ressemblent
            fortement à un événement existant d'un autre provider apparaîtront ici.
          </p>
        </Panel>
      ) : (
        [...groups.entries()].map(([snapshotId, matches]) => {
          // `matches` is never empty: it's built by pushing onto a Map lookup above.
          const snapshot = matches[0]!.snapshot;
          const isAmbiguous = matches.length > 1;

          return (
            <Panel
              key={snapshotId}
              title={`${PROVIDER_LABELS[snapshot.provider] ?? snapshot.provider} — ${snapshot.title}`}
              actions={isAmbiguous ? <StatusBadge tone="warn">{matches.length} candidats</StatusBadge> : undefined}
            >
              <p className="meta-line">
                {formatDateTime(snapshot.startAt)} → {formatDateTime(snapshot.endAt)}
                {snapshot.teacher ? ` — ${snapshot.teacher}` : ''}
              </p>

              {isAmbiguous && (
                <p className="muted" style={{ fontSize: '0.85rem' }}>
                  Plusieurs événements existants ressemblent à celui-ci. Choisissez le bon, ou rejetez-les tous
                  si aucun ne correspond.
                </p>
              )}

              {matches.map((match) => {
                const { reason, candidateCount } = parseReason(match.reasonJson);
                const siblingIds = matches.filter((m) => m.id !== match.id).map((m) => m.id);
                return (
                  <div className="match-card" key={match.id}>
                    <div className="match-reason">
                      <StatusBadge tone="muted">{BASIS_LABELS[match.matchBasis] ?? match.matchBasis}</StatusBadge>
                      {match.confidence !== null && ` — confiance ${(match.confidence * 100).toFixed(0)}%`}
                      {reason ? ` — ${reason}` : ''}
                      {candidateCount && candidateCount > 1 ? ` (${candidateCount} candidats)` : ''}
                    </div>

                    <div className="match-compare">
                      <div><strong style={{ display: 'block', marginBottom: '0.3rem' }}>Snapshot ({PROVIDER_LABELS[snapshot.provider] ?? snapshot.provider})</strong></div>
                      <div><strong style={{ display: 'block', marginBottom: '0.3rem' }}>Candidat GlobalEvent</strong></div>
                      {fieldRow('Titre', snapshot.title, match.globalEvent.title)}
                      {fieldRow('Matière', snapshot.subject, match.globalEvent.subject)}
                      {fieldRow('Enseignant', snapshot.teacher, match.globalEvent.teacher)}
                      {fieldRow('Salle', snapshot.room, match.globalEvent.room)}
                      {fieldRow('Campus', snapshot.campus, match.globalEvent.campus)}
                      {fieldRow('Promotion', snapshot.promotion, match.globalEvent.promotion)}
                      {fieldRow('Groupe', snapshot.groupName, match.globalEvent.groupName)}
                      {fieldRow('Modalité', snapshot.modality, match.globalEvent.modality)}
                    </div>

                    <div className="actions-row">
                      <button
                        className="button button-secondary"
                        disabled={busyId === match.id}
                        onClick={() => void handleReject(match.id)}
                      >
                        Rejeter
                      </button>
                      <button
                        className="button"
                        disabled={busyId === match.id}
                        onClick={() => void handleConfirm(match, siblingIds)}
                      >
                        Confirmer ce rapprochement
                      </button>
                    </div>
                  </div>
                );
              })}

              {isAmbiguous && (
                <div className="actions-row">
                  <button
                    className="button button-secondary"
                    style={{ color: 'var(--error)' }}
                    disabled={busyId !== null}
                    onClick={() => void handleRejectAll(matches.map((m) => m.id))}
                  >
                    Rejeter tous les candidats
                  </button>
                </div>
              )}
            </Panel>
          );
        })
      )}
    </div>
  );
}
