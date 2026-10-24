/**
 * Basic RRULE expander for iCalendar recurring events.
 *
 * Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, UNTIL, COUNT, BYDAY, EXDATE.
 * Not supported: BYSETPOS, BYHOUR, BYMINUTE, BYSECOND, complex BYMONTH combos.
 *
 * Design constraints:
 * - Max occurrences per rule: MAX_OCCURRENCES (safety cap against infinite loops)
 * - Expansion window: caller supplies start/end bounds
 * - Each occurrence gets a stable derived UID: `${originalUid}:rrule:${YYYYMMDD}`
 *   so re-importing the same feed produces the same event IDs.
 */

export interface RruleExpansion {
  /** Occurrence start date */
  startAt: Date;
  /** Occurrence end date (startAt + original duration) */
  endAt: Date;
  /** Stable derived UID for this occurrence */
  uid: string;
}

const MAX_OCCURRENCES = 500;

const DAY_OF_WEEK: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

interface ParsedRrule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  until: Date | null;
  count: number | null;
  byDay: number[];      // 0=Sun, 1=Mon, ..., 6=Sat
  byMonthDay: number[]; // 1-31
}

function parseRrule(rruleStr: string): ParsedRrule | null {
  const parts: Record<string, string> = {};
  for (const segment of rruleStr.split(';')) {
    const eqIdx = segment.indexOf('=');
    if (eqIdx === -1) continue;
    parts[segment.slice(0, eqIdx).trim().toUpperCase()] = segment.slice(eqIdx + 1).trim();
  }

  const freq = parts['FREQ']?.toUpperCase();
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;

  const interval = parts['INTERVAL'] ? Math.max(1, parseInt(parts['INTERVAL'], 10)) : 1;

  let until: Date | null = null;
  if (parts['UNTIL']) {
    const u = parseRruleDate(parts['UNTIL']);
    if (u) until = u;
  }

  const count = parts['COUNT'] ? Math.max(1, parseInt(parts['COUNT'], 10)) : null;

  const byDay: number[] = [];
  if (parts['BYDAY']) {
    for (const token of parts['BYDAY'].split(',')) {
      // Token can be "MO", "+1MO", "-1MO" — extract last 2 chars for day name
      const dayCode = token.replace(/^[+-]?\d*/, '').trim().toUpperCase().slice(0, 2);
      const dow = DAY_OF_WEEK[dayCode];
      if (dow !== undefined) byDay.push(dow);
    }
  }

  const byMonthDay: number[] = [];
  if (parts['BYMONTHDAY']) {
    for (const token of parts['BYMONTHDAY'].split(',')) {
      const n = parseInt(token.trim(), 10);
      if (!isNaN(n)) byMonthDay.push(n);
    }
  }

  return {
    freq: freq as ParsedRrule['freq'],
    interval,
    until,
    count,
    byDay,
    byMonthDay,
  };
}

function parseRruleDate(value: string): Date | null {
  // Handles: 20261231T000000Z, 20261231T000000, 20261231
  const clean = value.trim();
  if (/^\d{8}T\d{6}Z$/.test(clean)) {
    return new Date(
      `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T${clean.slice(9, 11)}:${clean.slice(11, 13)}:${clean.slice(13, 15)}Z`,
    );
  }
  if (/^\d{8}T\d{6}$/.test(clean)) {
    return new Date(
      `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T${clean.slice(9, 11)}:${clean.slice(11, 13)}:${clean.slice(13, 15)}`,
    );
  }
  if (/^\d{8}$/.test(clean)) {
    return new Date(`${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`);
  }
  return null;
}

function parseExDates(exdateStr: string | undefined): Set<string> {
  const result = new Set<string>();
  if (!exdateStr) return result;
  for (const token of exdateStr.split(',')) {
    const d = parseRruleDate(token.trim());
    if (d) {
      // Normalize to YYYY-MM-DD for comparison
      result.add(d.toISOString().slice(0, 10));
    }
  }
  return result;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function addYears(date: Date, n: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + n);
  return d;
}

function dateToYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Expand a recurring VEVENT into individual occurrences within [windowStart, windowEnd].
 *
 * @param originalUid     - The original event UID
 * @param rruleStr        - The RRULE property value (without "RRULE:" prefix)
 * @param exdateStr       - Optional EXDATE value (comma-separated dates)
 * @param dtstart         - The event's DTSTART
 * @param duration        - Duration in milliseconds (endAt - startAt)
 * @param windowStart     - Start of expansion window (inclusive)
 * @param windowEnd       - End of expansion window (inclusive)
 */
export function expandRrule(
  originalUid: string,
  rruleStr: string,
  exdateStr: string | undefined,
  dtstart: Date,
  duration: number,
  windowStart: Date,
  windowEnd: Date,
): RruleExpansion[] {
  const rule = parseRrule(rruleStr);
  if (!rule) return [];

  const exDates = parseExDates(exdateStr);
  const results: RruleExpansion[] = [];
  let current = new Date(dtstart);
  let count = 0;
  const maxTotal = rule.count ?? MAX_OCCURRENCES;

  while (count < maxTotal && current <= windowEnd) {
    // Check UNTIL
    if (rule.until && current > rule.until) break;

    const occurrences = getCandidatesForDate(current, rule);

    for (const occ of occurrences) {
      if (count >= maxTotal) break;
      if (occ > windowEnd) break;

      // Never emit occurrences before DTSTART — the recurrence set only begins at dtstart.
      // This matters for WEEKLY+BYDAY when DTSTART falls mid-week: occurrences on BYDAY
      // days earlier in that same week must be excluded.
      if (occ < dtstart) continue;

      const exDateKey = occ.toISOString().slice(0, 10);
      if (exDates.has(exDateKey)) continue;

      if (rule.until && occ > rule.until) continue;

      if (occ >= windowStart && occ <= windowEnd) {
        const yyyymmdd = dateToYYYYMMDD(occ);
        results.push({
          startAt: occ,
          endAt: new Date(occ.getTime() + duration),
          uid: `${originalUid}:rrule:${yyyymmdd}`,
        });
        count += 1;
      } else if (occ < windowStart) {
        count += 1; // Count toward COUNT limit but don't emit
      }
    }

    // Advance to next period
    current = advancePeriod(current, rule);
    if (current.getTime() === new Date(dtstart).getTime()) break; // safety
  }

  return results;
}

/**
 * For WEEKLY with BYDAY, the "current" date might be a week boundary,
 * and we need to emit one occurrence per matching day-of-week.
 */
function getCandidatesForDate(current: Date, rule: ParsedRrule): Date[] {
  if (rule.freq === 'WEEKLY' && rule.byDay.length > 0) {
    // Find the start of this week (Sunday)
    const weekStart = new Date(current);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    return rule.byDay
      .map((dow) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + dow);
        // Preserve time from current
        d.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), 0);
        return d;
      })
      .sort((a, b) => a.getTime() - b.getTime());
  }

  if (rule.freq === 'MONTHLY' && rule.byMonthDay.length > 0) {
    return rule.byMonthDay.map((day) => {
      const d = new Date(current.getFullYear(), current.getMonth(), day,
        current.getHours(), current.getMinutes(), current.getSeconds());
      return d;
    });
  }

  if (rule.freq === 'MONTHLY' && rule.byDay.length > 0) {
    // e.g., BYDAY=MO means first/any Monday of the month
    // Emit the first occurrence of that day in the month
    const candidates: Date[] = [];
    for (const dow of rule.byDay) {
      const d = new Date(current.getFullYear(), current.getMonth(), 1,
        current.getHours(), current.getMinutes(), current.getSeconds());
      while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
      candidates.push(new Date(d));
    }
    return candidates;
  }

  return [new Date(current)];
}

function advancePeriod(current: Date, rule: ParsedRrule): Date {
  switch (rule.freq) {
    case 'DAILY':
      return addDays(current, rule.interval);
    case 'WEEKLY':
      return addDays(current, 7 * rule.interval);
    case 'MONTHLY':
      return addMonths(current, rule.interval);
    case 'YEARLY':
      return addYears(current, rule.interval);
  }
}
