/**
 * Minimal ICS/iCalendar parser.
 * Handles DTSTART/DTEND with UTC (Z suffix) and TZID formats.
 * RRULE: expands recurring events in a ±2-year window around today.
 * Each occurrence gets a stable derived UID: `${originalUid}:rrule:${YYYYMMDD}`.
 */

import { AppError } from './app-error';
import { expandRrule } from './rrule-expander';

export interface IcsEvent {
  uid: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  status: string | null;
  categories: string[];
  organizer: string | null;
  raw: Record<string, string>;
}

function unfoldLines(raw: string): string[] {
  // RFC 5545: lines folded with CRLF + whitespace
  return raw
    .replace(/\r\n[ \t]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseProperty(line: string): { name: string; params: string; value: string } | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;

  const namePart = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);

  const semicolonIdx = namePart.indexOf(';');
  const name = semicolonIdx === -1 ? namePart : namePart.slice(0, semicolonIdx);
  const params = semicolonIdx === -1 ? '' : namePart.slice(semicolonIdx + 1);

  return { name: name.toUpperCase(), params, value };
}

function parseIcsDate(value: string, params: string): Date | null {
  // Extract TZID from params (TZID=Europe/Paris)
  const tzidMatch = params.match(/TZID=([^;]+)/i);
  const tzid = tzidMatch?.[1] ?? null;

  // All-day: 20240101
  if (/^\d{8}$/.test(value)) {
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  }

  // UTC: 20240101T090000Z
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return new Date(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`,
    );
  }

  // Local: 20240101T090000 (with optional TZID)
  if (/^\d{8}T\d{6}$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;

    if (tzid) {
      // Use Intl to convert to UTC
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tzid,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
        // Build a Date assuming the local time is in the given TZ
        const tempDate = new Date(iso + 'Z'); // treat as UTC first to get a number
        // Adjust: find the offset for this tz at this moment
        const parts = formatter.formatToParts(tempDate);
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
        // Re-parse using the timezone-corrected string
        const corrected = new Date(
          `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`,
        );
        const diff = corrected.getTime() - tempDate.getTime();
        return new Date(tempDate.getTime() - diff);
      } catch {
        return new Date(iso);
      }
    }

    return new Date(iso);
  }

  // Fallback: try native Date parse
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function decodeIcsText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

export function parseIcs(rawContent: string): IcsEvent[] {
  const lines = unfoldLines(rawContent);
  const events: IcsEvent[] = [];
  let inVEvent = false;
  let current: Record<string, string> = {};
  let currentParams: Record<string, string> = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inVEvent = true;
      current = {};
      currentParams = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      inVEvent = false;

      const uid = current['UID'] ?? '';
      const dtstart = current['DTSTART'];
      const dtend = current['DTEND'] ?? current['DUE'];
      const startParams = currentParams['DTSTART'] ?? '';
      const endParams = currentParams['DTEND'] ?? '';

      if (!dtstart || !uid) {
        continue;
      }

      const startAt = parseIcsDate(dtstart, startParams);
      const endAt = dtend ? parseIcsDate(dtend, endParams) : startAt;

      if (!startAt || !endAt) {
        continue;
      }

      const status = current['STATUS'] ?? null;
      const rrule = current['RRULE'];

      // If RRULE is present, expand occurrences in a ±2-year window
      if (rrule) {
        const windowStart = new Date();
        windowStart.setFullYear(windowStart.getFullYear() - 2);
        const windowEnd = new Date();
        windowEnd.setFullYear(windowEnd.getFullYear() + 2);

        const duration = endAt.getTime() - startAt.getTime();
        const expansions = expandRrule(
          uid,
          rrule,
          current['EXDATE'],
          startAt,
          duration,
          windowStart,
          windowEnd,
        );

        const sharedFields = {
          summary: current['SUMMARY'] ? decodeIcsText(current['SUMMARY']) : null,
          description: current['DESCRIPTION'] ? decodeIcsText(current['DESCRIPTION']) : null,
          location: current['LOCATION'] ? decodeIcsText(current['LOCATION']) : null,
          status: status?.toUpperCase() ?? null,
          categories: (current['CATEGORIES'] ?? '')
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
          organizer: current['ORGANIZER'] ?? null,
          raw: current,
        };

        for (const exp of expansions) {
          events.push({ ...sharedFields, uid: exp.uid, startAt: exp.startAt, endAt: exp.endAt });
        }
        continue;
      }

      events.push({
        uid,
        summary: current['SUMMARY'] ? decodeIcsText(current['SUMMARY']) : null,
        description: current['DESCRIPTION'] ? decodeIcsText(current['DESCRIPTION']) : null,
        location: current['LOCATION'] ? decodeIcsText(current['LOCATION']) : null,
        startAt,
        endAt,
        status: status?.toUpperCase() ?? null,
        categories: (current['CATEGORIES'] ?? '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        organizer: current['ORGANIZER'] ?? null,
        raw: current,
      });
      continue;
    }

    if (!inVEvent) {
      continue;
    }

    const parsed = parseProperty(line);
    if (!parsed) {
      continue;
    }

    current[parsed.name] = parsed.value;
    if (parsed.params) {
      currentParams[parsed.name] = parsed.params;
    }
  }

  return events;
}

export async function fetchAndParseIcs(icsUrl: string): Promise<IcsEvent[]> {
  let response: Response;

  try {
    response = await fetch(icsUrl, {
      headers: {
        Accept: 'text/calendar, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; AcademicSync/1.0)',
      },
    });
  } catch (fetchError) {
    const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    throw new AppError(`ICS fetch failed for ${icsUrl}: ${msg}`, 502, 'ICS_FETCH_FAILED');
  }

  if (!response.ok) {
    throw new AppError(`ICS fetch failed: HTTP ${response.status} on ${icsUrl}`, 502, 'ICS_FETCH_FAILED');
  }

  const text = await response.text();

  if (!text.includes('BEGIN:VCALENDAR') && !text.includes('BEGIN:VEVENT')) {
    throw new AppError(`URL did not return a valid ICS calendar: ${icsUrl}`, 422, 'ICS_INVALID_FORMAT');
  }

  return parseIcs(text);
}
