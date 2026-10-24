import type { calendar_v3 } from 'googleapis';
import { buildEventDescriptionLines } from '../events/description';
import type { NormalizedEvent } from '../events/types';

function buildLocation(event: NormalizedEvent) {
  const firstRoom = event.rooms[0];

  if (!firstRoom) {
    return undefined;
  }

  const parts = [firstRoom.name, firstRoom.address].filter(Boolean);

  return parts.length > 0 ? parts.join(' - ') : undefined;
}

export function buildGoogleEvent(
  event: NormalizedEvent,
  timeZone: string,
): calendar_v3.Schema$Event {
  return {
    summary: event.title,
    description: buildEventDescriptionLines(event).join('\n'),
    location: buildLocation(event),
    start: {
      dateTime: event.startAt.toISOString(),
      timeZone,
    },
    end: {
      dateTime: event.endAt.toISOString(),
      timeZone,
    },
    extendedProperties: {
      private: {
        source: 'myges-app',
        sourceProvider: event.provider,
        sourceEventId: event.id,
        sourceId: event.sourceId,
        reservationId: event.reservationId?.toString() ?? '',
        sourceHash: event.sourceHash,
      },
    },
  };
}
