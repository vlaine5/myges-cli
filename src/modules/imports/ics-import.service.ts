import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/app-error';
import { detectProviderFromIcs } from '../../lib/ics-provider-detector';
import { detectProviderFromEvent } from '../../lib/ics-event-provider-detector';
import { fetchAndParseIcs, parseIcs } from '../../lib/ics-parser';
import type { IcsEvent } from '../../lib/ics-parser';
import { sha256 } from '../../lib/hash';
import { buildNormalizedEvent } from '../events/normalize';
import type { AcademicProviderId, NormalizedEvent } from '../events/types';
import { collapseEquivalentEvents, shouldExcludeEvent } from '../events/presentation';
import { parseStructuredDescription } from '../events/structured-description';

// Known noise category values that are not useful as class names
const CATEGORIES_NOISE = new Set(['hyperplanning', 'cours', 'event', 'class', '']);

function cleanString(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function buildIcsSourceId(uid: string): string {
  return sha256(uid);
}

/** Normalize a single ICS event into the shared NormalizedEvent model. */
function normalizeIcsEvent(
  event: IcsEvent,
  provider: AcademicProviderId,
): NormalizedEvent {
  const sourceId = buildIcsSourceId(event.uid);
  const desc = parseStructuredDescription(event.description);

  const categoryClasses = event.categories.filter(
    (c) => !CATEGORIES_NOISE.has(c.toLowerCase()),
  );
  const allClasses = [...new Set([...desc.groups, ...categoryClasses])].filter(Boolean);
  const location = cleanString(event.location) ?? desc.room;
  const title = cleanString(event.summary) ?? 'Cours';
  const subject = desc.subject ?? title;
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
    rooms: location ? [{ name: location, floor: null, campus: null, address: null }] : [],
    promotion: allClasses[0] ?? null,
    group: allClasses[0] ?? null,
    classes: allClasses,
    modality: desc.modality,
    reservationType: desc.activityType,
    studentCount: desc.studentCount,
    disciplineName: subject,
    disciplineTeacher: teacher,
    disciplineId: null,
    rawPayload: null,
  });
}

export interface ImportStats {
  fetched: number;
  created: number;
  updated: number;
  duplicates: number;
  skipped: number;
  cancelled: number;
}

export interface ReimportStats extends ImportStats {
  removedFutureCount: number;
  keptPastCount: number;
}

export interface IcsImportRecord {
  id: string;
  name: string;
  sourceType: 'manual_upload' | 'manual_url';
  provider: string;
  detectedProvider: string | null;
  detectionConfidence: string | null;
  icsUrl: string | null;
  originalFilename: string | null;
  status: string;
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  duplicateCount: number;
  skippedCount: number;
  errorMessage: string | null;
  removedFutureCount: number;
  keptPastCount: number;
  importedAt: string;
  lastReimportAt: string | null;
  updatedAt: string;
}

export interface IcsImportResult {
  import: IcsImportRecord;
  stats: ImportStats;
  detectionResult: {
    detectedProvider: string | null;
    detectionConfidence: string | null;
    detectionReason: string | null;
  };
}

export interface IcsReimportResult {
  import: IcsImportRecord;
  stats: ReimportStats;
  detectionResult: {
    detectedProvider: string | null;
    detectionConfidence: string | null;
    detectionReason: string | null;
  };
}

