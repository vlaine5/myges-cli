import type { PrismaClient, ProviderSchedule } from '@prisma/client';
import { z } from 'zod';
import type { AcademicProviderId } from '../events/types';
import { getNextSlot, getPreviousSlot, TIME_PATTERN, type WeeklySchedule } from './schedule-slots';

export const SCHEDULABLE_PROVIDERS = ['myges', 'myefrei', 'ensup'] as const;
export type SchedulableProviderId = (typeof SCHEDULABLE_PROVIDERS)[number];

export const providerScheduleInputSchema = z.object({
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  times: z.array(z.string().regex(TIME_PATTERN, 'Expected HH:MM')).max(24),
  pushToGoogle: z.boolean(),
});

export type ProviderScheduleInput = z.infer<typeof providerScheduleInputSchema>;

export interface ProviderScheduleDto {
  provider: SchedulableProviderId;
  enabled: boolean;
  days: number[];
  times: string[];
  pushToGoogle: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastJobId: string | null;
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

export function toWeeklySchedule(row: Pick<ProviderSchedule, 'daysJson' | 'timesJson'>): WeeklySchedule {
  return {
    days: parseJsonArray<number>(row.daysJson),
    times: parseJsonArray<string>(row.timesJson),
  };
}

export class ProviderScheduleService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getTimeZone() {
    const settings = await this.prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
    return settings.timezone;
  }

  private toDto(provider: SchedulableProviderId, row: ProviderSchedule | null, timeZone: string): ProviderScheduleDto {
    const schedule = row ? toWeeklySchedule(row) : { days: [], times: [] };
    const nextRunAt = row?.enabled ? getNextSlot(schedule, timeZone, new Date()) : null;

    return {
      provider,
      enabled: row?.enabled ?? false,
      days: schedule.days,
      times: schedule.times,
      pushToGoogle: row?.pushToGoogle ?? true,
      nextRunAt: nextRunAt?.toISOString() ?? null,
      lastRunAt: row?.lastRunAt?.toISOString() ?? null,
      lastRunStatus: row?.lastRunStatus ?? null,
      lastRunError: row?.lastRunError ?? null,
      lastJobId: row?.lastJobId ?? null,
    };
  }

  /** One entry per schedulable provider, unconfigured ones included (disabled). */
  async list(): Promise<ProviderScheduleDto[]> {
    const [rows, timeZone] = await Promise.all([this.prisma.providerSchedule.findMany(), this.getTimeZone()]);
    return SCHEDULABLE_PROVIDERS.map((provider) =>
      this.toDto(provider, rows.find((row) => row.provider === provider) ?? null, timeZone),
    );
  }

  async listEnabled(): Promise<ProviderSchedule[]> {
    return this.prisma.providerSchedule.findMany({ where: { enabled: true } });
  }

  async save(provider: SchedulableProviderId, input: ProviderScheduleInput): Promise<ProviderScheduleDto> {
    const timeZone = await this.getTimeZone();
    const days = [...new Set(input.days)].sort((left, right) => left - right);
    const times = [...new Set(input.times)].sort();
    // Slots already past when the schedule is saved are not run: the schedule
    // starts with the next one.
    const lastSlotAt = getPreviousSlot({ days, times }, timeZone, new Date());
    const data = {
      enabled: input.enabled,
      daysJson: JSON.stringify(days),
      timesJson: JSON.stringify(times),
      pushToGoogle: input.pushToGoogle,
      lastSlotAt,
    };

    const row = await this.prisma.providerSchedule.upsert({
      where: { provider },
      update: data,
      create: { provider, ...data },
    });
    return this.toDto(provider, row, timeZone);
  }

  async recordRun(
    provider: AcademicProviderId,
    slot: Date,
    result: { status: 'SUCCESS' | 'FAILED'; error?: string | null; jobId?: string | null },
  ) {
    await this.prisma.providerSchedule.update({
      where: { provider },
      data: {
        lastSlotAt: slot,
        lastRunAt: new Date(),
        lastRunStatus: result.status,
        lastRunError: result.error ?? null,
        lastJobId: result.jobId ?? null,
      },
    });
  }

  async getNextRun(): Promise<{ provider: SchedulableProviderId; at: string } | null> {
    const upcoming = (await this.list())
      .filter((schedule) => schedule.nextRunAt)
      .sort((left, right) => left.nextRunAt!.localeCompare(right.nextRunAt!));
    const first = upcoming[0];
    return first ? { provider: first.provider, at: first.nextRunAt! } : null;
  }
}
