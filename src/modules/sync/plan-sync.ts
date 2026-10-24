import type { EventMapping } from '@prisma/client';
import type { NormalizedEvent } from '../events/types';

export interface SyncActionPlan {
  create: NormalizedEvent[];
  update: Array<{ event: NormalizedEvent; mapping: EventMapping }>;
  delete: EventMapping[];
  unchanged: Array<{ event: NormalizedEvent; mapping: EventMapping }>;
}

export function planSyncActions(
  events: NormalizedEvent[],
  mappings: EventMapping[],
  range: { start: Date; end: Date },
): SyncActionPlan {
  const mappingByEventId = new Map(mappings.map((mapping) => [mapping.sourceEventId, mapping]));
  const eventIds = new Set(events.map((event) => event.id));
  const create: NormalizedEvent[] = [];
  const update: Array<{ event: NormalizedEvent; mapping: EventMapping }> = [];
  const unchanged: Array<{ event: NormalizedEvent; mapping: EventMapping }> = [];

  for (const event of events) {
    const mapping = mappingByEventId.get(event.id);

    if (!mapping || !mapping.googleEventId || mapping.deletedAt) {
      create.push(event);
      continue;
    }

    if (mapping.lastSyncedHash !== event.sourceHash) {
      update.push({ event, mapping });
      continue;
    }

    unchanged.push({ event, mapping });
  }

  const deleteCandidates = mappings.filter((mapping) => {
    if (!mapping.googleEventId) {
      return false;
    }

    if (eventIds.has(mapping.sourceEventId)) {
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
