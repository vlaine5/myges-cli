import { configureSqlite, prisma } from '../db/prisma';
import { applySqlMigrations } from '../db/migrate';
import { createServices } from '../services';
import type { AcademicProviderId } from '../modules/events/types';

async function main() {
  await applySqlMigrations();
  await prisma.$connect();
  await configureSqlite(prisma);
  const services = createServices(prisma);
  await services.settingsService.ensureDefaults();
  const result = await services.syncService.run({
    trigger: 'MANUAL',
    providerId: process.env.SYNC_PROVIDER as AcademicProviderId | undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

void main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