function toDto(row: {
  id: string;
  name: string;
  sourceType: string;
  provider: string;
  detectedProvider: string | null;
  detectionConfidence: string | null;
  icsUrl: string | null;
  originalFilename: string | null;
  status: string;
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  duplicateCount: number;
  skippedCount: number;
  errorMessage: string | null;
  removedFutureCount: number;
  keptPastCount: number;
  importedAt: Date;
  lastReimportAt: Date | null;
  updatedAt: Date;
}): IcsImportRecord {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.sourceType as 'manual_upload' | 'manual_url',
    provider: row.provider,
    detectedProvider: row.detectedProvider,
    detectionConfidence: row.detectionConfidence,
    icsUrl: row.icsUrl,
    originalFilename: row.originalFilename,
    status: row.status,
    fetchedCount: row.fetchedCount,
    createdCount: row.createdCount,
    updatedCount: row.updatedCount,
    duplicateCount: row.duplicateCount,
    skippedCount: row.skippedCount,
    errorMessage: row.errorMessage,
    removedFutureCount: row.removedFutureCount,
    keptPastCount: row.keptPastCount,
    importedAt: row.importedAt.toISOString(),
    lastReimportAt: row.lastReimportAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Detect provider from raw ICS content without full import.
 * Returns detection result only — no DB changes.
 */
export function detectProvider(content: string) {
  return detectProviderFromIcs(content);
}

interface ProcessResult {
  stats: ImportStats;
  /** All event IDs processed (created, updated, or duplicate — excludes skipped/cancelled) */
  seenEventIds: string[];
}

export type DeleteEventsStrategy = 'none' | 'future' | 'all';

export interface IcsEventPreview {
  uid: string;
  title: string | null;
  startAt: string;
  endAt: string;
  teacher: string | null;
  room: string | null;
  campus: string | null;
  classes: string[];
  subject: string | null;
  modality: string | null;
  studentCount: number | null;
  status: string | null;
  /** Provider detected at the event level (per-event heuristics). */
  eventDetectedProvider: string;
  eventDetectionConfidence: string;
  eventDetectionReason: string;
  /** Whether this event would be excluded by noise filtering. */
  isNoise: boolean;
}

export interface IcsPreviewResult {
  /** Provider detected from the whole ICS file (calendar-level signals). */
  fileDetection: {
    provider: string;
    confidence: string;
    reason: string;
  };
  total: number;
  cancelledCount: number;
  noiseCount: number;
  events: IcsEventPreview[];
  /** How many events have each event-level detected provider. */
  providerBreakdown: Record<string, number>;
}

/**
 * Build a preview of what an ICS file would produce, without committing anything to the DB.
 *
 * Returns per-event provider detection results and noise classification so the user
 * can review and filter before confirming the import.
 */
export function previewIcsContent(
  content: string,
  fallbackProvider: AcademicProviderId = 'generic',
): IcsPreviewResult {
  if (!content.includes('BEGIN:VCALENDAR') && !content.includes('BEGIN:VEVENT')) {
    throw new AppError('Content does not appear to be a valid ICS calendar.', 422, 'ICS_INVALID_FORMAT');
  }

  let icsEvents: IcsEvent[];
  try {
    icsEvents = parseIcs(content);
  } catch (error) {
    throw new AppError(
      `ICS parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      422,
      'ICS_PARSE_ERROR',
    );
  }

  const fileDetection = detectProviderFromIcs(content);

  let cancelledCount = 0;
  let noiseCount = 0;
  const providerBreakdown: Record<string, number> = {};
  const events: IcsEventPreview[] = [];

  for (const icsEvent of icsEvents) {
    if (icsEvent.status === 'CANCELLED') {
      cancelledCount += 1;
      continue;
    }

    // Per-event detection; fall back to file-level detection or the caller-supplied provider.
    const eventDetection = detectProviderFromEvent(icsEvent);
    const resolvedProvider: AcademicProviderId =
      eventDetection.confidence !== 'none'
        ? (eventDetection.provider as AcademicProviderId)
        : fileDetection.confidence !== 'none'
          ? (fileDetection.provider as AcademicProviderId)
          : fallbackProvider;

    const normalized = normalizeIcsEvent(icsEvent, resolvedProvider);
    const isNoise = shouldExcludeEvent(normalized);

    if (isNoise) {
      noiseCount += 1;
    }

    const displayProvider = eventDetection.confidence !== 'none'
      ? eventDetection.provider
      : fileDetection.confidence !== 'none'
        ? fileDetection.provider
        : fallbackProvider;

    providerBreakdown[displayProvider] = (providerBreakdown[displayProvider] ?? 0) + 1;

    events.push({
      uid: icsEvent.uid,
      title: normalized.title,
      startAt: normalized.startAt.toISOString(),
      endAt: normalized.endAt.toISOString(),
      teacher: normalized.teacher,
      room: normalized.room,
      campus: normalized.campus,
      classes: normalized.classes,
      subject: normalized.subject,
      modality: normalized.modality,
      studentCount: normalized.studentCount,
      status: icsEvent.status,
      eventDetectedProvider: eventDetection.provider,
      eventDetectionConfidence: eventDetection.confidence,
      eventDetectionReason: eventDetection.reason,
      isNoise,
    });
  }

  return {
    fileDetection: {
      provider: fileDetection.provider,
      confidence: fileDetection.confidence,
      reason: fileDetection.reason,
    },
    total: icsEvents.length,
    cancelledCount,
    noiseCount,
    events,
    providerBreakdown,
  };
}

export class IcsImportService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<IcsImportRecord[]> {
    const rows = await this.prisma.icsImport.findMany({
      orderBy: { importedAt: 'desc' },
    });
    return rows.map(toDto);
  }

  async getById(id: string): Promise<IcsImportRecord> {
    const row = await this.prisma.icsImport.findUnique({ where: { id } });
    if (!row) throw new AppError('Import not found.', 404, 'IMPORT_NOT_FOUND');
    return toDto(row);
  }

  /**
   * Delete an import record and optionally clean up linked events.
   *
   * - 'none' (default): deletes IcsImport + IcsImportEvent rows only; keeps EventSnapshot rows.
   * - 'future': also deletes exclusively-linked future EventSnapshot rows.
   * - 'all': also deletes exclusively-linked EventSnapshot rows (past and future).
   */
  async delete(id: string, deleteEvents: DeleteEventsStrategy = 'none'): Promise<{ removedEventCount: number }> {
    const existing = await this.prisma.icsImport.findUnique({ where: { id } });
    if (!existing) throw new AppError('Import not found.', 404, 'IMPORT_NOT_FOUND');

    let removedEventCount = 0;

    if (deleteEvents !== 'none') {
      const now = new Date();
      // Get all event IDs linked to this import
      const linkedRows = await this.prisma.icsImportEvent.findMany({
        where: { importId: id },
        select: { eventId: true },
      });
      const linkedEventIds = linkedRows.map((r) => r.eventId);

      if (linkedEventIds.length > 0) {
        // Find events shared with other imports
        const sharedRows = await this.prisma.icsImportEvent.findMany({
          where: { eventId: { in: linkedEventIds }, importId: { not: id } },
          select: { eventId: true },
        });
        const sharedEventIds = new Set(sharedRows.map((r) => r.eventId));

        // Get the events themselves to check dates
        const events = await this.prisma.eventSnapshot.findMany({
          where: { id: { in: linkedEventIds } },
          select: { id: true, startAt: true },
        });

        for (const ev of events) {
          if (sharedEventIds.has(ev.id)) continue; // shared — skip

          const isFuture = ev.startAt >= now;
          const shouldDelete =
            deleteEvents === 'all' || (deleteEvents === 'future' && isFuture);

          if (shouldDelete) {
            // Delete IcsImportEvent rows for this event first, then the snapshot
            await this.prisma.icsImportEvent.deleteMany({ where: { eventId: ev.id } });
            await this.prisma.eventSnapshot.delete({ where: { id: ev.id } });
            removedEventCount += 1;
          }
        }
      }
    }

    // Delete the import record (also removes remaining IcsImportEvent rows for this import)
    await this.prisma.icsImportEvent.deleteMany({ where: { importId: id } });
    await this.prisma.icsImport.delete({ where: { id } });

    return { removedEventCount };
  }

  /**
   * List events linked to an import via IcsImportEvent.
   */
  async getEvents(importId: string): Promise<{ id: string; title: string; startAt: string; endAt: string; provider: string }[]> {
    const existing = await this.prisma.icsImport.findUnique({ where: { id: importId } });
    if (!existing) throw new AppError('Import not found.', 404, 'IMPORT_NOT_FOUND');

    const links = await this.prisma.icsImportEvent.findMany({
      where: { importId },
      select: { eventId: true },
    });
    const eventIds = links.map((l) => l.eventId);

    if (eventIds.length === 0) return [];

    const events = await this.prisma.eventSnapshot.findMany({
      where: { id: { in: eventIds } },
      select: { id: true, title: true, startAt: true, endAt: true, provider: true },
      orderBy: { startAt: 'asc' },
    });

    return events.map((ev) => ({
      id: ev.id,
      title: ev.title,
      startAt: ev.startAt.toISOString(),
      endAt: ev.endAt.toISOString(),
      provider: ev.provider,
    }));
  }

  /**
   * Core import logic: additive upsert, with IcsImportEvent tracking.
   * CANCELLED events are skipped.
   * Returns stats and all event IDs that were seen (created, updated, or duplicate).
   */
  private async processEvents(
    icsEvents: IcsEvent[],
    provider: AcademicProviderId,
  ): Promise<ProcessResult> {
    const now = new Date();
    let skipped = 0;
    let cancelled = 0;
    const normalizedEvents: NormalizedEvent[] = [];

    for (const icsEvent of icsEvents) {
      if (icsEvent.status === 'CANCELLED') {
        cancelled += 1;
        continue;
      }

      const normalized = normalizeIcsEvent(icsEvent, provider);
      if (shouldExcludeEvent(normalized)) {
        skipped += 1;
        continue;
      }
      normalizedEvents.push(normalized);
    }

    // Collapse equivalent events within this batch
    const collapsedEvents = collapseEquivalentEvents(normalizedEvents);

    // Batch check existing events for deduplication
    const ids = collapsedEvents.map((ev) => ev.id);
    const existingRows = await this.prisma.eventSnapshot.findMany({
      where: { id: { in: ids } },
      select: { id: true, sourceHash: true },
    });
    const existingMap = new Map(existingRows.map((row) => [row.id, row.sourceHash]));

    let created = 0;
    let updated = 0;
    let duplicates = 0;

    for (const ev of collapsedEvents) {
      const existingHash = existingMap.get(ev.id);

      if (existingHash !== undefined && existingHash === ev.sourceHash) {
        duplicates += 1;
        continue;
      }

      const isUpdate = existingHash !== undefined;

      await this.prisma.eventSnapshot.upsert({
        where: { id: ev.id },
        update: {
          provider: ev.provider,
          sourceId: ev.sourceId,
          title: ev.title,
          subject: ev.subject,
          startAt: ev.startAt,
          endAt: ev.endAt,
          teacher: ev.teacher,
          room: ev.room,
          campus: ev.campus,
          roomsJson: JSON.stringify(ev.rooms),
          promotion: ev.promotion,
          groupName: ev.group,
          classesJson: JSON.stringify(ev.classes),
          modality: ev.modality,
          reservationType: ev.reservationType,
          studentCount: ev.studentCount,
          disciplineName: ev.disciplineName,
          disciplineTeacher: ev.disciplineTeacher,
          disciplineId: ev.disciplineId,
          sourceHash: ev.sourceHash,
          rawPayload: ev.rawPayload,
          lastSeenAt: now,
        },
        create: {
          id: ev.id,
          provider: ev.provider,
          sourceId: ev.sourceId,
          reservationId: ev.reservationId,
          title: ev.title,
          subject: ev.subject,
          startAt: ev.startAt,
          endAt: ev.endAt,
          teacher: ev.teacher,
          room: ev.room,
          campus: ev.campus,
          roomsJson: JSON.stringify(ev.rooms),
          promotion: ev.promotion,
          groupName: ev.group,
          classesJson: JSON.stringify(ev.classes),
          modality: ev.modality,
          reservationType: ev.reservationType,
          studentCount: ev.studentCount,
          disciplineName: ev.disciplineName,
          disciplineTeacher: ev.disciplineTeacher,
          disciplineId: ev.disciplineId,
          sourceHash: ev.sourceHash,
          rawPayload: ev.rawPayload,
          lastSeenAt: now,
        },
      });

      if (isUpdate) {
        updated += 1;
      } else {
        created += 1;
      }
    }

    return {
      stats: {
        fetched: icsEvents.length,
        created,
        updated,
        duplicates,
        skipped,
        cancelled,
      },
      // All event IDs we considered (including duplicates) — for IcsImportEvent tracking
      seenEventIds: ids,
    };
  }

  /**
   * Write IcsImportEvent links for all seen event IDs.
   * Filters out already-existing links to avoid primary key conflicts (SQLite lacks skipDuplicates).
   */
  private async linkEvents(importId: string, eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    // Fetch already-existing links for this import
    const existing = await this.prisma.icsImportEvent.findMany({
      where: { importId, eventId: { in: eventIds } },
      select: { eventId: true },
    });
    const existingSet = new Set(existing.map((r) => r.eventId));
    const newIds = eventIds.filter((id) => !existingSet.has(id));
    if (newIds.length === 0) return;
    await this.prisma.icsImportEvent.createMany({
      data: newIds.map((eventId) => ({ importId, eventId })),
    });
  }

  /**
   * Import from raw ICS text content (file upload).
   */
  async importFromContent(options: {
    content: string;
    provider: AcademicProviderId;
    name: string;
    filename?: string;
    detectedProvider?: string;
    detectionConfidence?: string;
    detectionReason?: string;
  }): Promise<IcsImportResult> {
    if (!options.content.includes('BEGIN:VCALENDAR') && !options.content.includes('BEGIN:VEVENT')) {
      throw new AppError('Content does not appear to be a valid ICS calendar.', 422, 'ICS_INVALID_FORMAT');
    }

    let icsEvents: IcsEvent[];
    try {
      icsEvents = parseIcs(options.content);
    } catch (error) {
      throw new AppError(
        `ICS parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        422,
        'ICS_PARSE_ERROR',
      );
    }

    const { stats, seenEventIds } = await this.processEvents(icsEvents, options.provider);

    const importId = randomUUID();
    const row = await this.prisma.icsImport.create({
      data: {
        id: importId,
        name: options.name,
        sourceType: 'manual_upload',
        provider: options.provider,
        detectedProvider: options.detectedProvider ?? null,
        detectionConfidence: options.detectionConfidence ?? null,
        icsUrl: null,
        originalFilename: options.filename ?? null,
        status: 'SUCCESS',
        fetchedCount: stats.fetched,
        createdCount: stats.created,
        updatedCount: stats.updated,
        duplicateCount: stats.duplicates,
        skippedCount: stats.skipped + stats.cancelled,
        removedFutureCount: 0,
        keptPastCount: 0,
        errorMessage: null,
        updatedAt: new Date(),
      },
    });

    await this.linkEvents(importId, seenEventIds);

    return {
      import: toDto(row),
      stats,
      detectionResult: {
        detectedProvider: options.detectedProvider ?? null,
        detectionConfidence: options.detectionConfidence ?? null,
        detectionReason: options.detectionReason ?? null,
      },
    };
  }

  /**
   * Import from a remote ICS URL.
   */
  async importFromUrl(options: {
    icsUrl: string;
    provider: AcademicProviderId;
    name: string;
    detectedProvider?: string;
    detectionConfidence?: string;
    detectionReason?: string;
  }): Promise<IcsImportResult> {
    let icsEvents: IcsEvent[];
    try {
      icsEvents = await fetchAndParseIcs(options.icsUrl);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'ICS fetch failed';
      const row = await this.prisma.icsImport.create({
        data: {
          id: randomUUID(),
          name: options.name,
          sourceType: 'manual_url',
          provider: options.provider,
          detectedProvider: options.detectedProvider ?? null,
          detectionConfidence: options.detectionConfidence ?? null,
          icsUrl: options.icsUrl,
          originalFilename: null,
          status: 'FAILED',
          fetchedCount: 0,
          createdCount: 0,
          updatedCount: 0,
          duplicateCount: 0,
          skippedCount: 0,
          removedFutureCount: 0,
          keptPastCount: 0,
          errorMessage,
          updatedAt: new Date(),
        },
      });
      throw new AppError(errorMessage, 502, 'ICS_FETCH_FAILED', { importId: row.id });
    }

    const { stats, seenEventIds } = await this.processEvents(icsEvents, options.provider);

    const importId = randomUUID();
    const row = await this.prisma.icsImport.create({
      data: {
        id: importId,
        name: options.name,
        sourceType: 'manual_url',
        provider: options.provider,
        detectedProvider: options.detectedProvider ?? null,
        detectionConfidence: options.detectionConfidence ?? null,
        icsUrl: options.icsUrl,
        originalFilename: null,
        status: 'SUCCESS',
        fetchedCount: stats.fetched,
        createdCount: stats.created,
        updatedCount: stats.updated,
        duplicateCount: stats.duplicates,
        skippedCount: stats.skipped + stats.cancelled,
        removedFutureCount: 0,
        keptPastCount: 0,
        errorMessage: null,
        updatedAt: new Date(),
      },
    });

    await this.linkEvents(importId, seenEventIds);

    return {
      import: toDto(row),
      stats,
      detectionResult: {
        detectedProvider: options.detectedProvider ?? null,
        detectionConfidence: options.detectionConfidence ?? null,
        detectionReason: options.detectionReason ?? null,
      },
    };
  }

  /**
   * Re-fetch and re-import a URL-based import with sync semantics:
   * - Events in the new feed → upsert (additive).
   * - Events that disappeared from the feed AND are in the future → deleted (if exclusively
   *   linked to this import) or unlinked (if shared with other imports).
   * - Events that disappeared AND are in the past → kept in DB, just unlinked from this import.
   */
  async reimport(id: string): Promise<IcsReimportResult> {
    const existing = await this.prisma.icsImport.findUnique({ where: { id } });
    if (!existing) throw new AppError('Import not found.', 404, 'IMPORT_NOT_FOUND');
    if (existing.sourceType !== 'manual_url' || !existing.icsUrl) {
      throw new AppError(
        'Only URL-based imports can be re-imported.',
        409,
        'IMPORT_REIMPORT_NOT_SUPPORTED',
      );
    }

    // Get event IDs from the previous import
    const previousLinks = await this.prisma.icsImportEvent.findMany({
      where: { importId: id },
      select: { eventId: true },
    });
    const previousEventIds = new Set(previousLinks.map((l) => l.eventId));

    let icsEvents: IcsEvent[];
    try {
      icsEvents = await fetchAndParseIcs(existing.icsUrl);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'ICS fetch failed';
      await this.prisma.icsImport.update({
        where: { id },
        data: { status: 'FAILED', errorMessage, lastReimportAt: new Date(), updatedAt: new Date() },
      });
      throw new AppError(errorMessage, 502, 'ICS_FETCH_FAILED');
    }

    const { stats, seenEventIds } = await this.processEvents(icsEvents, existing.provider as AcademicProviderId);
    const currentEventIds = new Set(seenEventIds);

    // Sync disappeared events
    const now = new Date();
    let removedFutureCount = 0;
    let keptPastCount = 0;

    const disappearedIds = [...previousEventIds].filter((eid) => !currentEventIds.has(eid));

    if (disappearedIds.length > 0) {
      // Find which disappeared events are shared with other imports
      const sharedRows = await this.prisma.icsImportEvent.findMany({
        where: { eventId: { in: disappearedIds }, importId: { not: id } },
        select: { eventId: true },
      });
      const sharedEventIds = new Set(sharedRows.map((r) => r.eventId));

      // Fetch the events to check their dates
      const disappearedEvents = await this.prisma.eventSnapshot.findMany({
        where: { id: { in: disappearedIds } },
        select: { id: true, startAt: true },
      });

      for (const ev of disappearedEvents) {
        const isFuture = ev.startAt >= now;

        if (isFuture) {
          if (!sharedEventIds.has(ev.id)) {
            // Exclusively linked to this import — safe to delete the EventSnapshot
            await this.prisma.icsImportEvent.deleteMany({ where: { eventId: ev.id } });
            await this.prisma.eventSnapshot.delete({ where: { id: ev.id } });
          } else {
            // Shared with other imports — only remove our link
            await this.prisma.icsImportEvent.deleteMany({ where: { importId: id, eventId: ev.id } });
          }
          removedFutureCount += 1;
        } else {
          // Past event — keep in DB, just remove our link
          await this.prisma.icsImportEvent.deleteMany({ where: { importId: id, eventId: ev.id } });
          keptPastCount += 1;
        }
      }
    }

    // Link new events from this reimport
    await this.linkEvents(id, seenEventIds);

    const updated = await this.prisma.icsImport.update({
      where: { id },
      data: {
        status: 'SUCCESS',
        fetchedCount: stats.fetched,
        createdCount: existing.createdCount + stats.created,
        updatedCount: existing.updatedCount + stats.updated,
        duplicateCount: existing.duplicateCount + stats.duplicates,
        skippedCount: existing.skippedCount + stats.skipped + stats.cancelled,
        removedFutureCount: existing.removedFutureCount + removedFutureCount,
        keptPastCount: existing.keptPastCount + keptPastCount,
        errorMessage: null,
        lastReimportAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return {
      import: toDto(updated),
      stats: { ...stats, removedFutureCount, keptPastCount },
      detectionResult: {
        detectedProvider: existing.detectedProvider,
        detectionConfidence: existing.detectionConfidence,
        detectionReason: null,
      },
    };
  }
}
