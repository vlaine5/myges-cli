import { describe, expect, it } from 'vitest';
import { normalizeMyEfreiEvent } from '../../src/modules/providers/myefrei.provider';

describe('normalizeMyEfreiEvent', () => {
  it('normalizes a synthetic myEfrei-style event payload into the common model', () => {
    const event = normalizeMyEfreiEvent(
      {
        id: 'evt-42',
        title: 'Architecture logicielle',
        startAt: '2025-01-06T09:00:00.000Z',
        endAt: '2025-01-06T12:00:00.000Z',
        teacher: 'Mme Exemple',
        room: 'A204',
        campus: 'Villejuif',
        promotion: 'M1',
        group: 'Groupe A',
        classes: ['M1 Groupe A'],
        modality: 'Presentiel',
        discipline: {
          name: 'Architecture logicielle',
          teacher: 'Mme Exemple',
          id: 42,
          nb_students: 18,
        },
      },
      true,
    );

    expect(event.id).toBe('myefrei:evt-42');
    expect(event.provider).toBe('myefrei');
    expect(event.sourceId).toBe('evt-42');
    expect(event.studentCount).toBe(18);
    expect(event.teacher).toBe('Mme Exemple');
    expect(event.room).toBe('A204');
    expect(event.classes).toEqual(['M1 Groupe A']);
    expect(event.rawPayload).toContain('"id":"evt-42"');
  });

  it('builds a stable synthetic source id when no explicit event id exists', () => {
    const first = normalizeMyEfreiEvent({
      title: 'Reseaux',
      startAt: '2025-01-07T13:00:00.000Z',
      endAt: '2025-01-07T15:00:00.000Z',
      teacherName: 'M. Exemple',
      roomName: 'Lab 3',
      class: 'B3',
    });
    const second = normalizeMyEfreiEvent({
      title: 'Reseaux',
      startAt: '2025-01-07T13:00:00.000Z',
      endAt: '2025-01-07T15:00:00.000Z',
      teacherName: 'M. Exemple',
      roomName: 'Lab 3',
      class: 'B3',
    });

    expect(first.id).toBe(second.id);
    expect(first.sourceId).toBe(second.sourceId);
    expect(first.studentCount).toBeNull();
  });

  it('extracts groups, module code and student count from structured details', () => {
    const event = normalizeMyEfreiEvent({
      title: 'Initiation au DevSecOps',
      startAt: '2025-01-07T13:00:00.000Z',
      endAt: '2025-01-07T15:00:00.000Z',
      roomName: 'Lab 3',
      description: [
        'Code module: XCS-07-2526PAN01',
        'Enseignant(s): M. Exemple',
        'Groupe(s): B3-CS-FISA2, B3-CS-FISA3',
        "Nombre d'élèves: 24",
        'Modalité : Présentiel',
        'Activité: CTD',
      ].join('\n'),
    });

    expect(event.subject).toBe('XCS-07-2526PAN01');
    expect(event.teacher).toBe('M. Exemple');
    expect(event.group).toBe('B3-CS-FISA2');
    expect(event.classes).toEqual(['B3-CS-FISA2', 'B3-CS-FISA3']);
    expect(event.studentCount).toBe(24);
    expect(event.modality).toBe('Présentiel');
    expect(event.reservationType).toBe('CTD');
  });
});
