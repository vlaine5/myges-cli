import { describe, expect, it } from 'vitest';
import agendaEvent from '../fixtures/agenda-event.json';
import { normalizeAgendaEvent } from '../../src/modules/events/normalize';

describe('normalizeAgendaEvent', () => {
  it('maps studentCount from discipline.nb_students', () => {
    const event = normalizeAgendaEvent(agendaEvent, { includeRawPayload: true });

    expect(event.id).toBe('myges:1827575');
    expect(event.studentCount).toBe(6);
    expect(event.group).toBe('4 ESGI - SRC Janvier S2');
    expect(event.room).toBe('B12');
    expect(event.rooms[0]?.address).toContain('rue Bouvier');
    expect(event.rawPayload).toContain('"nb_students":6');
  });

  it('returns null when studentCount is missing', () => {
    const event = normalizeAgendaEvent({
      ...agendaEvent,
      discipline: {
        ...agendaEvent.discipline,
        nb_students: null,
      },
    });

    expect(event.studentCount).toBeNull();
  });
});
