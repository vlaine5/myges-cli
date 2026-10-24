import { sha256 } from '../../lib/hash';
import { fetchAndParseIcs } from '../../lib/ics-parser';
import type { IcsEvent } from '../../lib/ics-parser';
import { buildNormalizedEvent } from './normalize';
import type { AcademicProviderId, NormalizedEvent } from './types';
import { shouldExcludeEvent } from './presentation';
import { parseStructuredDescription } from './structured-description';

// Known noise values in CATEGORIES that should not be used as class names
const CATEGORIES_NOISE = new Set(['hyperplanning', 'cours', 'event', 'class', '']);

function cleanString(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function buildIcsSourceId(uid: string): string {
  return sha256(uid);
}

/**
 * Normalize a single parsed ICS VEVENT into the shared NormalizedEvent shape.
 * Shared by IcsSyncService (manual/legacy one-off ICS sync) and EventsService's
 * ICS-mode refreshRange() branch — do not duplicate this logic elsewhere.
 */
export function normalizeIcsEvent(
  event: IcsEvent,
  provider: AcademicProviderId,
  includeRawPayload = false,
): NormalizedEvent {
  const sourceId = buildIcsSourceId(event.uid);

  // Parse structured description fields
  const desc = parseStructuredDescription(event.description);

  // Filter meaningful categories (exclude noise like HYPERPLANNING)
  const categoryClasses = event.categories.filter(
    (c) => !CATEGORIES_NOISE.has(c.toLowerCase()),
  );

  // Merge classes from description groups + categories
  const allClasses = [...new Set([...desc.groups, ...categoryClasses])].filter(Boolean);

  // Room: prefer LOCATION field, fallback to description salle
  const location = cleanString(event.location) ?? desc.room;

  // Title: use SUMMARY
  const title = cleanString(event.summary) ?? 'Cours';

  // Subject: prefer description matière, fallback to summary
  const subject = desc.subject ?? title;

  // Teacher from description
  const teacher = desc.teacher;

  return buildNormalizedEvent({
    provider,
    sourceId,
    reservationId: null,
    title,
    subject,
    startAt: event.startAt,
    endAt: event.endAt,
    teacher,
    room: location,
    campus: null,
    rooms: location
      ? [{ name: location, floor: null, campus: null, address: null }]
      : [],
    promotion: allClasses[0] ?? null,
    group: allClasses[0] ?? null,
    classes: allClasses,
    modality: desc.modality,
    reservationType: desc.activityType,
    studentCount: desc.studentCount,
    disciplineName: subject,
    disciplineTeacher: teacher,
    disciplineId: null,
    rawPayload: includeRawPayload ? JSON.stringify(event.raw) : null,
  });
}

/**
 * Fetch an ICS feed and return it as normalized events, ready for the same
 * dedupe/collapse/upsert pipeline used for live-API-sourced events.
 *
 * CANCELLED events are simply dropped from the result — they are treated as
 * absent from the source, exactly like an event that was removed from a live
 * provider feed. Downstream "disappeared from source" delete logic (plan-sync /
 * SyncService) already handles this correctly without any special-casing here.
 */
export async function fetchNormalizedIcsEvents(
  icsUrl: string,
  provider: AcademicProviderId,
  options: { includeRawPayload?: boolean } = {},
): Promise<NormalizedEvent[]> {
  const icsEvents = await fetchAndParseIcs(icsUrl);
  const normalized: NormalizedEvent[] = [];

  for (const icsEvent of icsEvents) {
    if (icsEvent.status === 'CANCELLED') {
      continue;
    }

    const event = normalizeIcsEvent(icsEvent, provider, options.includeRawPayload);
    if (shouldExcludeEvent(event)) {
      continue;
    }

    normalized.push(event);
  }

  return normalized;
}
