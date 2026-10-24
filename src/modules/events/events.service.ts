import type { Prisma, PrismaClient } from '@prisma/client';
import { snapshotToEventDto, dedupeEvents } from './normalize';
import type { AcademicProviderId, NormalizedEvent, RangeQuery } from './types';
import { AppError } from '../../lib/app-error';
import type { ProviderRegistryService } from '../providers/provider-registry.service';
import type { SettingsService } from '../settings/settings.service';
import { collapseEquivalentEvents } from './presentation';
import type { ProviderCredentialStore } from '../providers/provider-credential.store';
import { fetchNormalizedIcsEvents } from './ics-normalize';
import type { EnrichmentRuleService } from '../enrichment/enrichment-rule.service';
import { applyEnrichmentToEvent } from '../enrichment/enrichment-rule.service';

export class EventsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerRegistryService: ProviderRegistryService,
    private readonly settingsService: SettingsService,
    private readonly providerCredentialStore: ProviderCredentialStore,
    private readonly enrichmentRuleService: EnrichmentRuleService,
  ) {}

  private async resolveProvider(providerId?: AcademicProviderId) {
    return providerId
      ? this.providerRegistryService.getProvider(providerId)
      : this.providerRegistryService.getActiveProvider();
  }

  /**
   * Returns a non-empty ICS URL configured for this provider, if any — in
   * which case it takes precedence over the live API/credential fetch path
   * for every sync trigger (manual, dry-run, scheduled, startup), per the
   * "one provider = one synced agenda" model.
   */
  private async resolveIcsUrl(providerId: AcademicProviderId): Promise<string | null> {
    const record = await this.providerCredentialStore.get(providerId);
    if (!record) return null;

    const config = this.providerCredentialStore.getConfig(record);
    const icsUrl = config.icsUrl;
    return typeof icsUrl === 'string' && icsUrl.trim().length > 0 ? icsUrl.trim() : null;
  }

  async refreshRange(
    range: RangeQuery,
    options: { includeRawPayload?: boolean; providerId?: AcademicProviderId; agendaId?: string } = {},
  ) {
    const provider = await this.resolveProvider(options.providerId);
    const icsUrl = await this.resolveIcsUrl(provider.id);

    const fetchedEvents: NormalizedEvent[] = icsUrl
      ? await fetchNormalizedIcsEvents(icsUrl, provider.id, {
          includeRawPayload: options.includeRawPayload,
        })
      : await provider.fetchEvents(range, {
          includeRawPayload: options.includeRawPayload,
        });

    const enabledRules = (await this.enrichmentRuleService.list()).filter((rule) => rule.enabled);
    const enrichedEvents = enabledRules.length > 0
      ? fetchedEvents.map((event) => applyEnrichmentToEvent(event, enabledRules))
      : fetchedEvents;

    const deduped = collapseEquivalentEvents(dedupeEvents(enrichedEvents));
    const now = new Date();

    // Snapshot ids that don't exist yet are brand-new occurrences: reconciliation
    // (run by the caller, after this transaction commits) only evaluates these —
    // a snapshot that merely changed content already belongs to a GlobalEvent and
    // its membership isn't re-litigated on every sync.
    const existingIds = new Set(
      (
        await this.prisma.eventSnapshot.findMany({
          where: { id: { in: deduped.length > 0 ? deduped.map((event) => event.id) : ['__none__'] } },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    const newSnapshotIds = deduped.filter((event) => !existingIds.has(event.id)).map((event) => event.id);

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
            // Every snapshot is born as its own solo GlobalEvent (1:1 by
            // default). Reconciliation may later merge it into an existing one
            // on strong evidence — it never leaves a snapshot without a
            // GlobalEvent, so this must happen in the same write.
            globalEvent: {
              create: {
                title: event.title,
                subject: event.subject,
                startAt: event.startAt,
                endAt: event.endAt,
                teacher: event.teacher,
                room: event.room,
                campus: event.campus,
                promotion: event.promotion,
                groupName: event.group,
                modality: event.modality,
                primarySnapshotId: event.id,
              },
            },
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
      newSnapshotIds,
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
