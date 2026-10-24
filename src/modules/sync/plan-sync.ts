import type { EventMapping } from '@prisma/client';
import type { NormalizedEvent } from '../events/types';

/**
 * One GlobalEvent's current state as seen by the sync engine: the representative
 * (primary snapshot's) fields to push to Google, plus enough information about
 * its linked snapshots to detect content changes and disappearance — Google
 * sync always targets a GlobalEvent, never a raw snapshot.
 */
export interface GlobalEventSyncInput {
  globalEventId: string;
  /** The current primary snapshot's fields, used to build the Google payload. */
  event: NormalizedEvent;
  /** Hash of the sorted sourceHashes of every snapshot currently linked to this GlobalEvent. */
  combinedHash: string;
  /** Total snapshots currently linked to this GlobalEvent (any provider). 0 means nothing left to represent. */
  linkedSnapshotCount: number;
}

export interface SyncActionPlan {
  create: GlobalEventSyncInput[];
  update: Array<{ event: GlobalEventSyncInput; mapping: EventMapping }>;
  delete: EventMapping[];
  unchanged: Array<{ event: GlobalEventSyncInput; mapping: EventMapping }>;
}

export function planSyncActions(
  inputs: GlobalEventSyncInput[],
  mappings: EventMapping[],
  range: { start: Date; end: Date },
): SyncActionPlan {
  const mappingByGlobalEventId = new Map(mappings.map((mapping) => [mapping.globalEventId, mapping]));
  const inputByGlobalEventId = new Map(inputs.map((input) => [input.globalEventId, input]));

  const create: GlobalEventSyncInput[] = [];
  const update: Array<{ event: GlobalEventSyncInput; mapping: EventMapping }> = [];
  const unchanged: Array<{ event: GlobalEventSyncInput; mapping: EventMapping }> = [];

  for (const input of inputs) {
    if (input.linkedSnapshotCount === 0) {
      // Nothing currently represents this GlobalEvent — leave it to the delete
      // pass below (if it still has a live mapping).
      continue;
    }

    const mapping = mappingByGlobalEventId.get(input.globalEventId);

    if (!mapping || !mapping.googleEventId || mapping.deletedAt) {
      create.push(input);
      continue;
    }

    if (mapping.lastSyncedHash !== input.combinedHash) {
      update.push({ event: input, mapping });
      continue;
    }

    unchanged.push({ event: input, mapping });
  }

  const deleteCandidates = mappings.filter((mapping) => {
    if (!mapping.googleEventId) {
      return false;
    }

    const input = inputByGlobalEventId.get(mapping.globalEventId);
    const stillRepresented = Boolean(input && input.linkedSnapshotCount > 0);

    if (stillRepresented) {
      return false;
    }

    return (
      mapping.lastKnownStartAt.getTime() >= range.start.getTime() &&
      mapping.lastKnownStartAt.getTime() <= range.end.getTime()
    );
  });

  return {
    create,
    update,
    delete: deleteCandidates,
    unchanged,
  };
}
