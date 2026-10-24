import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReconciliationService } from '../../src/modules/reconciliation/reconciliation.service';
import type { GoogleCalendarService } from '../../src/modules/google/google-calendar.service';

/**
 * These tests exercise ReconciliationService against a REAL, ephemeral SQLite
 * database (schema loaded from prisma/migrations), rather than mocking Prisma —
 * the service's logic is almost entirely query shape, which a mock would hide
 * bugs in. A fake GoogleCalendarService stands in for the real Google API.
 */

const migrationsRoot = path.resolve(__dirname, '../../prisma/migrations');
const tmpDbPath = path.join(os.tmpdir(), `reconciliation-test-${process.pid}-${Date.now()}.db`);

let prisma: PrismaClient;

class FakeGoogleCalendarService {
  deletedEvents: Array<{ calendarId: string; googleEventId: string }> = [];

  async getConfiguredCalendarId(provider: string) {
    return `calendar-${provider}`;
  }

  async deleteEvent(calendarId: string, googleEventId: string) {
    this.deletedEvents.push({ calendarId, googleEventId });
  }
}

let fakeGoogle: FakeGoogleCalendarService;
let service: ReconciliationService;

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

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

interface SeedSnapshotInput {
  provider: string;
  sourceId: string;
  reservationId?: number | null;
  title: string;
  subject?: string | null;
  startAt: Date;
  endAt: Date;
  teacher?: string | null;
  room?: string | null;
  classes?: string[];
  group?: string | null;
}

/** Mirrors the nested-create pattern used by events.service.ts: every new snapshot gets its own solo GlobalEvent in the same write. */
async function seedSnapshot(input: SeedSnapshotInput) {
  const id = `${input.provider}:${input.sourceId}`;

  return prisma.eventSnapshot.create({
    data: {
      id,
      provider: input.provider,
      sourceId: input.sourceId,
      reservationId: input.reservationId ?? null,
      title: input.title,
      subject: input.subject ?? input.title,
      startAt: input.startAt,
      endAt: input.endAt,
      teacher: input.teacher ?? null,
      room: input.room ?? null,
      classesJson: JSON.stringify(input.classes ?? []),
      groupName: input.group ?? null,
      sourceHash: nextId('hash'),
      lastSeenAt: new Date(),
      globalEvent: {
        create: {
          title: input.title,
          subject: input.subject ?? input.title,
          startAt: input.startAt,
          endAt: input.endAt,
          teacher: input.teacher ?? null,
          room: input.room ?? null,
          groupName: input.group ?? null,
          primarySnapshotId: id,
        },
      },
    },
  });
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
  // FK-safe deletion order.
  await prisma.syncJobEventChange.deleteMany({});
  await prisma.eventMatch.deleteMany({});
  await prisma.eventMapping.deleteMany({});
  await prisma.eventSnapshot.deleteMany({});
  await prisma.globalEvent.deleteMany({});
  await prisma.syncJob.deleteMany({});

  fakeGoogle = new FakeGoogleCalendarService();
  service = new ReconciliationService(prisma, fakeGoogle as unknown as GoogleCalendarService);
});

const START = new Date('2026-05-04T08:00:00.000Z');
const END = new Date('2026-05-04T09:30:00.000Z');

