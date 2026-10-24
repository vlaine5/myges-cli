import type { PrismaClient } from '@prisma/client';
import { sha256 } from '../../lib/hash';
import { fetchAndParseIcs } from '../../lib/ics-parser';
import type { IcsEvent } from '../../lib/ics-parser';
import { buildNormalizedEvent } from '../events/normalize';
import type { AcademicProviderId, NormalizedEvent } from '../events/types';
import { collapseEquivalentEvents, shouldExcludeEvent } from '../events/presentation';
import { parseStructuredDescription } from '../events/structured-description';
import type { ReconciliationService } from '../reconciliation/reconciliation.service';

// Known noise values in CATEGORIES that should not be used as class names
const CATEGORIES_NOISE = new Set(['hyperplanning', 'cours', 'event', 'class', '']);

function cleanString(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function buildIcsSourceId(uid: string): string {
  return sha256(uid);
}

function normalizeIcsEvent(
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

export interface IcsSyncResult {
  fetched: number;
  upserted: number;
  deletedFuture: number;
  cancelled: number;
  skipped: number;
}

export class IcsSyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  /**
   * Smart ICS sync:
   * - Upserts all non-cancelled events from the ICS feed
   * - Removes CANCELLED events from future (keeps past cancelled events)
   * - Removes future events that have disappeared from the ICS entirely
   * - Never removes past events (they are permanent historical records)
   */
  async syncFromIcs(
    provider: AcademicProviderId,
    icsUrl: string,
    options: { includeRawPayload?: boolean; agendaId?: string } = {},
  ): Promise<IcsSyncResult> {
    const icsEvents = await fetchAndParseIcs(icsUrl);
    const now = new Date();

    let upserted = 0;
    let cancelled = 0;
    let skipped = 0;
    const normalizedEvents: NormalizedEvent[] = [];

    for (const icsEvent of icsEvents) {
      const isCancelled = icsEvent.status === 'CANCELLED';

      // Skip past cancelled events — don't delete historical records
      if (isCancelled && icsEvent.startAt <= now) {
        skipped += 1;
        continue;
      }

      // Remove future cancelled events
      if (isCancelled && icsEvent.startAt > now) {
        const sourceId = buildIcsSourceId(icsEvent.uid);
        const id = `${provider}:${sourceId}`;
        await this.prisma.eventSnapshot.deleteMany({
          where: { id, startAt: { gt: now } },
        });
        cancelled += 1;
        continue;
      }

      const normalized = normalizeIcsEvent(icsEvent, provider, options.includeRawPayload);
      if (shouldExcludeEvent(normalized)) {
        skipped += 1;
        continue;
      }
      normalizedEvents.push(normalized);
    }

    const collapsedEvents = collapseEquivalentEvents(normalizedEvents);
    const seenIds = new Set(collapsedEvents.map((event) => event.id));

    const existingIds = new Set(
      (
        await this.prisma.eventSnapshot.findMany({
          where: { id: { in: collapsedEvents.length > 0 ? collapsedEvents.map((e) => e.id) : ['__none__'] } },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    const newSnapshotIds: string[] = [];

    for (const normalized of collapsedEvents) {
      if (!existingIds.has(normalized.id)) {
        newSnapshotIds.push(normalized.id);
      }

      await this.prisma.eventSnapshot.upsert({
        where: { id: normalized.id },
        update: {
          provider: normalized.provider,
          agendaId: options.agendaId ?? null,
          sourceId: normalized.sourceId,
          title: normalized.title,
          subject: normalized.subject,
          startAt: normalized.startAt,
          endAt: normalized.endAt,
          teacher: normalized.teacher,
          room: normalized.room,
          campus: normalized.campus,
          roomsJson: JSON.stringify(normalized.rooms),
          promotion: normalized.promotion,
          groupName: normalized.group,
          classesJson: JSON.stringify(normalized.classes),
          modality: normalized.modality,
          reservationType: normalized.reservationType,
          studentCount: normalized.studentCount,
          disciplineName: normalized.disciplineName,
          disciplineTeacher: normalized.disciplineTeacher,
          disciplineId: normalized.disciplineId,
          sourceHash: normalized.sourceHash,
          rawPayload: normalized.rawPayload,
          lastSeenAt: now,
        },
        create: {
          id: normalized.id,
          provider: normalized.provider,
          agendaId: options.agendaId ?? null,
          sourceId: normalized.sourceId,
          reservationId: normalized.reservationId,
          title: normalized.title,
          subject: normalized.subject,
          startAt: normalized.startAt,
          endAt: normalized.endAt,
          teacher: normalized.teacher,
          room: normalized.room,
          campus: normalized.campus,
          roomsJson: JSON.stringify(normalized.rooms),
          promotion: normalized.promotion,
          groupName: normalized.group,
          classesJson: JSON.stringify(normalized.classes),
          modality: normalized.modality,
          reservationType: normalized.reservationType,
          studentCount: normalized.studentCount,
          disciplineName: normalized.disciplineName,
          disciplineTeacher: normalized.disciplineTeacher,
          disciplineId: normalized.disciplineId,
          sourceHash: normalized.sourceHash,
          rawPayload: normalized.rawPayload,
          lastSeenAt: now,
          globalEvent: {
            create: {
              title: normalized.title,
              subject: normalized.subject,
              startAt: normalized.startAt,
              endAt: normalized.endAt,
              teacher: normalized.teacher,
              room: normalized.room,
              campus: normalized.campus,
              promotion: normalized.promotion,
              groupName: normalized.group,
              modality: normalized.modality,
              primarySnapshotId: normalized.id,
            },
          },
        },
      });
      upserted += 1;
    }

    await this.reconciliationService.reconcileNewSnapshots(newSnapshotIds);

    // Remove future events from this provider/agenda that have disappeared from the ICS
    // (past events are NEVER deleted — they are permanent historical records)
    // Scope by agendaId when available so other agendas' events are not affected.
    const storedFuture = await this.prisma.eventSnapshot.findMany({
      where: {
        provider,
        ...(options.agendaId ? { agendaId: options.agendaId } : {}),
        startAt: { gt: now },
      },
      select: { id: true },
    });

    const toDelete = storedFuture.filter((row) => !seenIds.has(row.id));
    let deletedFuture = 0;

    if (toDelete.length > 0) {
      const result = await this.prisma.eventSnapshot.deleteMany({
        where: {
          id: { in: toDelete.map((row) => row.id) },
          startAt: { gt: now }, // double-check safety: only future
        },
      });
      deletedFuture = result.count;
    }

    return {
      fetched: icsEvents.length,
      upserted,
      deletedFuture,
      cancelled,
      skipped,
    };
  }
}
