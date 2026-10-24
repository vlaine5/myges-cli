import { describe, expect, it } from 'vitest';
import agendaEvent from '../fixtures/agenda-event.json';
import { dedupeEvents, normalizeAgendaEvent } from '../../src/modules/events/normalize';

describe('dedupeEvents', () => {
  it('deduplicates events using the normalized id', () => {
    const first = normalizeAgendaEvent(agendaEvent);
    const duplicate = normalizeAgendaEvent({
      ...agendaEvent,
      rooms: null,
    });
    const second = normalizeAgendaEvent({
      ...agendaEvent,
      reservation_id: 1827576,
    });

    const deduped = dedupeEvents([first, duplicate, second]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((event) => event.id)).toEqual([
      'myges:1827575',
      'myges:1827576',
    ]);
  });
});
