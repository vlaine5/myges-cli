import type { Prisma, PrismaClient } from '@prisma/client';
import { snapshotToEventDto, dedupeEvents } from './normalize';
import type { AcademicProviderId, RangeQuery } from './types';
import { AppError } from '../../lib/app-error';
import type { ProviderRegistryService } from '../providers/provider-registry.service';
import type { SettingsService } from '../settings/settings.service';
import { collapseEquivalentEvents } from './presentation';

export class EventsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerRegistryService: ProviderRegistryService,
    private readonly settingsService: SettingsService,
  ) {}

  private async resolveProvider(providerId?: AcademicProviderId) {
    return providerId
      ? this.providerRegistryService.getProvider(providerId)
      : this.providerRegistryService.getActiveProvider();
  }

  async refreshRange(
    range: RangeQuery,
    options: { includeRawPayload?: boolean; providerId?: AcademicProviderId; agendaId?: string } = {},
  ) {
    const provider = await this.resolveProvider(options.providerId);
    const fetchedEvents = await provider.fetchEvents(range, {
      includeRawPayload: options.includeRawPayload,
    });
    const deduped = collapseEquivalentEvents(dedupeEvents(fetchedEvents));
    const now = new Date();

    await this.prisma.$transaction(
      deduped.map((event) =>
        this.prisma.eventSnapshot.upsert({
          where: { id: event.id },
          update: {
            provider: event.provider,
            agendaId: options.agendaId ?? null,
            sourceId: event.sourceId,
            reservationId: event.reservationId,
            title: event.title,
            subject: event.subject,
            startAt: event.startAt,
            endAt: event.endAt,
            teacher: event.teacher,
            room: event.room,
            campus: event.campus,
            roomsJson: JSON.stringify(event.rooms),
            promotion: event.promotion,
            groupName: event.group,
            classesJson: JSON.stringify(event.classes),
            modality: event.modality,
            reservationType: event.reservationType,
            studentCount: event.studentCount,
            disciplineName: event.disciplineName,
            disciplineTeacher: event.disciplineTeacher,
            disciplineId: event.disciplineId,
            sourceHash: event.sourceHash,
            rawPayload: event.rawPayload,
            lastSeenAt: now,
          },
          create: {
            id: event.id,
            provider: event.provider,
            agendaId: options.agendaId ?? null,
            sourceId: event.sourceId,
            reservationId: event.reservationId,
            title: event.title,
            subject: event.subject,
            startAt: event.startAt,
            endAt: event.endAt,
            teacher: event.teacher,
            room: event.room,
            campus: event.campus,
            roomsJson: JSON.stringify(event.rooms),
            promotion: event.promotion,
            groupName: event.group,
            classesJson: JSON.stringify(event.classes),
            modality: event.modality,
            reservationType: event.reservationType,
            studentCount: event.studentCount,
            disciplineName: event.disciplineName,
            disciplineTeacher: event.disciplineTeacher,
            disciplineId: event.disciplineId,
            sourceHash: event.sourceHash,
            rawPayload: event.rawPayload,
            lastSeenAt: now,
          },
        }),
      ),
    );

    return {
      provider: provider.id,
      fetchedCount: fetchedEvents.length,
      dedupedCount: deduped.length,
      events: deduped,
      eventIds: deduped.map((event) => event.id),
    };
  }

  async listEvents(
    range: RangeQuery,
    options: {
      includeRawPayload?: boolean;
      /** Filter by provider. Omit (or pass undefined) to return ALL providers. */
      providerId?: AcademicProviderId;
      /** Filter by agendaId (AgendaConfig.id). */
      agendaId?: string;
    } = {},
  ) {
    const where: Prisma.EventSnapshotWhereInput = {
      startAt: { gte: range.start, lte: range.end },
    };

    if (options.providerId) {
      where.provider = options.providerId;
    }

    if (options.agendaId) {
      where.agendaId = options.agendaId;
    }

    const snapshots = await this.prisma.eventSnapshot.findMany({
      where,
      orderBy: { startAt: 'asc' },
    });

    return collapseEquivalentEvents(
      snapshots.map((snapshot) => snapshotToEventDto(snapshot, options.includeRawPayload)),
    );
  }

  /** Return distinct provider values present in EventSnapshot for the given range. */
  async listActiveProviders(range: RangeQuery): Promise<string[]> {
    const rows = await this.prisma.eventSnapshot.findMany({
      where: { startAt: { gte: range.start, lte: range.end } },
      select: { provider: true },
      distinct: ['provider'],
      orderBy: { provider: 'asc' },
    });
    return rows.map((r) => r.provider);
  }

  /** Delete events matching the given filters. Returns count of deleted rows. */
  async deleteEvents(options: {
    providerId?: string;
    agendaId?: string;
    scope: 'future' | 'all';
  }): Promise<{ deletedCount: number }> {
    const where: Prisma.EventSnapshotWhereInput = {};

    if (options.providerId) where.provider = options.providerId;
    if (options.agendaId) where.agendaId = options.agendaId;
    if (options.scope === 'future') where.startAt = { gte: new Date() };

    const { count } = await this.prisma.eventSnapshot.deleteMany({ where });
    return { deletedCount: count };
  }

  async getEventById(eventId: string, includeRawPayload = true) {
    const snapshot = await this.prisma.eventSnapshot.findUnique({
      where: { id: eventId },
    });

    if (!snapshot) {
      throw new AppError('Event not found.', 404, 'EVENT_NOT_FOUND');
    }

    return snapshotToEventDto(snapshot, includeRawPayload);
  }
}
