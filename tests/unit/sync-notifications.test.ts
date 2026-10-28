import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsService } from '../../src/modules/events/events.service';
import { ProviderCredentialStore } from '../../src/modules/providers/provider-credential.store';
import { EnrichmentRuleService } from '../../src/modules/enrichment/enrichment-rule.service';
import { NotificationService } from '../../src/modules/notifications/notification.service';
import { ReconciliationService } from '../../src/modules/reconciliation/reconciliation.service';
import { SyncService } from '../../src/modules/sync/sync.service';
import type { AcademicProvider } from '../../src/modules/providers/types';
import type { NormalizedEvent } from '../../src/modules/events/types';

/**
 * A sync notifies the planning changes it brought in, once, and only when
 * there are some: not on the provider's first fetch, not when nothing changed.
 */
const migrationsRoot = path.resolve(__dirname, '../../prisma/migrations');
const tmpDbPath = path.join(os.tmpdir(), `sync-notifications-${process.pid}-${Date.now()}.db`);
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
  await prisma.notificationLog.deleteMany({});
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
const hour = 60 * 60 * 1000;

function makeEvent(id: string, startAt: Date, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: `myges:${id}`, provider: 'myges', sourceId: id, reservationId: null,
    title: `Cours ${id}`, subject: null, startAt, endAt: new Date(startAt.getTime() + 2 * hour),
    teacher: null, room: 'Salle 101', campus: null, rooms: [], promotion: null, group: null, classes: [],
    modality: null, reservationType: null, studentCount: null, disciplineName: null,
    disciplineTeacher: null, disciplineId: null, rawPayload: null, sourceHash: `hash-${id}`,
    ...overrides,
  };
}

async function setup(fetched: { current: NormalizedEvent[] }) {
  const provider: AcademicProvider = {
    id: 'myges', displayName: 'MyGES',
    authenticate: vi.fn(), testConnection: vi.fn(), getStatus: vi.fn(),
    fetchEvents: vi.fn(async () => fetched.current),
  };
  const registry = { getProvider: () => provider, getActiveProvider: async () => provider } as any;
  const google = {
    getConfiguredCalendarId: vi.fn(async () => 'cal'),
    upsertEvent: vi.fn(async () => ({ id: 'g1' })),
    deleteEvent: vi.fn(),
    listLiveEventIds: vi.fn(async () => new Set<string>()),
  };

  const webhookCalls: Array<{ url: string; body: any }> = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    webhookCalls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response('ok', { status: 200 });
  });
  const sentMails: any[] = [];
  const transportFactory = vi.fn(() => ({ sendMail: vi.fn(async (mail: any) => sentMails.push(mail)), close: vi.fn() }));

  const notifications = new NotificationService(prisma, registry, {
    createTransport: transportFactory as any,
    fetch: fetchMock as any,
    retryDelaysMs: [0],
  });
  await notifications.updateSettings({
    emailEnabled: true, smtpHost: 'smtp.example.test', smtpPort: 587, smtpSecurity: 'starttls',
    smtpUser: 'me', smtpPassword: 'secret', emailFrom: 'bot@example.test', emailTo: 'me@example.test',
    webhookEnabled: true, webhookUrl: 'https://hooks.example.test/abc', webhookFormat: 'json',
    notifyAdded: true, notifyUpdated: true, notifyRemoved: true, horizonDays: 14,
  });

  const eventsService = new EventsService(prisma, registry, {} as any, new ProviderCredentialStore(prisma), new EnrichmentRuleService(prisma));
  const reconciliation = new ReconciliationService(prisma, google as any);
  const sync = new SyncService(prisma, eventsService, registry, {} as any, google as any, {} as any, reconciliation, notifications);

  return { sync, google, webhookCalls, sentMails, notifications };
}

