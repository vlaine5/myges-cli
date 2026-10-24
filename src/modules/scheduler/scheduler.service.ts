import type { PrismaClient } from '@prisma/client';
import { logger } from '../../lib/logger';
import type { AgendaService } from '../agendas/agenda.service';
import type { SyncService } from '../sync/sync.service';

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private hourlyTimer: NodeJS.Timeout | null = null;
  private nextRunAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly syncService: SyncService,
    private readonly agendaService?: AgendaService,
  ) {}

  async start() {
    const settings = await this.prisma.appSettings.findUniqueOrThrow({
      where: { id: 1 },
    });

    if (settings.syncEnabled && settings.runSyncOnStartup) {
      this.trigger('STARTUP').catch((error) => {
        logger.error({ err: error }, 'Startup sync failed.');
      });
    }

    // Run agenda-based scheduled syncs on startup
    if (this.agendaService) {
      this.agendaService.runScheduledAgendas('STARTUP').catch((error) => {
        logger.error({ err: error }, 'Startup agenda sync failed.');
      });
    }

    await this.reschedule();
    this.scheduleHourlyAgendaCheck();
  }

  async reschedule() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const settings = await this.prisma.appSettings.findUniqueOrThrow({
      where: { id: 1 },
    });

    if (!settings.syncEnabled) {
      this.nextRunAt = null;
      return;
    }

    this.nextRunAt = new Date(Date.now() + settings.syncFrequencyMinutes * 60_000);
    this.timer = setTimeout(() => {
      this.trigger('SCHEDULED').catch((error) => {
        logger.error({ err: error }, 'Scheduled sync failed.');
      });
    }, settings.syncFrequencyMinutes * 60_000);
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

  async trigger(trigger: 'SCHEDULED' | 'STARTUP') {
    try {
      await this.syncService.run({ trigger });
    } finally {
      await this.reschedule();
    }
  }

  getStatus() {
    return {
      running: this.syncService.isRunning(),
      nextRunAt: this.nextRunAt?.toISOString() ?? null,
    };
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }
  }
}
