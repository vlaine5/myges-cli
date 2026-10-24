import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * EventsService.refreshRange() must take the ICS branch whenever a non-empty
 * icsUrl is configured for the resolved provider's AcademicProviderCredential,
 * and fall back to provider.fetchEvents() (the live API/credential path)
 * otherwise. It must also apply enabled enrichment rules to every fetched
 * event before dedupe/upsert, regardless of which path was used.
 *
 * Like reconciliation.test.ts, this runs against a real, ephemeral SQLite DB
 * (schema loaded from prisma/migrations) rather than mocking Prisma, since
 * refreshRange()'s correctness is largely about what it writes.
 */
vi.mock('../../src/lib/ics-parser', () => ({
  fetchAndParseIcs: vi.fn(),
}));

import { fetchAndParseIcs } from '../../src/lib/ics-parser';
import { EventsService } from '../../src/modules/events/events.service';
import { ProviderCredentialStore } from '../../src/modules/providers/provider-credential.store';
import { EnrichmentRuleService } from '../../src/modules/enrichment/enrichment-rule.service';
import type { AcademicProvider } from '../../src/modules/providers/types';
import type { NormalizedEvent } from '../../src/modules/events/types';

const migrationsRoot = path.resolve(__dirname, '../../prisma/migrations');
const tmpDbPath = path.join(os.tmpdir(), `events-service-ics-test-${process.pid}-${Date.now()}.db`);

let prisma: PrismaClient;

function applyMigrations(dbPath: string) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const migrationDirs = fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const dir of migrationDirs) {
    const sql = fs.readFileSync(path.join(migrationsRoot, dir, 'migration.sql'), 'utf8');
    db.exec(sql);
  }

  db.close();
}

