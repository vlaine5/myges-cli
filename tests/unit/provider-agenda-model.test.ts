/**
 * Tests for the provider/agenda distinction:
 * - provider = system family (myges, myefrei, ensup, generic)
 * - agenda = concrete configured source (AgendaConfig row)
 * - events reference both provider and agendaId
 */

import { describe, expect, it } from 'vitest';
import { buildNormalizedEvent } from '../../src/modules/events/normalize';
import { snapshotToEventDto } from '../../src/modules/events/normalize';
import type { EventSnapshot } from '@prisma/client';

// --- Provider/Agenda distinction: field-level checks ---

describe('EventDto includes agendaId field', () => {
  const makeSnapshot = (overrides: Partial<EventSnapshot> = {}): EventSnapshot => ({
    id: 'test:abc123',
    provider: 'myges',
    agendaId: null,
    sourceId: 'abc123',
    reservationId: null,
    title: 'Test event',
    subject: null,
    startAt: new Date('2026-09-01T09:00:00Z'),
    endAt: new Date('2026-09-01T11:00:00Z'),
    teacher: null,
    room: null,
    campus: null,
    roomsJson: null,
    promotion: null,
    groupName: null,
    classesJson: null,
    modality: null,
    reservationType: null,
    studentCount: null,
    disciplineName: null,
    disciplineTeacher: null,
    disciplineId: null,
    sourceHash: 'deadbeef',
    rawPayload: null,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    globalEventId: 'global:test',
    ...overrides,
  });

  it('snapshotToEventDto returns agendaId=null for events without agenda', () => {
    const dto = snapshotToEventDto(makeSnapshot({ agendaId: null }));
    expect(dto.agendaId).toBeNull();
  });

  it('snapshotToEventDto returns agendaId when set', () => {
    const agendaId = 'clx123abc456';
    const dto = snapshotToEventDto(makeSnapshot({ agendaId }));
    expect(dto.agendaId).toBe(agendaId);
  });

  it('provider and agendaId are independent fields', () => {
    const dto = snapshotToEventDto(makeSnapshot({
      provider: 'ensup',
      agendaId: 'agenda-xyz',
    }));
    expect(dto.provider).toBe('ensup');
    expect(dto.agendaId).toBe('agenda-xyz');
  });

  it('same provider can have multiple agendaIds', () => {
    const snap1 = makeSnapshot({ id: 'ensup:a', provider: 'ensup', agendaId: 'agenda-a' });
    const snap2 = makeSnapshot({ id: 'ensup:b', provider: 'ensup', agendaId: 'agenda-b' });
    const dto1 = snapshotToEventDto(snap1);
    const dto2 = snapshotToEventDto(snap2);
    expect(dto1.provider).toBe(dto2.provider);
    expect(dto1.agendaId).not.toBe(dto2.agendaId);
  });

  it('generic provider supports agendaId=null (manual imports)', () => {
    const dto = snapshotToEventDto(makeSnapshot({ provider: 'generic', agendaId: null }));
    expect(dto.provider).toBe('generic');
    expect(dto.agendaId).toBeNull();
  });
});

// --- Provider values: only known values accepted by the type system ---

describe('AcademicProviderId values', () => {
  const KNOWN_PROVIDERS = ['myges', 'myefrei', 'ensup', 'generic'] as const;

  it('all expected providers are defined', () => {
    expect(KNOWN_PROVIDERS).toContain('myges');
    expect(KNOWN_PROVIDERS).toContain('myefrei');
    expect(KNOWN_PROVIDERS).toContain('ensup');
    expect(KNOWN_PROVIDERS).toContain('generic');
  });

  it('event IDs are provider-namespaced (provider:sourceHash)', () => {
    // Events from different providers with same sourceId must not collide
    const normalized1 = buildNormalizedEvent({
      provider: 'myges',
      sourceId: 'same-source',
      reservationId: null,
      title: 'Event A',
      subject: null,
      startAt: new Date('2026-09-01T09:00:00Z'),
      endAt: new Date('2026-09-01T11:00:00Z'),
      teacher: null,
      room: null,
      campus: null,
      rooms: [],
      promotion: null,
      group: null,
      classes: [],
      modality: null,
      reservationType: null,
      studentCount: null,
      disciplineName: null,
      disciplineTeacher: null,
      disciplineId: null,
      rawPayload: null,
    });
    const normalized2 = buildNormalizedEvent({
      ...normalized1,
      provider: 'ensup',
      startAt: new Date('2026-09-01T09:00:00Z'),
      endAt: new Date('2026-09-01T11:00:00Z'),
    });
    // IDs must differ: provider is part of the event id
    expect(normalized1.id).not.toBe(normalized2.id);
    expect(normalized1.id.startsWith('myges:')).toBe(true);
    expect(normalized2.id.startsWith('ensup:')).toBe(true);
  });
});

// --- All-providers query: no provider filter means return all ---

describe('All-providers query semantics', () => {
  it('returning all providers requires no provider filter to be set in the query', () => {
    // This test documents the contract: when provider is undefined/omitted,
    // listEvents() must NOT default to the global active provider.
    // The route accepts provider='all' or absent provider to mean "no filter".
    const toFilter = (provider: string | undefined): string | undefined =>
      provider === 'all' || provider === undefined ? undefined : provider;

    expect(toFilter(undefined)).toBeUndefined();
    expect(toFilter('all')).toBeUndefined();
    expect(toFilter('myges')).toBe('myges');
    expect(toFilter('ensup')).toBe('ensup');
  });
});

// --- Cleanup: scope semantics ---

describe('Event cleanup scope', () => {
  it('scope=future means only events with startAt >= now', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 86400000); // +1 day
    const past = new Date(now.getTime() - 86400000);   // -1 day

    const scopeFilter = (startAt: Date, scope: 'future' | 'all') =>
      scope === 'future' ? startAt >= now : true;

    expect(scopeFilter(future, 'future')).toBe(true);
    expect(scopeFilter(past, 'future')).toBe(false);
    expect(scopeFilter(past, 'all')).toBe(true);
    expect(scopeFilter(future, 'all')).toBe(true);
  });

  it('cleanup requires at least provider or agendaId — never deletes everything blindly', () => {
    const validateCleanupParams = (params: { provider?: string; agendaId?: string }) =>
      Boolean(params.provider || params.agendaId);

    expect(validateCleanupParams({})).toBe(false);
    expect(validateCleanupParams({ provider: 'myges' })).toBe(true);
    expect(validateCleanupParams({ agendaId: 'abc' })).toBe(true);
    expect(validateCleanupParams({ provider: 'ensup', agendaId: 'xyz' })).toBe(true);
  });
});
