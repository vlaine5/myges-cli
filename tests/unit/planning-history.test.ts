import { describe, expect, it, vi } from 'vitest';
import { PlanningHistoryService } from '../../src/modules/changes/planning-history.service';
import type { PlanningEvent } from '../../src/modules/notifications/planning-diff';

const event = (id: string, room: string | null = 'A1'): PlanningEvent => ({
  id,
  title: 'Java',
  startAt: new Date('2026-11-05T08:00:00Z'),
  endAt: new Date('2026-11-05T10:00:00Z'),
  room,
  campus: null,
  teacher: null,
  modality: null,
});

describe('PlanningHistoryService.record', () => {
  it('stores added, updated and removed changes under one run', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const service = new PlanningHistoryService({ planningChange: { createMany } } as never);

    const count = await service.record('myges', {
      added: [event('a')],
      updated: [{ before: event('b', 'A1'), after: event('b', 'B2'), changedFields: ['room'] }],
      removed: [event('c')],
    });

    expect(count).toBe(3);
    const rows = createMany.mock.calls[0]![0].data;
    expect(rows.map((row: { kind: string }) => row.kind)).toEqual(['ADDED', 'UPDATED', 'REMOVED']);
    expect(new Set(rows.map((row: { runId: string }) => row.runId)).size).toBe(1);
    expect(JSON.parse(rows[1].beforeJson).room).toBe('A1');
    expect(JSON.parse(rows[1].afterJson).room).toBe('B2');
  });

  it('writes nothing when nothing changed', async () => {
    const createMany = vi.fn();
    const service = new PlanningHistoryService({ planningChange: { createMany } } as never);
    expect(await service.record('ensup', { added: [], updated: [], removed: [] })).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });
});
