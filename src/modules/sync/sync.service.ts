import type { EventMapping, PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
import { sha256 } from '../../lib/hash';
import { getRangeFromOffsets } from '../../lib/time';
import type { AcademicProviderId } from '../events/types';
import type { EventsService } from '../events/events.service';
import { snapshotToEventDto, snapshotToNormalizedEvent } from '../events/normalize';
import { getCompletenessScore } from '../events/presentation';
import { buildGoogleEvent } from '../google/google-event.mapper';
import type { ProviderRegistryService } from '../providers/provider-registry.service';
import type { SettingsService } from '../settings/settings.service';
import type { GoogleCalendarService } from '../google/google-calendar.service';
import type { IcsExportService } from '../export/ics-export.service';
import type { ReconciliationService } from '../reconciliation/reconciliation.service';
import {
  planSyncActions,
  requeueMissingGoogleEvents,
  type GlobalEventSyncInput,
  type SyncActionPlan,
} from './plan-sync';

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
    private readonly reconciliationService: ReconciliationService,
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

  async getJobChanges(jobId: string) {
    return this.prisma.syncJobEventChange.findMany({
      where: { syncJobId: jobId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Re-applies the inverse of a single logged sync action, through the same
   * GoogleCalendarService/EventMapping code paths sync itself uses, and appends
   * a new ROLLED_BACK change referencing the original — history is never
   * rewritten or deleted.
   *
   * CREATED  -> delete the Google event, clear the mapping.
   * DELETED  -> recreate a Google event from the GlobalEvent's current primary
   *             snapshot (Google assigns a new id; there is no "undelete").
   * UPDATED  -> bookkeeping-only: restores the mapping's lastSyncedHash so the
   *             next sync re-detects and re-pushes a change. The live Google
   *             event's prior content is NOT restored — this repo does not keep
   *             a history of previous Google payloads, only the hash, so a true
   *             content-level rollback of an update is not possible here.
   */
  async rollbackChange(changeId: string) {
    const change = await this.prisma.syncJobEventChange.findUniqueOrThrow({ where: { id: changeId } });

    if (change.action === 'ROLLED_BACK') {
      throw new AppError('A rollback record cannot itself be rolled back.', 409, 'CANNOT_ROLLBACK_ROLLBACK');
    }

    const alreadyRolledBack = await this.prisma.syncJobEventChange.findFirst({
      where: {
        syncJobId: change.syncJobId,
        action: 'ROLLED_BACK',
        afterJson: { contains: change.id },
      },
    });

    if (alreadyRolledBack) {
      throw new AppError('This change has already been rolled back.', 409, 'ALREADY_ROLLED_BACK');
    }

    if (change.action === 'CREATED') {
      if (change.globalEventId) {
        const mapping = await this.prisma.eventMapping.findUnique({ where: { globalEventId: change.globalEventId } });

        if (mapping?.googleEventId) {
          const calendarId = await this.googleCalendarService.getConfiguredCalendarId(
            mapping.provider as AcademicProviderId,
          );
          await this.googleCalendarService.deleteEvent(calendarId, mapping.googleEventId);
          await this.prisma.eventMapping.update({
            where: { id: mapping.id },
            data: { googleEventId: null, lastAction: 'DELETED', lastSyncedAt: new Date(), deletedAt: new Date() },
          });
        }
      }

      await this.prisma.syncJobEventChange.create({
        data: {
          syncJobId: change.syncJobId,
          globalEventId: change.globalEventId,
          snapshotId: change.snapshotId,
          action: 'ROLLED_BACK',
          googleEventId: change.googleEventId,
          beforeJson: change.afterJson,
          afterJson: JSON.stringify({ rolledBackChangeId: change.id, inverseOf: 'CREATED' }),
        },
      });
      return;
    }

    if (change.action === 'DELETED') {
      if (!change.globalEventId) {
        throw new AppError('Cannot roll back: this change has no associated GlobalEvent.', 409, 'ROLLBACK_NO_DATA');
      }

      const globalEvent = await this.prisma.globalEvent.findUnique({ where: { id: change.globalEventId } });
      const snapshots = await this.prisma.eventSnapshot.findMany({ where: { globalEventId: change.globalEventId } });
      const primary = snapshots.find((snapshot) => snapshot.id === globalEvent?.primarySnapshotId) ?? snapshots[0];

      if (!globalEvent || !primary) {
        throw new AppError(
          'Cannot roll back: the GlobalEvent no longer has any linked snapshot to recreate from.',
          409,
          'ROLLBACK_NO_DATA',
        );
      }

      const settings = await this.prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
      const normalizedEvent = snapshotToNormalizedEvent(primary);
      const calendarId = await this.googleCalendarService.getConfiguredCalendarId(normalizedEvent.provider);
      const response = await this.googleCalendarService.upsertEvent(
        calendarId,
        buildGoogleEvent(normalizedEvent, settings.timezone),
      );

      if (!response.id) {
        throw new AppError('Google did not return an event ID while rolling back a delete.', 502, 'GOOGLE_EVENT_ID_MISSING');
      }

      await this.prisma.eventMapping.upsert({
        where: { globalEventId: change.globalEventId },
        update: {
          provider: normalizedEvent.provider,
          googleEventId: response.id,
          lastAction: 'CREATED',
          lastSyncedAt: new Date(),
          deletedAt: null,
        },
        create: {
          provider: normalizedEvent.provider,
          globalEventId: change.globalEventId,
          googleEventId: response.id,
          lastKnownStartAt: normalizedEvent.startAt,
          lastKnownEndAt: normalizedEvent.endAt,
          lastAction: 'CREATED',
          lastSyncedAt: new Date(),
        },
      });

      await this.prisma.syncJobEventChange.create({
        data: {
          syncJobId: change.syncJobId,
          globalEventId: change.globalEventId,
          snapshotId: primary.id,
          action: 'ROLLED_BACK',
          googleEventId: response.id,
          beforeJson: change.afterJson,
          afterJson: JSON.stringify({ rolledBackChangeId: change.id, inverseOf: 'DELETED' }),
        },
      });
      return;
    }

    // UPDATED
    const before = change.beforeJson ? (JSON.parse(change.beforeJson) as { lastSyncedHash?: string | null }) : null;

    if (!change.globalEventId || !before) {
      throw new AppError('Cannot roll back: no prior state was recorded for this update.', 409, 'ROLLBACK_NO_DATA');
    }

    await this.prisma.eventMapping.update({
      where: { globalEventId: change.globalEventId },
      data: { lastSyncedHash: before.lastSyncedHash ?? null },
    });

    await this.prisma.syncJobEventChange.create({
      data: {
        syncJobId: change.syncJobId,
        globalEventId: change.globalEventId,
        snapshotId: change.snapshotId,
        action: 'ROLLED_BACK',
        googleEventId: change.googleEventId,
        beforeJson: change.afterJson,
        afterJson: JSON.stringify({
          rolledBackChangeId: change.id,
          inverseOf: 'UPDATED',
          note:
            'Bookkeeping-only: the mapping hash was reset so the next sync re-pushes a change. ' +
            'The live Google event\'s content before this update was not retained and could not be restored.',
        }),
      },
    });
  }

  /** Rolls back every not-yet-rolled-back change for a job, oldest first. */
  async rollbackJob(jobId: string) {
    const changes = await this.prisma.syncJobEventChange.findMany({
      where: { syncJobId: jobId, action: { not: 'ROLLED_BACK' } },
      orderBy: { createdAt: 'asc' },
    });

    const results: Array<{ changeId: string; status: 'ROLLED_BACK' | 'FAILED'; error?: string }> = [];

    for (const change of changes) {
      try {
        await this.rollbackChange(change.id);
        results.push({ changeId: change.id, status: 'ROLLED_BACK' });
      } catch (error) {
        results.push({
          changeId: change.id,
          status: 'FAILED',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Builds one GlobalEventSyncInput per id: loads every snapshot currently
   * linked to that GlobalEvent (any provider), picks the representative
   * (primary snapshot's) fields, and computes the combined change-detection
   * hash. If the sticky primary snapshot has disappeared (hard-deleted), this
   * is the one place sync is allowed to promote a new one — the explicit
   * "current primary disappearing" exception to primary stickiness. GlobalEvents
   * left with zero linked snapshots are omitted entirely; planSyncActions then
   * treats their mapping (if any) as a delete candidate.
   */
  private async buildGlobalEventSyncViews(globalEventIds: string[]): Promise<GlobalEventSyncInput[]> {
    if (globalEventIds.length === 0) {
      return [];
    }

    const globalEvents = await this.prisma.globalEvent.findMany({
      where: { id: { in: globalEventIds } },
    });

    const views: GlobalEventSyncInput[] = [];

    for (const globalEvent of globalEvents) {
      const linkedSnapshots = await this.prisma.eventSnapshot.findMany({
        where: { globalEventId: globalEvent.id },
      });

      if (linkedSnapshots.length === 0) {
        continue;
      }

      let primarySnapshot = linkedSnapshots.find((snapshot) => snapshot.id === globalEvent.primarySnapshotId);

      if (!primarySnapshot) {
        const ranked = linkedSnapshots
          .map((candidate) => ({ candidate, score: getCompletenessScore(snapshotToEventDto(candidate)) }))
          .sort((left, right) => right.score - left.score);
        primarySnapshot = ranked[0]?.candidate;

        if (primarySnapshot) {
          await this.prisma.globalEvent.update({
            where: { id: globalEvent.id },
            data: { primarySnapshotId: primarySnapshot.id },
          });
          logger.info(
            { globalEventId: globalEvent.id, newPrimarySnapshotId: primarySnapshot.id },
            'Promoted a new primary snapshot (previous primary disappeared).',
          );
        }
      }

      if (!primarySnapshot) {
        continue;
      }

      const combinedHash = sha256(JSON.stringify(linkedSnapshots.map((snapshot) => snapshot.sourceHash).sort()));

      views.push({
        globalEventId: globalEvent.id,
        event: snapshotToNormalizedEvent(primarySnapshot),
        combinedHash,
        linkedSnapshotCount: linkedSnapshots.length,
      });
    }

    return views;
  }

  /**
   * Checks the calendar each event targets and re-creates those whose stored
   * Google event is gone (deleted by hand, or in a previously selected calendar).
   */
  private async requeueEventsMissingFromGoogle(
    plan: SyncActionPlan,
    resolveCalendarId: (providerId: AcademicProviderId) => Promise<string>,
  ) {
    const entries = [...plan.update, ...plan.unchanged];
    if (entries.length === 0) return plan;

    const byCalendar = new Map<string, EventMapping[]>();
    for (const entry of entries) {
      const calendarId = await resolveCalendarId(entry.event.event.provider);
      byCalendar.set(calendarId, [...(byCalendar.get(calendarId) ?? []), entry.mapping]);
    }

    const liveIdsByCalendar = new Map<string, Set<string>>();
    const calendarByMappingId = new Map<string, string>();
    const dayMs = 24 * 60 * 60 * 1000;

    for (const [calendarId, calendarMappings] of byCalendar) {
      const starts = calendarMappings.map((mapping) => mapping.lastKnownStartAt.getTime());
      const ends = calendarMappings.map((mapping) => mapping.lastKnownEndAt.getTime());
      liveIdsByCalendar.set(
        calendarId,
        await this.googleCalendarService.listLiveEventIds(
          calendarId,
          new Date(Math.min(...starts) - dayMs),
          new Date(Math.max(...ends) + dayMs),
        ),
      );
      for (const mapping of calendarMappings) calendarByMappingId.set(mapping.id, calendarId);
    }

    const requeued = requeueMissingGoogleEvents(plan, (mapping) => {
      const liveIds = liveIdsByCalendar.get(calendarByMappingId.get(mapping.id) ?? '');
      return Boolean(mapping.googleEventId && liveIds?.has(mapping.googleEventId));
    });

    const requeuedCount = requeued.create.length - plan.create.length;
    if (requeuedCount > 0) {
      logger.info({ requeuedCount }, 'Re-creating events missing from their Google calendar.');
    }

    return requeued;
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

      // Reconciliation only runs for snapshots newly created this run, and only
      // after the upsert transaction above has committed.
      await this.reconciliationService.reconcileNewSnapshots(refreshResult.newSnapshotIds);

      // The GlobalEventIds touched by this provider's fetch this run.
      const touchedSnapshots = await this.prisma.eventSnapshot.findMany({
        where: {
          id: { in: refreshResult.eventIds.length > 0 ? refreshResult.eventIds : ['__none__'] },
        },
        select: { globalEventId: true },
      });
      const touchedGlobalEventIds = [...new Set(touchedSnapshots.map((row) => row.globalEventId))];

      // Mapping lookup is intentionally NOT filtered by provider: a GlobalEvent
      // can span providers, and EventMapping.provider is informational (whichever
      // provider's calendar the primary snapshot currently belongs to), not a
      // scoping key. A mapping is relevant to this run if it was just touched, or
      // if its last known occurrence falls within the synced range (covers the
      // case where the linked snapshot disappeared entirely from this fetch).
      const mappings = await this.prisma.eventMapping.findMany({
        where: {
          OR: [
            {
              globalEventId: {
                in: touchedGlobalEventIds.length > 0 ? touchedGlobalEventIds : ['__none__'],
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

      // Events of this provider stored locally but never on Google — fetched
      // before Google was connected or while Google sync was off, or now outside
      // the fetch window — are otherwise never touched again, so never pushed.
      const unsyncedGlobalEvents = await this.prisma.globalEvent.findMany({
        where: {
          retiredAt: null,
          snapshots: { some: { provider: provider.id } },
          OR: [{ mapping: { is: null } }, { mapping: { is: { googleEventId: null } } }],
        },
        select: { id: true },
      });

      const relevantGlobalEventIds = [
        ...new Set([
          ...touchedGlobalEventIds,
          ...mappings.map((mapping) => mapping.globalEventId),
          ...unsyncedGlobalEvents.map((globalEvent) => globalEvent.id),
        ]),
      ];
      const globalEventViews = await this.buildGlobalEventSyncViews(relevantGlobalEventIds);

      let plan = planSyncActions(globalEventViews, mappings, range);

      // A Google event whose GlobalEvent has lost every source snapshot (manual
      // cleanup, or the source dropped it) has nothing left to represent, so it
      // is deleted regardless of the sync range — otherwise anything outside the
      // window stays on Google forever with no way to remove it from the app.
      const plannedDeleteIds = new Set(plan.delete.map((mapping) => mapping.globalEventId));
      const orphanMappings = await this.prisma.eventMapping.findMany({
        where: {
          googleEventId: { not: null },
          deletedAt: null,
          globalEvent: { retiredAt: null, snapshots: { none: {} } },
        },
      });
      for (const mapping of orphanMappings) {
        if (!plannedDeleteIds.has(mapping.globalEventId)) {
          plan.delete.push(mapping);
        }
      }

      let createdCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;

      if (settings.googleSyncEnabled) {
        const calendarIdCache = new Map<string, string>();
        const resolveCalendarId = async (providerId: AcademicProviderId) => {
          const cached = calendarIdCache.get(providerId);

          if (cached) {
            return cached;
          }

          const resolved = await this.googleCalendarService.getConfiguredCalendarId(providerId);
          calendarIdCache.set(providerId, resolved);
          return resolved;
        };

        if (!options.dryRun) {
          plan = await this.requeueEventsMissingFromGoogle(plan, resolveCalendarId);

          for (const input of plan.create) {
            const calendarId = await resolveCalendarId(input.event.provider);
            const response = await this.googleCalendarService.upsertEvent(
              calendarId,
              buildGoogleEvent(input.event, settings.timezone),
            );

            if (!response.id) {
              throw new AppError('Google did not return an event ID after creation.', 502, 'GOOGLE_EVENT_ID_MISSING');
            }

            createdCount += 1;
            await this.prisma.eventMapping.upsert({
              where: { globalEventId: input.globalEventId },
              update: {
                provider: input.event.provider,
                googleEventId: response.id,
                lastSyncedHash: input.combinedHash,
                lastKnownStartAt: input.event.startAt,
                lastKnownEndAt: input.event.endAt,
                lastAction: 'CREATED',
                lastSyncedAt: new Date(),
                deletedAt: null,
              },
              create: {
                provider: input.event.provider,
                globalEventId: input.globalEventId,
                googleEventId: response.id,
                lastSyncedHash: input.combinedHash,
                lastKnownStartAt: input.event.startAt,
                lastKnownEndAt: input.event.endAt,
                lastAction: 'CREATED',
                lastSyncedAt: new Date(),
              },
            });

            await this.prisma.syncJobEventChange.create({
              data: {
                syncJobId: job.id,
                globalEventId: input.globalEventId,
                snapshotId: input.event.id,
                action: 'CREATED',
                googleEventId: response.id,
                afterJson: JSON.stringify({ googleEventId: response.id, sourceHash: input.combinedHash }),
              },
            });
          }

          for (const action of plan.update) {
            const calendarId = await resolveCalendarId(action.event.event.provider);
            const response = await this.googleCalendarService.upsertEvent(
              calendarId,
              buildGoogleEvent(action.event.event, settings.timezone),
              action.mapping.googleEventId,
            );

            if (!response.id) {
              throw new AppError('Google did not return an event ID after update.', 502, 'GOOGLE_EVENT_ID_MISSING');
            }

            updatedCount += 1;

            const before = {
              googleEventId: action.mapping.googleEventId,
              lastSyncedHash: action.mapping.lastSyncedHash,
            };

            await this.prisma.eventMapping.update({
              where: { globalEventId: action.event.globalEventId },
              data: {
                provider: action.event.event.provider,
                googleEventId: response.id,
                lastSyncedHash: action.event.combinedHash,
                lastKnownStartAt: action.event.event.startAt,
                lastKnownEndAt: action.event.event.endAt,
                lastAction: 'UPDATED',
                lastSyncedAt: new Date(),
                deletedAt: null,
              },
            });

            await this.prisma.syncJobEventChange.create({
              data: {
                syncJobId: job.id,
                globalEventId: action.event.globalEventId,
                snapshotId: action.event.event.id,
                action: 'UPDATED',
                googleEventId: response.id,
                beforeJson: JSON.stringify(before),
                afterJson: JSON.stringify({ googleEventId: response.id, sourceHash: action.event.combinedHash }),
              },
            });
          }

          for (const mapping of plan.delete) {
            const calendarId = await resolveCalendarId(mapping.provider as AcademicProviderId);
            await this.googleCalendarService.deleteEvent(calendarId, mapping.googleEventId!);
            deletedCount += 1;

            const before = { googleEventId: mapping.googleEventId, lastSyncedHash: mapping.lastSyncedHash };

            await this.prisma.eventMapping.update({
              where: { globalEventId: mapping.globalEventId },
              data: {
                googleEventId: null,
                lastAction: 'DELETED',
                lastSyncedAt: new Date(),
                deletedAt: new Date(),
              },
            });

            await this.prisma.syncJobEventChange.create({
              data: {
                syncJobId: job.id,
                globalEventId: mapping.globalEventId,
                action: 'DELETED',
                googleEventId: mapping.googleEventId,
                beforeJson: JSON.stringify(before),
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
