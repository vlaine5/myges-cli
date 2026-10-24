import type { EventMapping } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import agendaEvent from '../fixtures/agenda-event.json';
import { normalizeAgendaEvent } from '../../src/modules/events/normalize';
import { planSyncActions } from '../../src/modules/sync/plan-sync';

function buildMapping(overrides: Partial<EventMapping>): EventMapping {
  return {
    id: 'mapping-1',
    sourceEventId: 'myges:1827575',
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

describe('planSyncActions', () => {
  const range = {
    start: new Date('2025-01-01T00:00:00.000Z'),
    end: new Date('2025-01-31T23:59:59.999Z'),
  };

  it('marks an unchanged event when hashes match', () => {
    const event = normalizeAgendaEvent(agendaEvent);
    const plan = planSyncActions(
      [event],
      [buildMapping({ sourceEventId: event.id, lastSyncedHash: event.sourceHash })],
      range,
    );

    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.delete).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(1);
  });

  it('marks an update when the content hash changed', () => {
    const event = normalizeAgendaEvent({
      ...agendaEvent,
      modality: 'Distanciel',
    });
    const plan = planSyncActions(
      [event],
      [buildMapping({ sourceEventId: event.id, lastSyncedHash: 'older-hash' })],
      range,
    );

    expect(plan.update).toHaveLength(1);
  });

  it('marks a delete when a mapped event disappears from the source range', () => {
    const plan = planSyncActions([], [buildMapping({})], range);

    expect(plan.delete).toHaveLength(1);
  });

  it('marks a create when no mapping exists', () => {
    const event = normalizeAgendaEvent({
      ...agendaEvent,
      reservation_id: 999999,
    });
    const plan = planSyncActions([event], [], range);

    expect(plan.create).toHaveLength(1);
  });
});
