import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { env } from '../config/env';
import { ensureDirectory } from '../lib/fs';
import { sha256 } from '../lib/hash';
import { logger } from '../lib/logger';

const MIGRATIONS_TABLE = '_app_migrations';

function resolveDatabasePath(databaseUrl: string) {
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('Only SQLite file: URLs are supported by the migration runner.');
  }

  const rawPath = databaseUrl.slice('file:'.length).split('?')[0] ?? '';

  if (rawPath.startsWith('/')) {
    return rawPath;
  }

  return path.resolve(process.cwd(), rawPath);
}

export async function applySqlMigrations() {
  const databasePath = resolveDatabasePath(env.databaseUrl);
  const migrationsRoot = path.resolve(process.cwd(), 'prisma/migrations');
  await ensureDirectory(path.dirname(databasePath));
  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  database.pragma('foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      appliedAt TEXT NOT NULL
    );
  `);

  const migrationDirectories = fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const appliedMigrationIds = new Set(
    database
      .prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`)
      .all()
      .map((row: unknown) => String((row as { id: string }).id)),
  );

  for (const migrationId of migrationDirectories) {
    if (appliedMigrationIds.has(migrationId)) {
      continue;
    }

    const migrationPath = path.join(migrationsRoot, migrationId, 'migration.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const checksum = sha256(sql);

    const transaction = database.transaction(() => {
      database.exec(sql);
      database
        .prepare(
          `INSERT INTO ${MIGRATIONS_TABLE} (id, checksum, appliedAt) VALUES (?, ?, ?)`,
        )
        .run(migrationId, checksum, new Date().toISOString());
    });

    transaction();
    logger.info({ migrationId }, 'Applied SQL migration.');
  }

  database.close();
}
