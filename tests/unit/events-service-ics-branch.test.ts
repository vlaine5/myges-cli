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