describe('ReconciliationService', () => {
  it('suggests (never auto-links) two same-time/same-class snapshots from different providers', async () => {
    const myges = await seedSnapshot({
      provider: 'myges',
      sourceId: 'r1',
      title: 'Algorithmique avancée',
      teacher: 'M. Dupont',
      room: 'B22',
      classes: ['B3-INFO'],
      startAt: START,
      endAt: END,
    });

    await service.reconcileNewSnapshots([myges.id]);

    const myefrei = await seedSnapshot({
      provider: 'myefrei',
      sourceId: 'u1',
      title: 'Algorithmique avancée',
      teacher: 'M. Dupont',
      room: 'B22',
      classes: ['B3-INFO'],
      startAt: START,
      endAt: END,
    });

    await service.reconcileNewSnapshots([myefrei.id]);

    const refreshedMyefrei = await prisma.eventSnapshot.findUniqueOrThrow({ where: { id: myefrei.id } });
    // Never auto-merged: still its own solo GlobalEvent.
    expect(refreshedMyefrei.globalEventId).not.toBe(myges.globalEventId);

    const matches = await prisma.eventMatch.findMany({ where: { snapshotId: myefrei.id } });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.status).toBe('SUGGESTED');
    expect(matches[0]!.matchBasis).toBe('FUZZY_RESEMBLANCE');
    expect(matches[0]!.globalEventId).toBe(myges.globalEventId);

    const suggestions = await service.listSuggestions();
    expect(suggestions.map((s) => s.id)).toContain(matches[0]!.id);
  });

  it('flags AMBIGUOUS (not a single suggestion) when multiple close candidates exist', async () => {
    const mygesA = await seedSnapshot({
      provider: 'myges',
      sourceId: 'rA',
      title: 'Algorithmique avancée',
      teacher: 'M. Dupont',
      classes: ['B3-INFO'],
      startAt: START,
      endAt: END,
    });
    await service.reconcileNewSnapshots([mygesA.id]);

    const mygesB = await seedSnapshot({
      provider: 'myges',
      sourceId: 'rB',
      title: 'Algorithmique avancée',
      teacher: 'M. Dupont',
      // no classes/room on this one, so it stays cross-provider-ambiguous with A
      startAt: START,
      endAt: END,
    });
    await service.reconcileNewSnapshots([mygesB.id]);

    const myefrei = await seedSnapshot({
      provider: 'myefrei',
      sourceId: 'u2',
      title: 'Algorithmique avancée',
      teacher: 'M. Dupont',
      startAt: START,
      endAt: END,
    });
    await service.reconcileNewSnapshots([myefrei.id]);

    const matches = await prisma.eventMatch.findMany({ where: { snapshotId: myefrei.id } });
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.status === 'AMBIGUOUS')).toBe(true);

    const refreshed = await prisma.eventSnapshot.findUniqueOrThrow({ where: { id: myefrei.id } });
    expect(refreshed.globalEventId).toBe(myefrei.globalEventId); // untouched, stays solo
  });

  it('confirming a suggestion retires the solo GlobalEvent and reassigns the Google mapping without creating a duplicate', async () => {
    const myges = await seedSnapshot({
      provider: 'myges',
      sourceId: 'r3',
      title: 'Réseaux',
      teacher: 'Mme Martin',
      classes: ['B2-RES'],
      startAt: START,
      endAt: END,
    });
    await service.reconcileNewSnapshots([myges.id]);

    // myges's GlobalEvent already has a live Google mapping.
    await prisma.eventMapping.create({
      data: {
        provider: 'myges',
        globalEventId: myges.globalEventId,
        googleEventId: 'google-myges-1',
        lastKnownStartAt: START,
        lastKnownEndAt: END,
        lastAction: 'CREATED',
      },
    });

    const myefrei = await seedSnapshot({
      provider: 'myefrei',
      sourceId: 'u3',
      title: 'Réseaux',
      teacher: 'Mme Martin',
      classes: ['B2-RES'],
      startAt: START,
      endAt: END,
    });
    await service.reconcileNewSnapshots([myefrei.id]);
    const soloGlobalEventIdBeforeConfirm = myefrei.globalEventId;

    // myefrei's own (solo) GlobalEvent ALSO has a live mapping — confirming must
    // not leave Google with two entries for the same real class.
    await prisma.eventMapping.create({
      data: {
        provider: 'myefrei',
        globalEventId: soloGlobalEventIdBeforeConfirm,
        googleEventId: 'google-myefrei-1',
        lastKnownStartAt: START,
        lastKnownEndAt: END,
        lastAction: 'CREATED',
      },
    });

    const match = await prisma.eventMatch.findFirstOrThrow({
      where: { snapshotId: myefrei.id, status: 'SUGGESTED' },
    });

    await service.confirmMatch(match.id, 'test-user');

    const refreshedSnapshot = await prisma.eventSnapshot.findUniqueOrThrow({ where: { id: myefrei.id } });
    expect(refreshedSnapshot.globalEventId).toBe(myges.globalEventId);

    const retiredGlobalEvent = await prisma.globalEvent.findUniqueOrThrow({
      where: { id: soloGlobalEventIdBeforeConfirm },
    });
    expect(retiredGlobalEvent.retiredAt).not.toBeNull();

    // The redundant myefrei mapping was deleted (and its Google event deleted)
    // rather than left to duplicate the surviving myges mapping.
    const survivingMappings = await prisma.eventMapping.findMany({});
    expect(survivingMappings).toHaveLength(1);
    expect(survivingMappings[0]!.globalEventId).toBe(myges.globalEventId);
    expect(survivingMappings[0]!.googleEventId).toBe('google-myges-1');
    expect(fakeGoogle.deletedEvents).toEqual([{ calendarId: 'calendar-myefrei', googleEventId: 'google-myefrei-1' }]);

    const confirmedMatch = await prisma.eventMatch.findFirstOrThrow({
      where: { snapshotId: myefrei.id, status: 'CONFIRMED' },
    });
    expect(confirmedMatch.globalEventId).toBe(myges.globalEventId);

    // Append-only: the original SUGGESTED row is untouched, not deleted/mutated.
    const originalSuggestion = await prisma.eventMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(originalSuggestion.status).toBe('SUGGESTED');
  });

  it('auto-links a repeat occurrence on the next run once a pair has been confirmed once', async () => {
    const mygesWeek1 = await seedSnapshot({
      provider: 'myges',
      sourceId: 'w1-myges',
      title: 'Base de données',
      teacher: 'Dr. Petit',
      classes: ['B2-BDD'],
      startAt: START,
      endAt: END,
    });
    await service.reconcileNewSnapshots([mygesWeek1.id]);

    const myefreiWeek1 = await seedSnapshot({
      provider: 'myefrei',
      sourceId: 'w1-myefrei',
      title: 'Base de données',
      teacher: 'Dr. Petit',
      classes: ['B2-BDD'],
      startAt: START,
      endAt: END,
    });
    await service.reconcileNewSnapshots([myefreiWeek1.id]);

    const suggestion = await prisma.eventMatch.findFirstOrThrow({
      where: { snapshotId: myefreiWeek1.id, status: 'SUGGESTED' },
    });
    await service.confirmMatch(suggestion.id, 'test-user');

    // Week 2: a brand-new myges snapshot with the same teacher/subject/classes,
    // a week later, no fuzzy time overlap with week 1 at all.
    const weekLaterStart = new Date(START.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekLaterEnd = new Date(END.getTime() + 7 * 24 * 60 * 60 * 1000);

    const mygesWeek2 = await seedSnapshot({
      provider: 'myges',
      sourceId: 'w2-myges',
      title: 'Base de données',
      teacher: 'Dr. Petit',
      classes: ['B2-BDD'],
      startAt: weekLaterStart,
      endAt: weekLaterEnd,
    });
    await service.reconcileNewSnapshots([mygesWeek2.id]);

    const refreshed = await prisma.eventSnapshot.findUniqueOrThrow({ where: { id: mygesWeek2.id } });
    const activeGlobalEventId = (
      await prisma.eventSnapshot.findUniqueOrThrow({ where: { id: myefreiWeek1.id } })
    ).globalEventId;

    expect(refreshed.globalEventId).toBe(activeGlobalEventId);

    const autoLinkMatch = await prisma.eventMatch.findFirstOrThrow({
      where: { snapshotId: mygesWeek2.id },
    });
    expect(autoLinkMatch.status).toBe('AUTO_LINKED');
    expect(autoLinkMatch.matchBasis).toBe('APPROVED_PRIOR_MATCH');
  });

  it('unlinking restores a solo GlobalEvent and promotes a new primary if needed', async () => {
    const myges = await seedSnapshot({
      provider: 'myges',
      sourceId: 'r4',
      title: 'Systèmes distribués',
      teacher: 'Prof. Diallo',
      classes: ['B3-SYS'],
      startAt: START,
      endAt: END,
    });
    await service.reconcileNewSnapshots([myges.id]);

    const myefrei = await seedSnapshot({
      provider: 'myefrei',
      sourceId: 'u4',
      title: 'Systèmes distribués',
      teacher: 'Prof. Diallo',
      classes: ['B3-SYS'],
      startAt: START,
      endAt: END,
      room: 'has-more-detail', // more complete -> higher completeness score
    });
    const originalMyefreiSoloGlobalEventId = myefrei.globalEventId;
    await service.reconcileNewSnapshots([myefrei.id]);

    const suggestion = await prisma.eventMatch.findFirstOrThrow({
      where: { snapshotId: myefrei.id, status: 'SUGGESTED' },
    });
    await service.confirmMatch(suggestion.id, 'test-user');

    const sharedGlobalEventId = (
      await prisma.eventSnapshot.findUniqueOrThrow({ where: { id: myefrei.id } })
    ).globalEventId;
    expect(sharedGlobalEventId).toBe(myges.globalEventId);

    // myges is primary today (it was the GlobalEvent that absorbed the merge).
    const before = await prisma.globalEvent.findUniqueOrThrow({ where: { id: sharedGlobalEventId } });
    expect(before.primarySnapshotId).toBe(myges.id);

    // Unlink the PRIMARY (myges) — myefrei should be promoted to primary of the
    // (now single-snapshot) shared GlobalEvent, and myges gets its own solo one.
    await service.unlinkSnapshot(sharedGlobalEventId, myges.id, 'test-user');

    const refreshedMyges = await prisma.eventSnapshot.findUniqueOrThrow({ where: { id: myges.id } });
    expect(refreshedMyges.globalEventId).not.toBe(sharedGlobalEventId);

    const newSoloGlobalEvent = await prisma.globalEvent.findUniqueOrThrow({
      where: { id: refreshedMyges.globalEventId },
    });
    expect(newSoloGlobalEvent.primarySnapshotId).toBe(myges.id);
    expect(newSoloGlobalEvent.retiredAt).toBeNull();

    const sharedAfter = await prisma.globalEvent.findUniqueOrThrow({ where: { id: sharedGlobalEventId } });
    expect(sharedAfter.primarySnapshotId).toBe(myefrei.id);
    expect(sharedAfter.retiredAt).toBeNull();

    const unlinkMatch = await prisma.eventMatch.findFirstOrThrow({
      where: { globalEventId: sharedGlobalEventId, snapshotId: myges.id, status: 'UNLINKED' },
    });
    expect(unlinkMatch).toBeTruthy();

    void originalMyefreiSoloGlobalEventId; // referenced for narrative clarity only
  });
});
