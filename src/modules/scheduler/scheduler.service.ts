import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/app-error';
import { logger } from '../../lib/logger';
import type { AgendaService } from '../agendas/agenda.service';
import type { AcademicProviderId } from '../events/types';
import type { SyncService } from '../sync/sync.service';
import { toWeeklySchedule, type ProviderScheduleService } from './provider-schedule.service';
import { getDueSlot } from './schedule-slots';

const TICK_MS = 60_000;

/**
 * Runs each provider on its own weekly schedule (ProviderSchedule): every
 * minute, a provider whose latest slot has not been handled yet is fetched and
 * its changes pushed to Google. Syncs run one at a time; a slot that hits a
 * sync already in progress is retried on the next tick.
 */
export class SchedulerService {
  private tickTimer: NodeJS.Timeout | null = null;
  private hourlyTimer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly syncService: SyncService,
    private readonly providerScheduleService: ProviderScheduleService,
    private readonly agendaService?: AgendaService,
  ) {}

  async start() {
    const settings = await this.prisma.appSettings.findUniqueOrThrow({
      where: { id: 1 },
    });

    if (settings.runSyncOnStartup) {
      this.runStartupSyncs().catch((error) => {
        logger.error({ err: error }, 'Startup sync failed.');
      });
    }

    // Run agenda-based scheduled syncs on startup
    if (this.agendaService) {
      this.agendaService.runScheduledAgendas('STARTUP').catch((error) => {
        logger.error({ err: error }, 'Startup agenda sync failed.');
      });
    }

    void this.tick();
    this.tickTimer = setInterval(() => void this.tick(), TICK_MS);
    this.scheduleHourlyAgendaCheck();
  }

  /** Startup run of every scheduled provider; does not consume any slot. */
  private async runStartupSyncs() {
    for (const schedule of await this.providerScheduleService.listEnabled()) {
      try {
        await this.syncService.run({
          trigger: 'STARTUP',
          providerId: schedule.provider as AcademicProviderId,
          pushToGoogle: schedule.pushToGoogle,
        });
      } catch (error) {
        logger.error({ err: error, provider: schedule.provider }, 'Startup sync of a provider failed.');
      }
    }
  }

  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;

    try {
      const settings = await this.prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });

      for (const schedule of await this.providerScheduleService.listEnabled()) {
        const slot = getDueSlot(toWeeklySchedule(schedule), settings.timezone, schedule.lastSlotAt, now);
        if (!slot) continue;
        await this.runSlot(schedule.provider as AcademicProviderId, slot, schedule.pushToGoogle);
      }
    } catch (error) {
      logger.error({ err: error }, 'Scheduler tick failed.');
    } finally {
      this.ticking = false;
    }
  }

  private async runSlot(provider: AcademicProviderId, slot: Date, pushToGoogle: boolean) {
    const startedAt = new Date();
    logger.info({ provider, slot: slot.toISOString(), pushToGoogle }, 'Running scheduled provider sync.');

    try {
      const result = await this.syncService.run({ trigger: 'SCHEDULED', providerId: provider, pushToGoogle });
      await this.providerScheduleService.recordRun(provider, slot, { status: 'SUCCESS', jobId: result.job.id });
    } catch (error) {
      if (error instanceof AppError && error.code === 'SYNC_ALREADY_RUNNING') {
        logger.info({ provider }, 'Another sync is running; scheduled sync retried next minute.');
        return;
      }

      const job = await this.prisma.syncJob.findFirst({
        where: { provider, trigger: 'SCHEDULED', startedAt: { gte: startedAt } },
        orderBy: { startedAt: 'desc' },
      });
      await this.providerScheduleService.recordRun(provider, slot, {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown sync error.',
        jobId: job?.id,
      });
      logger.error({ err: error, provider }, 'Scheduled provider sync failed.');
    }
  }

  /**
   * Schedule an hourly check for agendas due to run (day-of-week + hour scheduling).
   * Fires at the next full hour, then every hour thereafter.
   */
  private scheduleHourlyAgendaCheck() {
    if (!this.agendaService) return;

    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }

    // Compute milliseconds until the next full hour
    const now = new Date();
    const msUntilNextHour =
      (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1_000 - now.getMilliseconds();

    setTimeout(() => {
      this.runAgendaCheck();
      this.hourlyTimer = setInterval(() => {
        this.runAgendaCheck();
      }, 60 * 60_000);
    }, msUntilNextHour);
  }

  private runAgendaCheck() {
    if (!this.agendaService) return;
    this.agendaService.runScheduledAgendas('SCHEDULED').catch((error) => {
      logger.error({ err: error }, 'Hourly agenda check failed.');
    });
  }

  async getStatus() {
    const nextRun = await this.providerScheduleService.getNextRun();
    return {
      running: this.syncService.isRunning(),
      nextRunAt: nextRun?.at ?? null,
      nextRunProvider: nextRun?.provider ?? null,
    };
  }

  stop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }
  }
}
