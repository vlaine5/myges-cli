import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { GlobalEventDetail } from '../lib/types';

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

/** Fixed-position overlay drawer showing a GlobalEvent's merged fields and its
 * linked source snapshots. Deliberately never reflows the calendar grid — the
 * whole point is to not lose scroll position when an event is clicked. */
export function EventDetailPanel({
  globalEventId,
  onClose,
  onChanged,
}: {
  globalEventId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<GlobalEventDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);

  useEffect(() => {
    if (!globalEventId) {
      setDetail(null);
      return;
    }
    void load(globalEventId);
  }, [globalEventId]);

  async function load(id: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getGlobalEvent(id);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger cet événement.');
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlink(snapshotId: string) {
    if (!detail) return;
    setUnlinking(snapshotId);
    setError(null);
    try {
      await api.unlinkSnapshot(detail.id, snapshotId);
      onChanged();
      // The snapshot just left this GlobalEvent — nothing left to show it under
      // here unless others remain; refetch to pick up the new primary.
      await load(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dissociation impossible.');
    } finally {
      setUnlinking(null);
    }
  }

  if (!globalEventId) {
    return null;
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Détail de l'événement</p>
            <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.3rem' }}>{detail?.title ?? '...'}</h2>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Fermer">×</button>
        </div>

        {loading && <p className="muted">Chargement...</p>}
        {error && <div className="callout callout-error">{error}</div>}

        {detail && !loading && (
          <>
            <div className="detail-grid" style={{ marginBottom: '1.25rem' }}>
              <div><strong>Début</strong><p>{formatDateTime(detail.startAt)}</p></div>
              <div><strong>Fin</strong><p>{formatDateTime(detail.endAt)}</p></div>
              {detail.subject && <div><strong>Matière</strong><p>{detail.subject}</p></div>}
              {detail.teacher && <div><strong>Enseignant</strong><p>{detail.teacher}</p></div>}
              {detail.room && <div><strong>Salle</strong><p>{detail.room}</p></div>}
              {detail.campus && <div><strong>Campus</strong><p>{detail.campus}</p></div>}
              {detail.promotion && <div><strong>Promotion</strong><p>{detail.promotion}</p></div>}
              {detail.groupName && <div><strong>Groupe</strong><p>{detail.groupName}</p></div>}
              {detail.modality && <div><strong>Modalité</strong><p>{detail.modality}</p></div>}
            </div>

            <h3 style={{ fontSize: '0.95rem' }}>
              Sources liées ({detail.snapshots.length})
            </h3>
            {detail.snapshots.map((snapshot) => (
              <div className="snapshot-card" key={snapshot.id}>
                <div className="snapshot-card-header">
                  <span className="provider-chip" style={{ color: providerColor(snapshot.provider) }}>
                    <span className="provider-dot" style={{ background: providerColor(snapshot.provider) }} />
                    {PROVIDER_LABELS[snapshot.provider] ?? snapshot.provider}
                    {snapshot.id === detail.primarySnapshotId ? ' (primaire)' : ''}
                  </span>
                  {detail.snapshots.length > 1 && (
                    <button
                      className="button button-secondary"
                      style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                      disabled={unlinking === snapshot.id}
                      onClick={() => void handleUnlink(snapshot.id)}
                    >
                      {unlinking === snapshot.id ? '...' : 'Dissocier'}
                    </button>
                  )}
                </div>
                <p className="meta-line" style={{ margin: '0.1rem 0' }}>{snapshot.title}</p>
                {snapshot.teacher && <p className="meta-line" style={{ margin: '0.1rem 0' }}>Enseignant : {snapshot.teacher}</p>}
                {snapshot.room && <p className="meta-line" style={{ margin: '0.1rem 0' }}>Salle : {snapshot.room}</p>}
                {snapshot.studentCount !== null && (
                  <p className="meta-line" style={{ margin: '0.1rem 0' }}>Effectif : {snapshot.studentCount}</p>
                )}
              </div>
            ))}

            {detail.mapping && (
              <p className="meta-line" style={{ marginTop: '0.75rem' }}>
                Synchronisé avec Google : {detail.mapping.googleEventId ? 'oui' : 'non'}
                {detail.mapping.lastSyncedAt ? ` (${formatDateTime(detail.mapping.lastSyncedAt)})` : ''}
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