describe('SyncService — planning change notifications', () => {
  const now = Date.now();
  const range = { start: new Date(now - 7 * day), end: new Date(now + 30 * day) };

  it('stays quiet on the first fetch and when nothing changed, then notifies each change once', async () => {
    const a = makeEvent('a', new Date(now + day));
    const b = makeEvent('b', new Date(now + 2 * day));
    const fetched = { current: [a, b] };
    const { sync, webhookCalls, sentMails } = await setup(fetched);

    await sync.run({ trigger: 'SCHEDULED', range });
    await sync.run({ trigger: 'SCHEDULED', range });
    // Same events with a different source hash (e.g. a new student count): still the same planning
    fetched.current = [{ ...a, sourceHash: 'other' }, b];
    await sync.run({ trigger: 'SCHEDULED', range });
    expect(webhookCalls).toHaveLength(0);
    expect(sentMails).toHaveLength(0);

    fetched.current = [
      { ...a, room: 'Salle 204', sourceHash: 'a2' },
      makeEvent('c', new Date(now + 3 * day)),
    ];
    await sync.run({ trigger: 'SCHEDULED', range });
    expect(webhookCalls).toHaveLength(1);
    expect(sentMails).toHaveLength(1);
    expect(webhookCalls[0]!.url).toBe('https://hooks.example.test/abc');
    expect(webhookCalls[0]!.body.changes.added.map((event: any) => event.id)).toEqual(['myges:c']);
    expect(webhookCalls[0]!.body.changes.removed.map((event: any) => event.id)).toEqual(['myges:b']);
    expect(webhookCalls[0]!.body.changes.updated[0].changedFields).toEqual(['room']);
    expect(sentMails[0]!.to).toBe('me@example.test');
    expect(sentMails[0].subject).toContain('1 nouveau cours, 1 cours modifié, 1 cours annulé');

    await sync.run({ trigger: 'SCHEDULED', range });
    expect(webhookCalls).toHaveLength(1);
    expect(await prisma.notificationLog.count({ where: { status: 'SENT' } })).toBe(2);
  });

  it('notifies even when the Google push then fails, and a failed delivery never fails the sync', async () => {
    await prisma.appSettings.update({ where: { id: 1 }, data: { googleSyncEnabled: true } });
    const fetched = { current: [makeEvent('a', new Date(now + day))] };
    const { sync, google, webhookCalls, notifications } = await setup(fetched);
    await sync.run({ trigger: 'SCHEDULED', range, pushToGoogle: false });

    google.upsertEvent.mockRejectedValue(new Error('Google down'));
    fetched.current = [makeEvent('a', new Date(now + day)), makeEvent('b', new Date(now + 2 * day))];
    await expect(sync.run({ trigger: 'SCHEDULED', range })).rejects.toThrow('Google down');
    expect(webhookCalls).toHaveLength(1);

    // A transient failure is retried
    const flaky = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429, statusText: 'Too Many Requests' }))
      .mockResolvedValue(new Response('ok', { status: 200 }));
    (notifications as any).dependencies.fetch = flaky;
    fetched.current = [makeEvent('a', new Date(now + day))];
    await sync.run({ trigger: 'SCHEDULED', range, pushToGoogle: false });
    expect(flaky).toHaveBeenCalledTimes(2);

    (notifications as any).dependencies.fetch = vi.fn(async () => new Response('nope', { status: 500, statusText: 'Server Error' }));
    fetched.current = [makeEvent('a', new Date(now + day)), makeEvent('d', new Date(now + 4 * day))];
    await sync.run({ trigger: 'SCHEDULED', range, pushToGoogle: false });
    const failed = await prisma.notificationLog.findFirst({ where: { channel: 'webhook', status: 'FAILED' } });
    expect(failed?.error).toBe('Le webhook a répondu 500 Server Error');
    expect(failed?.message).toContain('Cours d');
  });

  it('notifies what a refresh committed before failing', async () => {
    const fetched = { current: [makeEvent('a', new Date(now + day)), makeEvent('b', new Date(now + 2 * day))] };
    const { sync, webhookCalls } = await setup(fetched);
    await sync.run({ trigger: 'SCHEDULED', range });

    // b disappears (its stale snapshot is deleted), then the upsert transaction fails
    fetched.current = [makeEvent('a', new Date(now + day))];
    const spy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    await expect(sync.run({ trigger: 'SCHEDULED', range })).rejects.toThrow('SQLITE_BUSY');
    spy.mockRestore();

    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0]!.body.changes.removed.map((event: any) => event.id)).toEqual(['myges:b']);
  });

  it('does not report every course as new after future events were deleted', async () => {
    const fetched = { current: [makeEvent('past', new Date(now - 2 * day)), makeEvent('a', new Date(now + day))] };
    const { sync, webhookCalls } = await setup(fetched);
    await sync.run({ trigger: 'SCHEDULED', range });

    await prisma.eventSnapshot.deleteMany({ where: { startAt: { gte: new Date() } } });
    await sync.run({ trigger: 'SCHEDULED', range });
    expect(webhookCalls).toHaveLength(0);
  });

  it('reports a change once when two refreshes of a provider overlap', async () => {
    const fetched = { current: [makeEvent('a', new Date(now + day))] };
    const { sync, webhookCalls, notifications } = await setup(fetched);
    await sync.run({ trigger: 'SCHEDULED', range });

    fetched.current = [makeEvent('a', new Date(now + day), { room: 'Salle 204' })];
    // An agenda ICS refresh of the same provider running alongside the provider sync
    const agendaRefresh = notifications.trackPlanningChanges('myges', async () => {
      await prisma.eventSnapshot.update({ where: { id: 'myges:a' }, data: { room: 'Salle 204' } });
    });
    await Promise.all([agendaRefresh, sync.run({ trigger: 'SCHEDULED', range })]);
    expect(webhookCalls).toHaveLength(1);
  });

  it('respects the per-type switches', async () => {
    const fetched = { current: [makeEvent('a', new Date(now + day))] };
    const { sync, webhookCalls, notifications } = await setup(fetched);
    const settings = await notifications.getSettings();
    await notifications.updateSettings({ ...settings, notifyAdded: false, smtpPassword: undefined, webhookUrl: undefined });
    await sync.run({ trigger: 'SCHEDULED', range });

    fetched.current = [makeEvent('a', new Date(now + day)), makeEvent('b', new Date(now + 2 * day))];
    await sync.run({ trigger: 'SCHEDULED', range });
    expect(webhookCalls).toHaveLength(0);

    fetched.current = [makeEvent('b', new Date(now + 2 * day))];
    await sync.run({ trigger: 'SCHEDULED', range });
    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0]!.body.changes.removed).toHaveLength(1);
  });

  it('keeps stored secrets when they are left blank and never returns them', async () => {
    const { notifications } = await setup({ current: [] });
    const settings = await notifications.getSettings();
    expect(settings).not.toHaveProperty('smtpPassword');
    expect(settings.smtpPasswordSet).toBe(true);
    expect(settings.webhookUrlHint).toBe('https://hooks.example.test/…');
    expect(JSON.stringify(settings)).not.toContain('abc');

    const saved = await notifications.updateSettings({ ...settings, smtpPassword: '', webhookUrl: '' });
    expect(saved.smtpPasswordSet).toBe(true);
    expect(saved.webhookUrlSet).toBe(true);

    // The stored password is never sent to another server or login
    await expect(notifications.updateSettings({ ...settings, smtpHost: 'elsewhere.test' })).rejects.toThrow(
      'ressaisis le mot de passe',
    );
    const moved = await notifications.updateSettings({ ...settings, smtpHost: 'elsewhere.test', smtpPassword: 'new' });
    expect(moved.smtpPasswordSet).toBe(true);
    const anonymous = await notifications.updateSettings({ ...settings, smtpUser: '' });
    expect(anonymous.smtpPasswordSet).toBe(false);
    await expect(
      notifications.updateSettings({ ...settings, webhookUrl: null }),
    ).rejects.toThrow('URL du webhook');
  });
});
