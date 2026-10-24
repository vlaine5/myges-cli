import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyGesProvider } from '../../src/modules/providers/myges.provider';
import { ProviderCredentialStore } from '../../src/modules/providers/provider-credential.store';

/**
 * Saving credentials (authenticate()) must never wipe out an icsUrl configured
 * separately via PATCH /api/providers/:provider/config — it has to merge onto
 * the existing stored config, not replace it wholesale. Losing icsUrl this way
 * silently falls back to the live API/credentials path on the next sync, which
 * (combined with the stale-snapshot cleanup covered elsewhere) is what produced
 * duplicated events when toggling a provider between ICS and API mode.
 */
const migrationsRoot = path.resolve(__dirname, '../../prisma/migrations');
const tmpDbPath = path.join(os.tmpdir(), `provider-config-preservation-test-${process.pid}-${Date.now()}.db`);

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
  await prisma.academicProviderCredential.deleteMany({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockMyGesTokenResponse() {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    headers: {
      get: (name: string) =>
        name === 'location'
          ? 'https://example.com/callback#access_token=tok-123&token_type=Bearer&expires_in=3600'
          : null,
    },
  } as unknown as Response);
}

describe('MyGesProvider.authenticate — config preservation', () => {
  it('keeps the existing icsUrl in config when saving new credentials', async () => {
    const store = new ProviderCredentialStore(prisma);
    await store.patchConfig('myges', { icsUrl: 'https://example.com/agenda.ics' });

    mockMyGesTokenResponse();
    const provider = new MyGesProvider(prisma);
    await provider.authenticate({ username: 'alice', password: 'secret' });

    const credential = await store.get('myges');
    const config = store.getConfig(credential!);
    expect(config.icsUrl).toBe('https://example.com/agenda.ics');
    expect(credential?.username).toBe('alice');
  });

  it('reports configured/connected via icsUrl alone, without any saved credentials', async () => {
    const store = new ProviderCredentialStore(prisma);
    await store.patchConfig('myges', { icsUrl: 'https://example.com/agenda.ics' });

    const provider = new MyGesProvider(prisma);
    const status = await provider.getStatus();

    expect(status.configured).toBe(true);
    expect(status.hasSavedCredentials).toBe(true);
  });
});