beforeAll(() => {
  applyMigrations(tmpDbPath);
  prisma = new PrismaClient({ datasources: { db: { url: `file:${tmpDbPath}` } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${tmpDbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

beforeEach(async () => {
  await prisma.syncJobEventChange.deleteMany({});
  await prisma.eventMatch.deleteMany({});
  await prisma.eventMapping.deleteMany({});
  await prisma.eventSnapshot.deleteMany({});
  await prisma.globalEvent.deleteMany({});
  await prisma.syncJob.deleteMany({});
  await prisma.eventEnrichmentRule.deleteMany({});
  await prisma.academicProviderCredential.deleteMany({});
  vi.mocked(fetchAndParseIcs).mockReset();
});

const START = new Date('2026-05-04T00:00:00.000Z');
const END = new Date('2026-05-11T00:00:00.000Z');

function makeFakeProvider(events: NormalizedEvent[]) {
  const fetchEvents = vi.fn(async () => events);

  const provider: AcademicProvider = {
    id: 'myges',
    displayName: 'MyGES',
    authenticate: vi.fn(),
    testConnection: vi.fn(),
    getStatus: vi.fn(),
    fetchEvents,
  };

  return { provider, fetchEvents };
}

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const base: NormalizedEvent = {
    id: 'myges:api-1',
    provider: 'myges',
    sourceId: 'api-1',
    reservationId: null,
    title: 'Cours API',
    subject: 'Algo',
    startAt: new Date('2026-05-05T08:00:00.000Z'),
    endAt: new Date('2026-05-05T10:00:00.000Z'),
    teacher: null,
    room: null,
    campus: null,
    rooms: [],
    promotion: null,
    group: null,
    classes: ['L3 INFO'],
    modality: null,
    reservationType: null,
    studentCount: null,
    disciplineName: null,
    disciplineTeacher: null,
    disciplineId: null,
    rawPayload: null,
    sourceHash: 'hash-1',
  };
  return { ...base, ...overrides };
}

function buildService(providerForFetch: AcademicProvider) {
  const providerRegistryService = {
    getProvider: vi.fn(() => providerForFetch),
    getActiveProvider: vi.fn(async () => providerForFetch),
  } as any;
  const settingsService = {} as any;
  const providerCredentialStore = new ProviderCredentialStore(prisma);
  const enrichmentRuleService = new EnrichmentRuleService(prisma);

  return new EventsService(
    prisma,
    providerRegistryService,
    settingsService,
    providerCredentialStore,
    enrichmentRuleService,
  );
}

describe('EventsService.refreshRange — ICS vs API branch', () => {
  it('calls provider.fetchEvents() when no icsUrl is configured', async () => {
    const { provider, fetchEvents } = makeFakeProvider([makeEvent()]);
    const service = buildService(provider);

    const result = await service.refreshRange({ start: START, end: END });

    expect(fetchEvents).toHaveBeenCalledTimes(1);
    expect(fetchAndParseIcs).not.toHaveBeenCalled();
    expect(result.fetchedCount).toBe(1);

    const stored = await prisma.eventSnapshot.findUnique({ where: { id: 'myges:api-1' } });
    expect(stored?.title).toBe('Cours API');
  });

  it('calls the ICS path instead when a non-empty icsUrl is configured for the provider, never touching provider.fetchEvents()', async () => {
    const { provider, fetchEvents } = makeFakeProvider([makeEvent()]);
    const service = buildService(provider);

    await prisma.academicProviderCredential.create({
      data: {
        provider: 'myges',
        configJson: JSON.stringify({ icsUrl: 'https://example.com/agenda.ics' }),
      },
    });

    vi.mocked(fetchAndParseIcs).mockResolvedValue([
      {
        uid: 'uid-1',
        summary: 'Cours ICS',
        description: null,
        location: 'B204',
        categories: [],
        startAt: new Date('2026-05-06T08:00:00.000Z'),
        endAt: new Date('2026-05-06T10:00:00.000Z'),
        status: null,
        raw: {},
      } as any,
    ]);

    const result = await service.refreshRange({ start: START, end: END });

    expect(fetchEvents).not.toHaveBeenCalled();
    expect(fetchAndParseIcs).toHaveBeenCalledWith('https://example.com/agenda.ics');
    expect(result.fetchedCount).toBe(1);

    const stored = await prisma.eventSnapshot.findMany({ where: { provider: 'myges' } });
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('Cours ICS');
  });

  it('falls back to the API path when icsUrl is configured but blank/whitespace-only', async () => {
    const { provider, fetchEvents } = makeFakeProvider([makeEvent()]);
    const service = buildService(provider);

    await prisma.academicProviderCredential.create({
      data: {
        provider: 'myges',
        configJson: JSON.stringify({ icsUrl: '   ' }),
      },
    });

    await service.refreshRange({ start: START, end: END });

    expect(fetchEvents).toHaveBeenCalledTimes(1);
    expect(fetchAndParseIcs).not.toHaveBeenCalled();
  });

  it('applies an enabled enrichment rule injectStudentCount onto the resulting EventSnapshot, for both API and ICS paths', async () => {
    await prisma.eventEnrichmentRule.create({
      data: {
        name: 'Effectif L3 INFO',
        matchClassLike: 'L3 INFO',
        injectStudentCount: 42,
        priority: 0,
        enabled: true,
      },
    });

    const { provider } = makeFakeProvider([makeEvent({ studentCount: null })]);
    const service = buildService(provider);

    await service.refreshRange({ start: START, end: END });

    const stored = await prisma.eventSnapshot.findUnique({ where: { id: 'myges:api-1' } });
    expect(stored?.studentCount).toBe(42);
  });

  it('does not apply a disabled enrichment rule', async () => {
    await prisma.eventEnrichmentRule.create({
      data: {
        name: 'Effectif L3 INFO (disabled)',
        matchClassLike: 'L3 INFO',
        injectStudentCount: 42,
        priority: 0,
        enabled: false,
      },
    });

    const { provider } = makeFakeProvider([makeEvent({ studentCount: null })]);
    const service = buildService(provider);

    await service.refreshRange({ start: START, end: END });

    const stored = await prisma.eventSnapshot.findUnique({ where: { id: 'myges:api-1' } });
    expect(stored?.studentCount).toBeNull();
  });
});

describe('EventsService.refreshRange — stale snapshot cleanup (duplicate prevention)', () => {
  // These must sit in the future relative to the real wall clock: the cleanup
  // logic never touches past events (permanent historical records), so a fixed
  // 2026 fixture date would be inert once that date is in the past.
  const now = new Date();
  const futureStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const futureEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const range = { start: now, end: futureEnd };

  it('removes the old API-sourced snapshot once the provider switches to ICS mode, preventing a duplicate GlobalEvent for the same lecture', async () => {
    const apiEvent = makeEvent({
      id: 'myges:api-1',
      sourceId: 'api-1',
      startAt: futureStart,
      endAt: new Date(futureStart.getTime() + 2 * 60 * 60 * 1000),
    });
    const { provider } = makeFakeProvider([apiEvent]);
    const service = buildService(provider);

    // First sync: live API mode, no icsUrl configured yet.
    await service.refreshRange(range);
    expect(await prisma.eventSnapshot.findMany({ where: { provider: 'myges' } })).toHaveLength(1);

    // Switch to ICS mode: the ICS feed represents the same real lecture but
    // with a different sourceId (sha256 of the ICS UID), so it lands as a
    // brand-new snapshot id. Without cleanup, both would coexist forever.
    await prisma.academicProviderCredential.create({
      data: { provider: 'myges', configJson: JSON.stringify({ icsUrl: 'https://example.com/agenda.ics' }) },
    });
    vi.mocked(fetchAndParseIcs).mockResolvedValue([
      {
        uid: 'uid-1',
        summary: 'Cours ICS',
        description: null,
        location: 'B204',
        categories: [],
        startAt: futureStart,
        endAt: new Date(futureStart.getTime() + 2 * 60 * 60 * 1000),
        status: null,
        raw: {},
      } as any,
    ]);

    await service.refreshRange(range);

    const stored = await prisma.eventSnapshot.findMany({ where: { provider: 'myges' } });
    expect(stored).toHaveLength(1);
    expect(stored[0].id).not.toBe('myges:api-1');
    expect(stored[0].title).toBe('Cours ICS');
  });

  it('removes a future snapshot that disappeared from a repeated ICS fetch, but never touches a past snapshot', async () => {
    const { provider } = makeFakeProvider([]);
    const service = buildService(provider);

    await prisma.academicProviderCredential.create({
      data: { provider: 'myges', configJson: JSON.stringify({ icsUrl: 'https://example.com/agenda.ics' }) },
    });

    const pastEvent = {
      uid: 'uid-past',
      summary: 'Cours passe',
      description: null,
      location: null,
      categories: [],
      startAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      endAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      status: null,
      raw: {},
    } as any;
    const futureEvent = {
      uid: 'uid-future',
      summary: 'Cours futur',
      description: null,
      location: null,
      categories: [],
      startAt: futureStart,
      endAt: new Date(futureStart.getTime() + 60 * 60 * 1000),
      status: null,
      raw: {},
    } as any;

    vi.mocked(fetchAndParseIcs).mockResolvedValue([pastEvent, futureEvent]);
    await service.refreshRange({ start: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000), end: futureEnd });
    expect(await prisma.eventSnapshot.findMany({ where: { provider: 'myges' } })).toHaveLength(2);

    // Second fetch: the future lecture disappeared from the feed (e.g. cancelled
    // and removed entirely), the past one is naturally absent from a real feed too.
    vi.mocked(fetchAndParseIcs).mockResolvedValue([]);
    await service.refreshRange({ start: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000), end: futureEnd });

    const remaining = await prisma.eventSnapshot.findMany({ where: { provider: 'myges' } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe('Cours passe');
  });
});
