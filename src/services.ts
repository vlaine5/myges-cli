import type { PrismaClient } from '@prisma/client';
import { AgendaService } from './modules/agendas/agenda.service';
import { EnrichmentRuleService } from './modules/enrichment/enrichment-rule.service';
import { EventsService } from './modules/events/events.service';
import { IcsImportService } from './modules/imports/ics-import.service';
import { IcsExportService } from './modules/export/ics-export.service';
import { GoogleAuthService } from './modules/google/google-auth.service';
import { GoogleCalendarService } from './modules/google/google-calendar.service';
import { EnsupProvider } from './modules/providers/ensup.provider';
import { MyEfreiProvider } from './modules/providers/myefrei.provider';
import { MyGesProvider } from './modules/providers/myges.provider';
import { ProviderRegistryService } from './modules/providers/provider-registry.service';
import { SchedulerService } from './modules/scheduler/scheduler.service';
import { SettingsService } from './modules/settings/settings.service';
import { IcsSyncService } from './modules/sync/ics-sync.service';
import { SyncService } from './modules/sync/sync.service';

export function createServices(prisma: PrismaClient) {
  const settingsService = new SettingsService(prisma);
  const providerRegistryService = new ProviderRegistryService(prisma, [
    new MyGesProvider(prisma),
    new MyEfreiProvider(prisma),
    new EnsupProvider(prisma),
  ]);
  const eventsService = new EventsService(prisma, providerRegistryService, settingsService);
  const googleAuthService = new GoogleAuthService(prisma);
  const googleCalendarService = new GoogleCalendarService(googleAuthService);
  const icsExportService = new IcsExportService(prisma);
  const syncService = new SyncService(
    prisma,
    eventsService,
    providerRegistryService,
    settingsService,
    googleCalendarService,
    icsExportService,
  );
  const icsSyncService = new IcsSyncService(prisma);
  const agendaService = new AgendaService(
    prisma,
    eventsService,
    icsSyncService,
    providerRegistryService,
    syncService,
  );
  const schedulerService = new SchedulerService(prisma, syncService, agendaService);
  const icsImportService = new IcsImportService(prisma);
  const enrichmentRuleService = new EnrichmentRuleService(prisma);

  return {
    prisma,
    settingsService,
    providerRegistryService,
    eventsService,
    googleAuthService,
    googleCalendarService,
    icsExportService,
    syncService,
    schedulerService,
    icsSyncService,
    agendaService,
    icsImportService,
    enrichmentRuleService,
  };
}

export type Services = ReturnType<typeof createServices>;
