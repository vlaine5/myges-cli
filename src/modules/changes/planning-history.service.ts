import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { AcademicProviderId } from '../events/types';
import type { PlanningDiff, PlanningEvent } from '../notifications/planning-diff';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export interface PlanningChangeDto {
  id: string;
  runId: string;
  provider: string;
  kind: 'ADDED' | 'UPDATED' | 'REMOVED';
  title: string;
  startAt: string;
  detectedAt: string;
  changedFields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function serialize(event: PlanningEvent) {
  return JSON.stringify({
    title: event.title,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    room: event.room,
    campus: event.campus,
    teacher: event.teacher,
    modality: event.modality,
  });
}

function parse(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class PlanningHistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Stores one refresh's diff. Does nothing when nothing changed. */
  async record(provider: AcademicProviderId, diff: PlanningDiff, detectedAt = new Date()) {
    const runId = randomUUID();
    const rows = [
      ...diff.added.map((event) => ({ kind: 'ADDED', event, before: null, after: event, fields: null })),
      ...diff.updated.map((update) => ({
        kind: 'UPDATED',
        event: update.after,
        before: update.before,
        after: update.after,
        fields: update.changedFields,
      })),
      ...diff.removed.map((event) => ({ kind: 'REMOVED', event, before: event, after: null, fields: null })),
    ];
    if (rows.length === 0) return 0;

    await this.prisma.planningChange.createMany({
      data: rows.map((row) => ({
        runId,
        provider,
        kind: row.kind,
        eventId: row.event.id,
        title: row.event.title,
        startAt: row.event.startAt,
        changedFields: row.fields ? JSON.stringify(row.fields) : null,
        beforeJson: row.before ? serialize(row.before) : null,
        afterJson: row.after ? serialize(row.after) : null,
        detectedAt,
      })),
    });
    return rows.length;
  }

  async list(filters: {
    provider?: string;
    kind?: string;
    since?: Date;
    before?: Date;
    limit?: number;
  }): Promise<PlanningChangeDto[]> {
    const rows = await this.prisma.planningChange.findMany({
      where: {
        provider: filters.provider || undefined,
        kind: filters.kind || undefined,
        detectedAt: {
          gt: filters.since,
          lt: filters.before,
        },
      },
      orderBy: [{ detectedAt: 'desc' }, { startAt: 'asc' }],
      take: Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
    });

    return rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      provider: row.provider,
      kind: row.kind as PlanningChangeDto['kind'],
      title: row.title,
      startAt: row.startAt.toISOString(),
      detectedAt: row.detectedAt.toISOString(),
      changedFields: parse(row.changedFields) as unknown as string[] ?? [],
      before: parse(row.beforeJson),
      after: parse(row.afterJson),
    }));
  }
}
