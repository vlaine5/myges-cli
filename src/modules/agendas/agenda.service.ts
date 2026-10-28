import { randomUUID } from 'crypto';
import type { AgendaConfig, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/app-error';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { getRangeFromOffsets } from '../../lib/time';
import type { AcademicProviderId } from '../events/types';
import type { EventsService } from '../events/events.service';
import type { IcsSyncService } from '../sync/ics-sync.service';
import type { ProviderRegistryService } from '../providers/provider-registry.service';
import type { SyncService } from '../sync/sync.service';
import type { NotificationService } from '../notifications/notification.service';

export const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'] as const;

export const agendaInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  provider: z.enum(['myges', 'myefrei', 'ensup']),
  fetchMode: z.enum(['api', 'ics']),
  icsUrl: z.string().url().optional().nullable(),
  enabled: z.boolean().default(true),
  syncEnabled: z.boolean().default(false),
  syncDayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
  syncHour: z.number().int().min(0).max(23).default(6),
  lookbackDays: z.number().int().min(0).max(365).default(7),
  lookaheadDays: z.number().int().min(1).max(365).default(30),
  googleCalendarId: z.string().optional().nullable(),
});

export type AgendaInput = z.infer<typeof agendaInputSchema>;

export interface AgendaDto {
  id: string;
  name: string;
  provider: AcademicProviderId;
  fetchMode: 'api' | 'ics';
  hasIcsUrl: boolean;
  enabled: boolean;
  syncEnabled: boolean;
  syncDayOfWeek: number | null;
  syncDayName: string | null;
  syncHour: number;
  lookbackDays: number;
  lookaheadDays: number;
  googleCalendarId: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  nextSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgendaSyncResult {
  agendaId: string;
  agendaName: string;
  provider: AcademicProviderId;
  fetchMode: 'api' | 'ics';
  fetched: number;
  upserted?: number;
  dedupedCount?: number;
  deletedFuture?: number;
  cancelled?: number;
  skipped?: number;
  status: 'SUCCESS' | 'FAILED';
  error?: string;
}

/**
 * Calculate the next run date for a given day-of-week and hour.
 * day: 0=Sun, 1=Mon, ..., 6=Sat
 * hour: 0-23
 */
export function calculateNextRunAt(dayOfWeek: number, hour: number, from = new Date()): Date {
  const next = new Date(from);
  next.setHours(hour, 0, 0, 0);
  const currentDay = from.getDay();
  let daysUntil = dayOfWeek - currentDay;

  if (daysUntil < 0) {
    daysUntil += 7;
  } else if (daysUntil === 0 && next.getTime() <= from.getTime()) {
    // Same day but time already passed
    daysUntil = 7;
  }

  next.setDate(next.getDate() + daysUntil);
  return next;
}

function toDto(row: AgendaConfig): AgendaDto {
  const nextSyncAt =
    row.syncEnabled && row.syncDayOfWeek !== null && row.syncDayOfWeek !== undefined
      ? calculateNextRunAt(row.syncDayOfWeek, row.syncHour).toISOString()
      : null;

  return {
    id: row.id,
    name: row.name,
    provider: row.provider as AcademicProviderId,
    fetchMode: row.fetchMode as 'api' | 'ics',
    hasIcsUrl: Boolean(row.icsUrlEncrypted),
    enabled: row.enabled,
    syncEnabled: row.syncEnabled,
    syncDayOfWeek: row.syncDayOfWeek,
    syncDayName:
      row.syncDayOfWeek !== null && row.syncDayOfWeek !== undefined
        ? (DAY_NAMES[row.syncDayOfWeek] ?? null)
        : null,
    syncHour: row.syncHour,
    lookbackDays: row.lookbackDays,
    lookaheadDays: row.lookaheadDays,
    googleCalendarId: row.googleCalendarId,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: row.lastSyncStatus,
    lastSyncError: row.lastSyncError,
    nextSyncAt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class AgendaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly eventsService: EventsService,
    private readonly icsSyncService: IcsSyncService,
    private readonly providerRegistryService: ProviderRegistryService,
    private readonly syncService: SyncService,
    private readonly notificationService?: NotificationService,
  ) {}

  async list(): Promise<AgendaDto[]> {
    const rows = await this.prisma.agendaConfig.findMany({
      orderBy: [{ provider: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toDto);
  }

  async getById(id: string): Promise<AgendaDto> {
    const row = await this.prisma.agendaConfig.findUnique({ where: { id } });
    if (!row) {
      throw new AppError('Agenda not found.', 404, 'AGENDA_NOT_FOUND');
    }
    return toDto(row);
  }

  async create(input: AgendaInput): Promise<AgendaDto> {
    if (input.fetchMode === 'ics' && !input.icsUrl) {
      throw new AppError(
        'An ICS URL is required when fetchMode is "ics".',
        400,
        'AGENDA_ICS_URL_REQUIRED',
      );
    }

    const row = await this.prisma.agendaConfig.create({
      data: {
        id: randomUUID(),
        name: input.name,
        provider: input.provider,
        fetchMode: input.fetchMode,
        icsUrlEncrypted: input.icsUrl ? encryptSecret(input.icsUrl) : null,
        enabled: input.enabled,
        syncEnabled: input.syncEnabled,
        syncDayOfWeek: input.syncDayOfWeek ?? null,
        syncHour: input.syncHour,
        lookbackDays: input.lookbackDays,
        lookaheadDays: input.lookaheadDays,
        googleCalendarId: input.googleCalendarId ?? null,
      },
    });
    return toDto(row);
  }

  async update(id: string, input: AgendaInput): Promise<AgendaDto> {
    const existing = await this.prisma.agendaConfig.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Agenda not found.', 404, 'AGENDA_NOT_FOUND');
    }

    if (input.fetchMode === 'ics' && !input.icsUrl && !existing.icsUrlEncrypted) {
      throw new AppError(
        'An ICS URL is required when fetchMode is "ics".',
        400,
        'AGENDA_ICS_URL_REQUIRED',
      );
    }

    const icsUrlEncrypted =
      input.icsUrl != null
        ? encryptSecret(input.icsUrl)
        : input.icsUrl === null
          ? null
          : existing.icsUrlEncrypted;

    const row = await this.prisma.agendaConfig.update({
      where: { id },
      data: {
        name: input.name,
        provider: input.provider,
        fetchMode: input.fetchMode,
        icsUrlEncrypted,
        enabled: input.enabled,
        syncEnabled: input.syncEnabled,
        syncDayOfWeek: input.syncDayOfWeek ?? null,
        syncHour: input.syncHour,
        lookbackDays: input.lookbackDays,
        lookaheadDays: input.lookaheadDays,
        googleCalendarId: input.googleCalendarId ?? null,
      },
    });
    return toDto(row);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.agendaConfig.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Agenda not found.', 404, 'AGENDA_NOT_FOUND');
    }
    await this.prisma.agendaConfig.delete({ where: { id } });
  }

  async test(id: string): Promise<{ ok: boolean; note: string }> {
    const row = await this.prisma.agendaConfig.findUnique({ where: { id } });
    if (!row) {
      throw new AppError('Agenda not found.', 404, 'AGENDA_NOT_FOUND');
    }

    if (row.fetchMode === 'ics') {
      if (!row.icsUrlEncrypted) {
        throw new AppError('No ICS URL configured for this agenda.', 409, 'AGENDA_ICS_URL_REQUIRED');
      }
      const icsUrl = decryptSecret(row.icsUrlEncrypted);
      if (!icsUrl) {
        throw new AppError('Could not decrypt the ICS URL.', 500, 'AGENDA_ICS_DECRYPT_FAILED');
      }
      const { fetchAndParseIcs } = await import('../../lib/ics-parser');
      const events = await fetchAndParseIcs(icsUrl);
      return { ok: true, note: `ICS URL reachable — ${events.length} event(s) found.` };
    }

    const provider = this.providerRegistryService.getProvider(row.provider as AcademicProviderId);
    const result = await provider.testConnection();
    return { ok: result.ok, note: (result.note as string | undefined) ?? 'API connection OK.' };
  }

  async sync(id: string, dryRun = false): Promise<AgendaSyncResult> {
    const row = await this.prisma.agendaConfig.findUnique({ where: { id } });
    if (!row) {
      throw new AppError('Agenda not found.', 404, 'AGENDA_NOT_FOUND');
    }

    if (!row.enabled) {
      throw new AppError('This agenda is disabled.', 409, 'AGENDA_DISABLED');
    }

    const range = getRangeFromOffsets(row.lookbackDays, row.lookaheadDays);

    try {
      let result: AgendaSyncResult;

      if (row.fetchMode === 'ics') {
        if (!row.icsUrlEncrypted) {
          throw new AppError('No ICS URL configured.', 409, 'AGENDA_ICS_URL_REQUIRED');
        }
        const icsUrl = decryptSecret(row.icsUrlEncrypted);
        if (!icsUrl) {
          throw new AppError('Could not decrypt the ICS URL.', 500, 'AGENDA_ICS_DECRYPT_FAILED');
        }

        if (dryRun) {
          const { fetchAndParseIcs } = await import('../../lib/ics-parser');
          const events = await fetchAndParseIcs(icsUrl);
          result = {
            agendaId: row.id,
            agendaName: row.name,
            provider: row.provider as AcademicProviderId,
            fetchMode: 'ics',
            fetched: events.length,
            upserted: 0,
            deletedFuture: 0,
            cancelled: 0,
            skipped: 0,
            status: 'SUCCESS',
          };
        } else {
          const agendaProvider = row.provider as AcademicProviderId;
          const refreshAgenda = () => this.icsSyncService.syncFromIcs(agendaProvider, icsUrl, { agendaId: row.id });
          const syncResult = this.notificationService
            ? await this.notificationService.trackPlanningChanges(agendaProvider, refreshAgenda)
            : await refreshAgenda();
          result = {
            agendaId: row.id,
            agendaName: row.name,
            provider: row.provider as AcademicProviderId,
            fetchMode: 'ics',
            fetched: syncResult.fetched,
            upserted: syncResult.upserted,
            deletedFuture: syncResult.deletedFuture,
            cancelled: syncResult.cancelled,
            skipped: syncResult.skipped,
            status: 'SUCCESS',
          };
        }
      } else {
        // API mode — delegate to SyncService
        const syncResult = await this.syncService.run({
          trigger: 'MANUAL',
          dryRun,
          providerId: row.provider as AcademicProviderId,
          agendaId: row.id,
          range,
        });
        result = {
          agendaId: row.id,
          agendaName: row.name,
          provider: row.provider as AcademicProviderId,
          fetchMode: 'api',
          fetched: syncResult.fetchedCount,
          dedupedCount: syncResult.dedupedCount,
          status: 'SUCCESS',
        };
      }

      if (!dryRun) {
        await this.prisma.agendaConfig.update({
          where: { id },
          data: {
            lastSyncAt: new Date(),
            lastSyncStatus: 'SUCCESS',
            lastSyncError: null,
          },
        });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown sync error.';

      if (!dryRun) {
        await this.prisma.agendaConfig.update({
          where: { id },
          data: {
            lastSyncAt: new Date(),
            lastSyncStatus: 'FAILED',
            lastSyncError: errorMessage,
          },
        });
      }

      throw error;
    }
  }

  /**
   * Return all agendas that are due to sync on the given day-of-week and hour.
   */
  async getDueAgendas(dayOfWeek: number, hour: number): Promise<AgendaConfig[]> {
    return this.prisma.agendaConfig.findMany({
      where: {
        syncEnabled: true,
        enabled: true,
        syncDayOfWeek: dayOfWeek,
        syncHour: hour,
      },
    });
  }

  /**
   * Run all agendas that are scheduled for the current hour/day.
   */
  async runScheduledAgendas(trigger: 'SCHEDULED' | 'STARTUP'): Promise<void> {
    void trigger;
    const now = new Date();
    const dayOfWeek = now.getDay();
    const hour = now.getHours();
    const dueAgendas = await this.getDueAgendas(dayOfWeek, hour);

    for (const agenda of dueAgendas) {
      try {
        await this.sync(agenda.id, false);
      } catch {
        // Already recorded in the agenda status — continue with others
      }
    }
  }
}
