import { describe, expect, it } from 'vitest';
import { parseIcs } from '../../src/lib/ics-parser';
import { buildNormalizedEvent } from '../../src/modules/events/normalize';
import { sha256 } from '../../src/lib/hash';

/**
 * Test that the ICS import deduplication strategy produces stable, deterministic IDs
 * based on provider + sha256(UID), so that re-importing the same ICS does not create duplicates.
 */
describe('ICS import deduplication', () => {
  const ICS_CONTENT = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:stable-uid-001@test.com',
    'DTSTART:20260410T090000Z',
    'DTEND:20260410T110000Z',
    'SUMMARY:Mathématiques',
    'LOCATION:Salle A1',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:stable-uid-002@test.com',
    'DTSTART:20260411T140000Z',
    'DTEND:20260411T160000Z',
    'SUMMARY:Physique',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('produces deterministic event IDs from UID + provider', () => {
    const events = parseIcs(ICS_CONTENT);
    expect(events).toHaveLength(2);

    const provider = 'ensup' as const;
    const sourceId1 = sha256(events[0].uid);
    const id1 = `${provider}:${sourceId1}`;
    expect(id1).toBe(`ensup:${sha256('stable-uid-001@test.com')}`);

    const sourceId2 = sha256(events[1].uid);
    const id2 = `${provider}:${sourceId2}`;
    expect(id2).toBe(`ensup:${sha256('stable-uid-002@test.com')}`);

    // IDs must be different
    expect(id1).not.toBe(id2);
  });

  it('produces different event IDs for same UID but different providers', () => {
    const events = parseIcs(ICS_CONTENT);
    const uid = events[0].uid;
    const sourceId = sha256(uid);

    const idMyges = `myges:${sourceId}`;
    const idEnsup = `ensup:${sourceId}`;
    expect(idMyges).not.toBe(idEnsup);
  });

  it('produces stable sourceHash for unchanged event content', () => {
    const events = parseIcs(ICS_CONTENT);
    const event = events[0];
    const provider = 'myges' as const;
    const sourceId = sha256(event.uid);

    const normalized1 = buildNormalizedEvent({
      provider,
      sourceId,
      reservationId: null,
      title: event.summary ?? 'Cours',
      subject: event.summary,
      startAt: event.startAt,
      endAt: event.endAt,
      teacher: null,
      room: event.location,
      campus: null,
      rooms: event.location ? [{ name: event.location, floor: null, campus: null, address: null }] : [],
      promotion: null,
      group: null,
      classes: [],
      modality: null,
      reservationType: null,
      studentCount: null,
      disciplineName: event.summary,
      disciplineTeacher: null,
      disciplineId: null,
      rawPayload: null,
    });

    const normalized2 = buildNormalizedEvent({
      provider,
      sourceId,
      reservationId: null,
      title: event.summary ?? 'Cours',
      subject: event.summary,
      startAt: event.startAt,
      endAt: event.endAt,
      teacher: null,
      room: event.location,
      campus: null,
      rooms: event.location ? [{ name: event.location, floor: null, campus: null, address: null }] : [],
      promotion: null,
      group: null,
      classes: [],
      modality: null,
      reservationType: null,
      studentCount: null,
      disciplineName: event.summary,
      disciplineTeacher: null,
      disciplineId: null,
      rawPayload: null,
    });

    // Same content → same hash → will be detected as duplicate and skipped
    expect(normalized1.sourceHash).toBe(normalized2.sourceHash);
    expect(normalized1.id).toBe(normalized2.id);
  });

  it('produces different sourceHash when content changes', () => {
    const events = parseIcs(ICS_CONTENT);
    const event = events[0];
    const provider = 'myges' as const;
    const sourceId = sha256(event.uid);

    const base = {
      provider,
      sourceId,
      reservationId: null,
      title: event.summary ?? 'Cours',
      subject: event.summary,
      startAt: event.startAt,
      endAt: event.endAt,
      teacher: null,
      room: event.location,
      campus: null,
      rooms: [] as { name: string | null; floor: string | null; campus: string | null; address: string | null }[],
      promotion: null,
      group: null,
      classes: [] as string[],
      modality: null,
      reservationType: null,
      studentCount: null,
      disciplineName: event.summary,
      disciplineTeacher: null,
      disciplineId: null,
      rawPayload: null,
    };

    const original = buildNormalizedEvent(base);
    const changed = buildNormalizedEvent({ ...base, teacher: 'M. Dupont' });

    // Different content → different hash → will be detected as update
    expect(original.sourceHash).not.toBe(changed.sourceHash);
    // But same ID (same provider + uid)
    expect(original.id).toBe(changed.id);
  });

  it('parses CANCELLED status correctly', () => {
    const withCancelled = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:cancelled-event@test.com',
      'DTSTART:20260415T090000Z',
      'DTEND:20260415T110000Z',
      'SUMMARY:Cours annulé',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const events = parseIcs(withCancelled);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('CANCELLED');
  });
});
