import type { EventMapping } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import agendaEvent from '../fixtures/agenda-event.json';
import { normalizeAgendaEvent } from '../../src/modules/events/normalize';
import { planSyncActions, type GlobalEventSyncInput } from '../../src/modules/sync/plan-sync';

function buildMapping(overrides: Partial<EventMapping>): EventMapping {
  return {
    id: 'mapping-1',
    provider: 'myges',
    globalEventId: 'global-1',
    googleEventId: 'google-1',
    lastSyncedHash: 'same-hash',
    lastKnownStartAt: new Date('2025-01-06T09:00:00.000Z'),
    lastKnownEndAt: new Date('2025-01-06T10:30:00.000Z'),
    lastAction: 'CREATED',
    lastSyncedAt: new Date('2025-01-01T00:00:00.000Z'),
    deletedAt: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildInput(overrides: Partial<GlobalEventSyncInput> = {}): GlobalEventSyncInput {
  const event = normalizeAgendaEvent(agendaEvent);

  return {
    globalEventId: 'global-1',
    event,
    combinedHash: event.sourceHash,
    linkedSnapshotCount: 1,
    ...overrides,
  };
}

describe('planSyncActions', () => {
  const range = {
    start: new Date('2025-01-01T00:00:00.000Z'),
    end: new Date('2025-01-31T23:59:59.999Z'),
  };

  it('marks an unchanged event when hashes match', () => {
    const input = buildInput();
    const plan = planSyncActions(
      [input],
      [buildMapping({ globalEventId: input.globalEventId, lastSyncedHash: input.combinedHash })],
      range,
    );

    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.delete).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(1);
  });

  it('marks an update when the combined hash changed', () => {
    const input = buildInput({ combinedHash: 'new-combined-hash' });
    const plan = planSyncActions(
      [input],
      [buildMapping({ globalEventId: input.globalEventId, lastSyncedHash: 'older-hash' })],
      range,
    );

    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.event.globalEventId).toBe(input.globalEventId);
  });

  it('marks a delete when a mapped GlobalEvent has zero remaining linked snapshots in range', () => {
    const plan = planSyncActions([], [buildMapping({})], range);

    expect(plan.delete).toHaveLength(1);
  });

  it('does NOT delete when another provider still has a linked snapshot for the GlobalEvent', () => {
    const input = buildInput({ linkedSnapshotCount: 1 }); // this provider's snapshot disappeared, but one remains overall
    const plan = planSyncActions(
      [input],
      [buildMapping({ globalEventId: input.globalEventId, lastSyncedHash: input.combinedHash })],
      range,
    );

    expect(plan.delete).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(1);
  });

  it('marks a create when no mapping exists', () => {
    const event = normalizeAgendaEvent({
      ...agendaEvent,
      reservation_id: 999999,
    });
    const input = buildInput({ globalEventId: 'global-2', event, combinedHash: event.sourceHash });
    const plan = planSyncActions([input], [], range);

    expect(plan.create).toHaveLength(1);
  });

  it('ignores a GlobalEvent with zero linked snapshots for create/update/unchanged (left to the delete pass)', () => {
    const input = buildInput({ linkedSnapshotCount: 0 });
    const plan = planSyncActions([input], [], range);

    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(0);
  });
});
