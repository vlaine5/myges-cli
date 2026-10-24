import { describe, expect, it } from 'vitest';
import { buildNormalizedEvent } from '../../src/modules/events/normalize';
import {
  areProbableDuplicateEvents,
  collapseEquivalentEvents,
  shouldExcludeEvent,
} from '../../src/modules/events/presentation';

describe('event presentation helpers', () => {
  it('excludes ensup holiday noise from outputs', () => {
    const holiday = buildNormalizedEvent({
      provider: 'ensup',
      sourceId: 'holiday-1',
      reservationId: null,
      title: 'Férié',
      subject: 'Férié',
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2026-01-02T00:00:00.000Z',
      teacher: null,
      room: null,
      campus: null,
      rooms: [],
      promotion: null,
      group: null,
      classes: [],
      modality: null,
      reservationType: null,
      studentCount: null,
      disciplineName: 'Férié',
      disciplineTeacher: null,
      disciplineId: null,
      rawPayload: null,
    });

    expect(shouldExcludeEvent(holiday)).toBe(true);
  });

  it('keeps the richer duplicate when two equivalent events overlap', () => {
    const generic = buildNormalizedEvent({
      provider: 'myefrei',
      sourceId: 'a',
      reservationId: null,
      title: 'Initiation au DevSecOps',
      subject: 'Initiation au DevSecOps',
      startAt: '2026-04-01T07:10:00.000Z',
      endAt: '2026-04-01T10:40:00.000Z',
      teacher: null,
      room: 'N004',
      campus: null,
      rooms: [{ name: 'N004', floor: null, campus: null, address: null }],
      promotion: null,
      group: null,
      classes: [],
      modality: null,
      reservationType: null,
      studentCount: null,
      disciplineName: 'Initiation au DevSecOps',
      disciplineTeacher: null,
      disciplineId: null,
      rawPayload: null,
    });

    const detailed = buildNormalizedEvent({
      provider: 'myefrei',
      sourceId: 'b',
      reservationId: null,
      title: 'Initiation au DevSecOps',
      subject: 'XCS-07-2526PAN01',
      startAt: '2026-04-01T07:10:00.000Z',
      endAt: '2026-04-01T10:40:00.000Z',
      teacher: 'LAINÉ Vincent',
      room: 'N004',
      campus: null,
      rooms: [{ name: 'N004', floor: null, campus: null, address: null }],
      promotion: 'B3-CS-FISA2',
      group: 'B3-CS-FISA2',
      classes: ['B3-CS-FISA2'],
      modality: 'Présentiel',
      reservationType: 'CTD',
      studentCount: null,
      disciplineName: 'XCS-07-2526PAN01',
      disciplineTeacher: 'LAINÉ Vincent',
      disciplineId: null,
      rawPayload: null,
    });

    const collapsed = collapseEquivalentEvents([generic, detailed]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.id).toBe(detailed.id);
    expect(collapsed[0]!.classes).toEqual(['B3-CS-FISA2']);
  });

  it('areProbableDuplicateEvents never matches across providers by default', () => {
    const left = buildNormalizedEvent({
      provider: 'myges',
      sourceId: 'a',
      reservationId: null,
      title: 'Réseaux',
      subject: 'Réseaux',
      startAt: '2026-05-04T08:00:00.000Z',
      endAt: '2026-05-04T09:30:00.000Z',
      teacher: 'M. Dupont',
      room: 'B22',
      campus: null,
      rooms: [],
      promotion: null,
      group: null,
      classes: ['B3-INFO'],
      modality: null,
      reservationType: null,
      studentCount: null,
      disciplineName: null,
      disciplineTeacher: null,
      disciplineId: null,
      rawPayload: null,
    });

    const right = buildNormalizedEvent({
      ...left,
      provider: 'myefrei',
      sourceId: 'b',
    });

    expect(areProbableDuplicateEvents(left, right)).toBe(false);
    expect(areProbableDuplicateEvents(left, right, { crossProvider: true })).toBe(true);
  });
});
