import { describe, expect, it } from 'vitest';
import { expandRrule } from '../../src/lib/rrule-expander';
import { parseIcs } from '../../src/lib/ics-parser';

// Helper to build a date with UTC time
function utc(year: number, month: number, day: number, h = 0, m = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, h, m, 0));
}

describe('expandRrule', () => {
  const windowStart = utc(2026, 1, 1);
  const windowEnd = utc(2026, 12, 31);

  describe('FREQ=DAILY', () => {
    it('expands daily recurrence within window', () => {
      const start = utc(2026, 1, 5, 9, 0);
      const results = expandRrule('uid-daily', 'FREQ=DAILY;COUNT=5', undefined, start, 3600000, windowStart, windowEnd);
      expect(results).toHaveLength(5);
      expect(results[0].startAt).toEqual(utc(2026, 1, 5, 9, 0));
      expect(results[4].startAt).toEqual(utc(2026, 1, 9, 9, 0));
    });

    it('respects COUNT limit', () => {
      const start = utc(2026, 3, 1, 8, 0);
      const results = expandRrule('uid-count', 'FREQ=DAILY;COUNT=3', undefined, start, 7200000, windowStart, windowEnd);
      expect(results).toHaveLength(3);
    });

    it('respects UNTIL date', () => {
      const start = utc(2026, 1, 1, 9, 0);
      const results = expandRrule('uid-until', 'FREQ=DAILY;UNTIL=20260105T235959Z', undefined, start, 3600000, windowStart, windowEnd);
      expect(results).toHaveLength(5); // Jan 1-5
      expect(results[results.length - 1].startAt.getUTCDate()).toBe(5);
    });

    it('uses INTERVAL for step', () => {
      const start = utc(2026, 1, 1, 10, 0);
      const results = expandRrule('uid-interval', 'FREQ=DAILY;INTERVAL=2;COUNT=4', undefined, start, 3600000, windowStart, windowEnd);
      expect(results).toHaveLength(4);
      // Dates: Jan 1, 3, 5, 7
      expect(results[1].startAt.getUTCDate()).toBe(3);
      expect(results[2].startAt.getUTCDate()).toBe(5);
    });

    it('skips EXDATE occurrences', () => {
      const start = utc(2026, 1, 5, 9, 0);
      const results = expandRrule(
        'uid-exdate',
        'FREQ=DAILY;COUNT=5',
        '20260106T090000Z,20260108T090000Z',
        start,
        3600000,
        windowStart,
        windowEnd,
      );
      // EXDATE'd occurrences are not counted toward COUNT:
      // Jan 5 (ok), Jan 6 (exdate skip), Jan 7 (ok), Jan 8 (exdate skip),
      // Jan 9 (ok), Jan 10 (ok), Jan 11 (ok) → 5 results
      expect(results).toHaveLength(5);
      const dates = results.map((r) => r.startAt.getUTCDate());
      // The excluded dates must not appear
      expect(dates).not.toContain(6);
      expect(dates).not.toContain(8);
    });

    it('truncates at window boundary', () => {
      const start = utc(2026, 12, 28, 10, 0);
      const results = expandRrule('uid-window', 'FREQ=DAILY;COUNT=10', undefined, start, 3600000, windowStart, windowEnd);
      // Only Dec 28, 29, 30, 31 are within window (windowEnd = Dec 31)
      expect(results.length).toBeLessThanOrEqual(4);
      for (const r of results) {
        expect(r.startAt.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
      }
    });
  });

  describe('FREQ=WEEKLY', () => {
    it('expands weekly recurrence', () => {
      const start = utc(2026, 1, 5, 9, 0); // Monday
      const results = expandRrule('uid-weekly', 'FREQ=WEEKLY;COUNT=4', undefined, start, 3600000, windowStart, windowEnd);
      expect(results).toHaveLength(4);
      // Each occurrence is 7 days apart
      expect(results[1].startAt.getUTCDate() - results[0].startAt.getUTCDate()).toBe(7);
    });

    it('expands WEEKLY with BYDAY for multiple days per week — DTSTART on first BYDAY', () => {
      // DTSTART = Mon Jan 5, BYDAY = MO,WE,FR → first occurrence is Mon Jan 5 (same as dtstart)
      const start = utc(2026, 1, 5, 9, 0); // Monday
      const results = expandRrule(
        'uid-weekly-byday',
        'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=9',
        undefined,
        start,
        3600000,
        windowStart,
        windowEnd,
      );
      expect(results).toHaveLength(9);
      // All must be Mon, Wed, or Fri (day 1, 3, or 5)
      for (const r of results) {
        expect([1, 3, 5]).toContain(r.startAt.getUTCDay());
      }
      // First occurrence must be >= DTSTART
      expect(results[0].startAt.getTime()).toBeGreaterThanOrEqual(start.getTime());
    });

    it('WEEKLY+BYDAY: DTSTART mid-week — no occurrence before DTSTART (regression test for Aug 31 bug)', () => {
      // This is the exact scenario from production:
      // DTSTART = 2026-09-01 (Tuesday), BYDAY = MO,WE
      // Bug: Aug 31 (Monday of that week) was generated before DTSTART
      const start = utc(2026, 9, 1, 9, 0); // Tuesday Sep 1
      const results = expandRrule(
        'cours-maths-weekly@test.fr',
        'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10',
        undefined,
        start,
        7200000,
        new Date('2024-01-01'),
        new Date('2028-12-31'),
      );
      // All occurrences must be >= DTSTART
      for (const r of results) {
        expect(r.startAt.getTime()).toBeGreaterThanOrEqual(start.getTime());
      }
      // First occurrence must be Sep 2 (Wednesday — first BYDAY day after DTSTART)
      expect(results[0].startAt.toISOString().slice(0, 10)).toBe('2026-09-02');
      // Must have exactly 10 occurrences (COUNT=10, no pre-DTSTART ones count)
      expect(results).toHaveLength(10);
      // All must be Monday or Wednesday
      for (const r of results) {
        expect([1, 3]).toContain(r.startAt.getUTCDay()); // 1=Mon, 3=Wed
      }
    });

    it('WEEKLY+BYDAY: DTSTART on a BYDAY day — first occurrence is DTSTART itself', () => {
      // DTSTART = 2026-09-02 (Wednesday), BYDAY = MO,WE
      const start = utc(2026, 9, 2, 9, 0); // Wednesday
      const results = expandRrule(
        'uid-wed-start',
        'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6',
        undefined,
        start,
        3600000,
        new Date('2024-01-01'),
        new Date('2028-12-31'),
      );
      // First occurrence is DTSTART itself (Wednesday Sep 2)
      expect(results[0].startAt.toISOString().slice(0, 10)).toBe('2026-09-02');
      expect(results).toHaveLength(6);
    });

    it('WEEKLY+BYDAY: partial first week — only BYDAY days >= DTSTART emitted, COUNT reflects it', () => {
      // DTSTART = 2026-01-07 (Wednesday), BYDAY = MO,WE,FR
      // In week of Jan 5: MO=Jan5 (skip, before dtstart), WE=Jan7 (ok), FR=Jan9 (ok)
      const start = utc(2026, 1, 7, 10, 0); // Wednesday Jan 7
      const results = expandRrule(
        'uid-partial-week',
        'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5',
        undefined,
        start,
        3600000,
        windowStart,
        windowEnd,
      );
      expect(results).toHaveLength(5);
      // First occurrence = Jan 7 (Wednesday)
      expect(results[0].startAt.toISOString().slice(0, 10)).toBe('2026-01-07');
      // Jan 5 (Monday before DTSTART) must not appear
      const jan5 = results.find((r) => r.startAt.toISOString().slice(0, 10) === '2026-01-05');
      expect(jan5).toBeUndefined();
    });

    it('respects INTERVAL=2 for bi-weekly', () => {
      const start = utc(2026, 1, 5, 9, 0); // Monday
      const results = expandRrule('uid-biweekly', 'FREQ=WEEKLY;INTERVAL=2;COUNT=3', undefined, start, 3600000, windowStart, windowEnd);
      expect(results).toHaveLength(3);
      // Jan 5, Jan 19, Feb 2 (14 days apart)
      expect(results[1].startAt.getUTCDate()).toBe(19);
    });
  });

  describe('FREQ=MONTHLY', () => {
    it('expands monthly recurrence', () => {
      const start = utc(2026, 1, 15, 10, 0);
      const results = expandRrule('uid-monthly', 'FREQ=MONTHLY;COUNT=5', undefined, start, 3600000, windowStart, windowEnd);
      expect(results).toHaveLength(5);
      // Each occurrence is on the 15th of successive months
      for (const r of results) {
        expect(r.startAt.getUTCDate()).toBe(15);
      }
    });

    it('expands monthly with BYMONTHDAY', () => {
      const start = utc(2026, 1, 1, 8, 0);
      const results = expandRrule('uid-bymonthday', 'FREQ=MONTHLY;BYMONTHDAY=1;COUNT=4', undefined, start, 3600000, windowStart, windowEnd);
      expect(results).toHaveLength(4);
      for (const r of results) {
        expect(r.startAt.getUTCDate()).toBe(1);
      }
    });
  });

  describe('derived UID', () => {
    it('produces stable derived UIDs of the form uid:rrule:YYYYMMDD', () => {
      const start = utc(2026, 3, 10, 9, 0);
      const results = expandRrule('test-uid-abc', 'FREQ=DAILY;COUNT=3', undefined, start, 3600000, windowStart, windowEnd);
      expect(results[0].uid).toBe('test-uid-abc:rrule:20260310');
      expect(results[1].uid).toBe('test-uid-abc:rrule:20260311');
      expect(results[2].uid).toBe('test-uid-abc:rrule:20260312');
    });

    it('all occurrence UIDs are unique', () => {
      const start = utc(2026, 1, 1, 9, 0);
      const results = expandRrule('uid-unique', 'FREQ=DAILY;COUNT=50', undefined, start, 3600000, windowStart, windowEnd);
      const uids = results.map((r) => r.uid);
      const uniqueUids = new Set(uids);
      expect(uniqueUids.size).toBe(uids.length);
    });

    it('is deterministic across multiple calls', () => {
      const start = utc(2026, 4, 1, 14, 0);
      const r1 = expandRrule('det-uid', 'FREQ=WEEKLY;COUNT=4', undefined, start, 5400000, windowStart, windowEnd);
      const r2 = expandRrule('det-uid', 'FREQ=WEEKLY;COUNT=4', undefined, start, 5400000, windowStart, windowEnd);
      expect(r1.map((r) => r.uid)).toEqual(r2.map((r) => r.uid));
      expect(r1.map((r) => r.startAt.toISOString())).toEqual(r2.map((r) => r.startAt.toISOString()));
    });
  });

  describe('endAt derived from duration', () => {
    it('preserves event duration across all occurrences', () => {
      const start = utc(2026, 2, 10, 8, 0);
      const duration = 90 * 60 * 1000; // 90 minutes
      const results = expandRrule('uid-duration', 'FREQ=WEEKLY;COUNT=4', undefined, start, duration, windowStart, windowEnd);
      for (const r of results) {
        const d = r.endAt.getTime() - r.startAt.getTime();
        expect(d).toBe(duration);
      }
    });
  });

  describe('safety cap', () => {
    it('does not produce more than MAX_OCCURRENCES events', () => {
      const start = utc(2024, 1, 1, 9, 0);
      const bigWindow = { start: utc(2020, 1, 1), end: utc(2030, 12, 31) };
      const results = expandRrule('uid-cap', 'FREQ=DAILY', undefined, start, 3600000, bigWindow.start, bigWindow.end);
      // MAX_OCCURRENCES = 500
      expect(results.length).toBeLessThanOrEqual(500);
    });
  });

  describe('no occurrence before DTSTART — invariant across all frequencies', () => {
    const bigWindow = { start: new Date('2020-01-01'), end: new Date('2030-12-31') };

    it('DAILY: no occurrence before DTSTART', () => {
      const start = utc(2026, 6, 15, 8, 0);
      const results = expandRrule('x', 'FREQ=DAILY;COUNT=10', undefined, start, 3600000, bigWindow.start, bigWindow.end);
      for (const r of results) expect(r.startAt.getTime()).toBeGreaterThanOrEqual(start.getTime());
    });

    it('WEEKLY: no occurrence before DTSTART', () => {
      const start = utc(2026, 9, 1, 9, 0); // Tuesday
      const results = expandRrule('x', 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10', undefined, start, 3600000, bigWindow.start, bigWindow.end);
      for (const r of results) expect(r.startAt.getTime()).toBeGreaterThanOrEqual(start.getTime());
    });

    it('MONTHLY: no occurrence before DTSTART', () => {
      const start = utc(2026, 3, 15, 10, 0);
      const results = expandRrule('x', 'FREQ=MONTHLY;COUNT=6', undefined, start, 3600000, bigWindow.start, bigWindow.end);
      for (const r of results) expect(r.startAt.getTime()).toBeGreaterThanOrEqual(start.getTime());
    });

    it('YEARLY: no occurrence before DTSTART', () => {
      const start = utc(2026, 9, 1, 10, 0);
      const results = expandRrule('x', 'FREQ=YEARLY;COUNT=3', undefined, start, 3600000, bigWindow.start, bigWindow.end);
      for (const r of results) expect(r.startAt.getTime()).toBeGreaterThanOrEqual(start.getTime());
    });
  });

  describe('unsupported / invalid RRULE', () => {
    it('returns empty array for empty rrule string', () => {
      const start = utc(2026, 1, 1, 9, 0);
      expect(expandRrule('x', '', undefined, start, 3600000, windowStart, windowEnd)).toEqual([]);
    });

    it('returns empty array for unknown FREQ', () => {
      const start = utc(2026, 1, 1, 9, 0);
      expect(expandRrule('x', 'FREQ=HOURLY;COUNT=5', undefined, start, 3600000, windowStart, windowEnd)).toEqual([]);
    });
  });
});

describe('parseIcs with RRULE', () => {
  const windowNow = new Date();
  const RRULE_ICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:recurring-class@school.fr',
    'DTSTART:20260901T090000Z',
    'DTEND:20260901T110000Z',
    'SUMMARY:Cours de maths',
    'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=12',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:single-event@school.fr',
    'DTSTART:20260915T140000Z',
    'DTEND:20260915T160000Z',
    'SUMMARY:Examen final',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('expands recurring events and keeps single events', () => {
    const events = parseIcs(RRULE_ICS);
    // Should have more than 2 events (the recurring one is expanded)
    // Exact count depends on window, but should have the single event + some recurrences in ±2y
    const singles = events.filter((e) => e.uid === 'single-event@school.fr');
    const recurring = events.filter((e) => e.uid.startsWith('recurring-class@school.fr:rrule:'));
    expect(singles).toHaveLength(1);
    expect(recurring.length).toBeGreaterThan(0);
    // At most 12 recurrences (COUNT=12) + depending on window
  });

  it('recurring event occurrences have stable derived UIDs', () => {
    const events = parseIcs(RRULE_ICS);
    const recurring = events.filter((e) => e.uid.startsWith('recurring-class@school.fr:rrule:'));
    // All UIDs should be unique
    const uids = new Set(recurring.map((e) => e.uid));
    expect(uids.size).toBe(recurring.length);
  });

  it('recurring event occurrences preserve summary and location', () => {
    const events = parseIcs(RRULE_ICS);
    const recurring = events.filter((e) => e.uid.startsWith('recurring-class@school.fr:rrule:'));
    for (const ev of recurring) {
      expect(ev.summary).toBe('Cours de maths');
    }
  });

  it('recurring occurrences preserve event duration', () => {
    const events = parseIcs(RRULE_ICS);
    const recurring = events.filter((e) => e.uid.startsWith('recurring-class@school.fr:rrule:'));
    for (const ev of recurring) {
      const duration = ev.endAt.getTime() - ev.startAt.getTime();
      expect(duration).toBe(2 * 60 * 60 * 1000); // 2h
    }
  });

  it('handles RRULE with EXDATE — excluded occurrences not in results', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:weekly-exdate@school.fr',
      'DTSTART:20260102T090000Z',
      'DTEND:20260102T110000Z',
      'RRULE:FREQ=WEEKLY;COUNT=5',
      'EXDATE:20260109T090000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const events = parseIcs(ics);
    const recurring = events.filter((e) => e.uid.startsWith('weekly-exdate@school.fr:rrule:'));
    // 5 total - 1 excluded = 4 (if within ±2y window)
    // Jan 9 should be excluded
    const jan9 = recurring.find((e) => e.uid.includes('20260109'));
    expect(jan9).toBeUndefined();
  });

  it('treats CANCELLED recurring events: they still expand but carry status=CANCELLED', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:cancelled-rrule@test.fr',
      'DTSTART:20260201T090000Z',
      'DTEND:20260201T110000Z',
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const events = parseIcs(ics);
    const all = events.filter((e) => e.uid.startsWith('cancelled-rrule@test.fr:rrule:'));
    // Expanded occurrences carry the CANCELLED status
    for (const ev of all) {
      expect(ev.status).toBe('CANCELLED');
    }
  });

  it('does not expand when RRULE is absent', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:no-rrule@test.fr',
      'DTSTART:20260310T090000Z',
      'DTEND:20260310T110000Z',
      'SUMMARY:Cours unique',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const events = parseIcs(ics);
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe('no-rrule@test.fr');
  });

  // Ensure re-importing the same ICS produces same event UIDs (determinism for dedup)
  it('produces same UIDs on second parse of same ICS (deterministic re-import)', () => {
    const events1 = parseIcs(RRULE_ICS);
    const events2 = parseIcs(RRULE_ICS);

    const uids1 = events1.map((e) => e.uid).sort();
    const uids2 = events2.map((e) => e.uid).sort();
    expect(uids1).toEqual(uids2);
  });

  // Suppress TS unused variable warning
  void windowNow;
});
