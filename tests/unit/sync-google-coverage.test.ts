import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsService } from '../../src/modules/events/events.service';
import { ProviderCredentialStore } from '../../src/modules/providers/provider-credential.store';
import { EnrichmentRuleService } from '../../src/modules/enrichment/enrichment-rule.service';
import { ReconciliationService } from '../../src/modules/reconciliation/reconciliation.service';
import { SyncService } from '../../src/modules/sync/sync.service';
import type { AcademicProvider } from '../../src/modules/providers/types';
import type { NormalizedEvent } from '../../src/modules/events/types';

/**
 * Every event stored locally for a provider must end up on Google: including
 * ones outside the current fetch window that were stored before Google sync
 * was on, and ones whose Google event was deleted by hand or lives in a
 * calendar that is no longer the selected one.
 */
const migrationsRoot = path.resolve(__dirname, '../../prisma/migrations');
const tmpDbPath = path.join(os.tmpdir(), `sync-google-coverage-${process.pid}-${Date.now()}.db`);
let prisma: PrismaClient;

beforeAll(() => {
  const db = new Database(tmpDbPath);
  db.pragma('foreign_keys = ON');
  for (const dir of fs.readdirSync(migrationsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsRoot, dir, 'migration.sql'), 'utf8'));
  }
  db.close();
  prisma = new PrismaClient({ datasources: { db: { url: `file:${tmpDbPath}` } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${tmpDbPath}${suffix}`)) fs.unlinkSync(`${tmpDbPath}${suffix}`);
  }
});

beforeEach(async () => {
  await prisma.syncJobEventChange.deleteMany({});
  await prisma.syncJob.deleteMany({});
  await prisma.eventMatch.deleteMany({});
  await prisma.eventMapping.deleteMany({});
  await prisma.eventSnapshot.deleteMany({});
  await prisma.globalEvent.deleteMany({});
  await prisma.appSettings.deleteMany({});
  await prisma.appSettings.create({ data: { id: 1, googleSyncEnabled: false, saveLastIcs: false } });
});

const day = 24 * 60 * 60 * 1000;

function makeEvent(id: string, startAt: Date): NormalizedEvent {
  return {
    id: `myges:${id}`, provider: 'myges', sourceId: id, reservationId: null,
    title: `Cours ${id}`, subject: null, startAt, endAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000),
    teacher: null, room: null, campus: null, rooms: [], promotion: null, group: null, classes: [],
    modality: null, reservationType: null, studentCount: null, disciplineName: null,
    disciplineTeacher: null, disciplineId: null, rawPayload: null, sourceHash: `hash-${id}`,
  };
}

function setup(fetched: { current: NormalizedEvent[] }) {
  const provider: AcademicProvider = {
    id: 'myges', displayName: 'MyGES',
    authenticate: vi.fn(), testConnection: vi.fn(), getStatus: vi.fn(),
    fetchEvents: vi.fn(async () => fetched.current),
  };
  const registry = { getProvider: () => provider, getActiveProvider: async () => provider } as any;

  const googleEvents = new Map<string, string>(); // googleEventId -> calendarId
  let nextId = 1;
  const google = {
    selectedCalendar: 'cal-A',
    getConfiguredCalendarId: vi.fn(async () => google.selectedCalendar),
    upsertEvent: vi.fn(async (calendarId: string) => {
      const id = `g${nextId++}`;
      googleEvents.set(id, calendarId);
      return { id };
    }),
    deleteEvent: vi.fn(async (_calendarId: string, id: string) => { googleEvents.delete(id); }),
    listLiveEventIds: vi.fn(async (calendarId: string) =>
      new Set([...googleEvents].filter(([, cal]) => cal === calendarId).map(([id]) => id))),
  };

  const eventsService = new EventsService(prisma, registry, {} as any, new ProviderCredentialStore(prisma), new EnrichmentRuleService(prisma));
  const reconciliation = new ReconciliationService(prisma, google as any);
  const sync = new SyncService(prisma, eventsService, registry, {} as any, google as any, {} as any, reconciliation);

  return { sync, google, googleEvents };
}

describe('SyncService — every stored event reaches Google', () => {
  it('pushes events stored before Google sync was enabled, even once they are outside the fetch window', async () => {
    const now = Date.now();
    const old = makeEvent('old', new Date(now - 20 * day));
    const fetched = { current: [old] };
    const { sync, googleEvents } = setup(fetched);

    await sync.run({ trigger: 'MANUAL', range: { start: new Date(now - 30 * day), end: new Date(now + 30 * day) } });
    expect(googleEvents.size).toBe(0);

    await prisma.appSettings.update({ where: { id: 1 }, data: { googleSyncEnabled: true } });
    fetched.current = [makeEvent('recent', new Date(now + day))];
    await sync.run({ trigger: 'MANUAL', range: { start: new Date(now - 7 * day), end: new Date(now + 30 * day) } });

    expect(googleEvents.size).toBe(2);
  });

  it('re-creates an event deleted by hand on Google, and events left in a previously selected calendar', async () => {
    await prisma.appSettings.update({ where: { id: 1 }, data: { googleSyncEnabled: true } });
    const now = Date.now();
    const fetched = { current: [makeEvent('a', new Date(now + day)), makeEvent('b', new Date(now + 2 * day))] };
    const { sync, google, googleEvents } = setup(fetched);
    const range = { start: new Date(now - 7 * day), end: new Date(now + 30 * day) };

    await sync.run({ trigger: 'MANUAL', range });
    expect(googleEvents.size).toBe(2);

    googleEvents.delete([...googleEvents.keys()][0]);
    await sync.run({ trigger: 'MANUAL', range });
    expect(googleEvents.size).toBe(2);

    google.selectedCalendar = 'cal-B';
    await sync.run({ trigger: 'MANUAL', range });
    expect([...googleEvents.values()].filter((cal) => cal === 'cal-B')).toHaveLength(2);
  });
});
