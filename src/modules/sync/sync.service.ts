import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
import { getRangeFromOffsets } from '../../lib/time';
import type { AcademicProviderId } from '../events/types';
import type { EventsService } from '../events/events.service';
import { buildGoogleEvent } from '../google/google-event.mapper';
import type { ProviderRegistryService } from '../providers/provider-registry.service';
import type { SettingsService } from '../settings/settings.service';
import type { GoogleCalendarService } from '../google/google-calendar.service';
import type { IcsExportService } from '../export/ics-export.service';
import { planSyncActions } from './plan-sync';

export interface SyncRunOptions {
  trigger: 'MANUAL' | 'SCHEDULED' | 'STARTUP';
  dryRun?: boolean;
  providerId?: AcademicProviderId;
  agendaId?: string;
  range?: {
    start: Date;
    end: Date;
  };
}

export class SyncService {
  private currentRun: Promise<unknown> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly eventsService: EventsService,
    private readonly providerRegistryService: ProviderRegistryService,
    private readonly settingsService: SettingsService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly icsExportService: IcsExportService,
  ) {}

  isRunning() {
    return this.currentRun !== null;
  }

  async markInterruptedJobsAsFailed() {
    const result = await this.prisma.syncJob.updateMany({
      where: {
        status: 'RUNNING',
        finishedAt: null,
      },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: 'Process restarted before completion.',
      },
    });

    return result.count;
  }

  async run(options: SyncRunOptions) {
    if (this.currentRun) {
      throw new AppError('A sync job is already running.', 409, 'SYNC_ALREADY_RUNNING');
    }

    const runPromise = this.runInternal(options).finally(() => {
      this.currentRun = null;
    });

    this.currentRun = runPromise;

    return runPromise;
  }

  async listHistory(limit = 20, providerId?: AcademicProviderId) {
    const activeProviderId = providerId ?? (await this.settingsService.getActiveProviderId());

    return this.prisma.syncJob.findMany({
      where: {
        provider: activeProviderId,
      },
      take: limit,
      orderBy: {
        startedAt: 'desc',
      },
    });
  }

  async getLastJob(providerId?: AcademicProviderId) {
    const activeProviderId = providerId ?? (await this.settingsService.getActiveProviderId());

    return this.prisma.syncJob.findFirst({
      where: {
        provider: activeProviderId,
      },
      orderBy: {
        startedAt: 'desc',
      },
    });
  }

  private async runInternal(options: SyncRunOptions) {
    const settings = await this.prisma.appSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    const provider = options.providerId
      ? this.providerRegistryService.getProvider(options.providerId)
      : await this.providerRegistryService.getActiveProvider();
    const range =
      options.range ??
      getRangeFromOffsets(settings.syncLookbackDays, settings.syncFutureDays);

    const job = await this.prisma.syncJob.create({
      data: {
        provider: provider.id,
        trigger: options.trigger,
        dryRun: options.dryRun ?? false,
        status: 'RUNNING',
        rangeStart: range.start,
        rangeEnd: range.end,
      },
    });

    try {
      const refreshResult = await this.eventsService.refreshRange(range, {
        includeRawPayload: settings.storeRawPayload,
        providerId: provider.id,
        agendaId: options.agendaId,
      });

      const mappings = await this.prisma.eventMapping.findMany({
        where: {
          provider: provider.id,
          OR: [
            {
              sourceEventId: {
                in: refreshResult.eventIds.length > 0 ? refreshResult.eventIds : ['__none__'],
              },
            },
            {
              lastKnownStartAt: {
                gte: range.start,
                lte: range.end,
              },
            },
          ],
        },
      });

      const plan = planSyncActions(refreshResult.events, mappings, range);

      let createdCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;

      if (settings.googleSyncEnabled) {
        const calendarId = await this.googleCalendarService.getConfiguredCalendarId(provider.id);

        if (!options.dryRun) {
          for (const event of plan.create) {
            const response = await this.googleCalendarService.upsertEvent(
              calendarId,
              buildGoogleEvent(event, settings.timezone),
            );

            if (!response.id) {
              throw new AppError('Google did not return an event ID after creation.', 502, 'GOOGLE_EVENT_ID_MISSING');
            }

            createdCount += 1;
            await this.prisma.eventMapping.upsert({
              where: { sourceEventId: event.id },
              update: {
                googleEventId: response.id,
                lastSyncedHash: event.sourceHash,
                lastKnownStartAt: event.startAt,
                lastKnownEndAt: event.endAt,
                lastAction: 'CREATED',
                lastSyncedAt: new Date(),
                deletedAt: null,
              },
              create: {
                provider: event.provider,
                sourceEventId: event.id,
                googleEventId: response.id,
                lastSyncedHash: event.sourceHash,
                lastKnownStartAt: event.startAt,
                lastKnownEndAt: event.endAt,
                lastAction: 'CREATED',
                lastSyncedAt: new Date(),
              },
            });
          }

          for (const action of plan.update) {
            const response = await this.googleCalendarService.upsertEvent(
              calendarId,
              buildGoogleEvent(action.event, settings.timezone),
              action.mapping.googleEventId,
            );

            if (!response.id) {
              throw new AppError('Google did not return an event ID after update.', 502, 'GOOGLE_EVENT_ID_MISSING');
            }

            updatedCount += 1;
            await this.prisma.eventMapping.update({
              where: { sourceEventId: action.event.id },
              data: {
                googleEventId: response.id,
                lastSyncedHash: action.event.sourceHash,
                lastKnownStartAt: action.event.startAt,
                lastKnownEndAt: action.event.endAt,
                lastAction: 'UPDATED',
                lastSyncedAt: new Date(),
                deletedAt: null,
              },
            });
          }

          for (const mapping of plan.delete) {
            await this.googleCalendarService.deleteEvent(calendarId, mapping.googleEventId!);
            deletedCount += 1;
            await this.prisma.eventMapping.update({
              where: { sourceEventId: mapping.sourceEventId },
              data: {
                googleEventId: null,
                lastAction: 'DELETED',
                lastSyncedAt: new Date(),
                deletedAt: new Date(),
              },
            });
          }
        } else {
          createdCount = plan.create.length;
          updatedCount = plan.update.length;
          deletedCount = plan.delete.length;
        }
      }

      let exportedCount = 0;
      let exportPath: string | null = null;

      if (settings.saveLastIcs && !options.dryRun) {
        const exported = await this.icsExportService.exportRange(
          provider.id,
          range,
          refreshResult.events,
          true,
        );
        exportedCount = exported.eventCount;
        exportPath = exported.path;
      }

      const completedJob = await this.prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          eventsFetched: refreshResult.fetchedCount,
          eventsDeduped: refreshResult.dedupedCount,
          createdCount,
          updatedCount,
          deletedCount,
          unchangedCount: plan.unchanged.length,
          exportedCount,
          summary: settings.googleSyncEnabled
            ? `${provider.displayName} -> Google sync completed with ${createdCount} created, ${updatedCount} updated, ${deletedCount} deleted.`
            : `${provider.displayName} sync completed locally; Google sync is disabled in settings.`,
        },
      });

      logger.info(
        {
          jobId: completedJob.id,
          createdCount,
          updatedCount,
          deletedCount,
          exportedCount,
          provider: provider.id,
          dryRun: options.dryRun ?? false,
        },
        'Sync job completed.',
      );

      return {
        job: completedJob,
        provider: provider.id,
        range: {
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
        fetchedCount: refreshResult.fetchedCount,
        dedupedCount: refreshResult.dedupedCount,
        createdCount,
        updatedCount,
        deletedCount,
        unchangedCount: plan.unchanged.length,
        exportedCount,
        exportPath,
        dryRun: options.dryRun ?? false,
        googleSyncEnabled: settings.googleSyncEnabled,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';

      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: message,
        },
      });

      logger.error({ err: error, jobId: job.id }, 'Sync job failed.');
      throw error;
    }
  }
}
