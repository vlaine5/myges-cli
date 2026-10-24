import { configureSqlite, prisma } from '../db/prisma';
import { applySqlMigrations } from '../db/migrate';
import { createServices } from '../services';
import { getRangeFromOffsets } from '../lib/time';
import type { AcademicProviderId } from '../modules/events/types';

async function main() {
  await applySqlMigrations();
  await prisma.$connect();
  await configureSqlite(prisma);
  const services = createServices(prisma);
  await services.settingsService.ensureDefaults();
  const settings = await services.settingsService.getSettings();
  const providerId =
    (process.env.EXPORT_PROVIDER as AcademicProviderId | undefined) ??
    (await services.settingsService.getActiveProviderId());
  const range = getRangeFromOffsets(settings.syncLookbackDays, settings.syncFutureDays);
  const shouldRefresh = ['1', 'true', 'yes', 'on'].includes(
    (process.env.REFRESH_EXPORT ?? '').toLowerCase(),
  );
  const events = shouldRefresh
    ? (
        await services.eventsService.refreshRange(range, {
          includeRawPayload: settings.storeRawPayload,
          providerId,
        })
      ).events
    : (await services.eventsService.listEvents(range, { providerId })).map((event) => ({
        ...event,
        startAt: new Date(event.startAt),
        endAt: new Date(event.endAt),
      }));
  const exported = await services.icsExportService.exportRange(
    providerId,
    range,
    events,
    true,
  );
  console.log(JSON.stringify(exported, null, 2));
}

void main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
