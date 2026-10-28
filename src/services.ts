import type { PrismaClient } from '@prisma/client';
import { AgendaService } from './modules/agendas/agenda.service';
import { EnrichmentRuleService } from './modules/enrichment/enrichment-rule.service';
import { EventsService } from './modules/events/events.service';
import { CoursesService } from './modules/courses/courses.service';
import { GradesService } from './modules/grades/grades.service';
import { IcsImportService } from './modules/imports/ics-import.service';
import { IcsExportService } from './modules/export/ics-export.service';
import { GoogleAuthService } from './modules/google/google-auth.service';
import { GoogleCalendarService } from './modules/google/google-calendar.service';
import { EnsupProvider } from './modules/providers/ensup.provider';
import { MyEfreiProvider } from './modules/providers/myefrei.provider';
import { MyGesProvider } from './modules/providers/myges.provider';
import { ProviderRegistryService } from './modules/providers/provider-registry.service';
import { ProviderCredentialStore } from './modules/providers/provider-credential.store';
import { ReconciliationService } from './modules/reconciliation/reconciliation.service';
import { ProviderScheduleService } from './modules/scheduler/provider-schedule.service';
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
  const providerCredentialStore = new ProviderCredentialStore(prisma);
  const enrichmentRuleService = new EnrichmentRuleService(prisma);
  const eventsService = new EventsService(
    prisma,
    providerRegistryService,
    settingsService,
    providerCredentialStore,
    enrichmentRuleService,
  );
  const googleAuthService = new GoogleAuthService(prisma);
  const googleCalendarService = new GoogleCalendarService(googleAuthService);
  const reconciliationService = new ReconciliationService(prisma, googleCalendarService);
  const icsExportService = new IcsExportService(prisma);
  const syncService = new SyncService(
    prisma,
    eventsService,
    providerRegistryService,
    settingsService,
    googleCalendarService,
    icsExportService,
    reconciliationService,
  );
  const icsSyncService = new IcsSyncService(prisma, reconciliationService);
  const agendaService = new AgendaService(
    prisma,
    eventsService,
    icsSyncService,
    providerRegistryService,
    syncService,
  );
  const providerScheduleService = new ProviderScheduleService(prisma);
  const schedulerService = new SchedulerService(prisma, syncService, providerScheduleService, agendaService);
  const icsImportService = new IcsImportService(prisma, reconciliationService);
  const gradesService = new GradesService(providerRegistryService);
  const coursesService = new CoursesService(providerRegistryService);

  return {
    prisma,
    settingsService,
    providerRegistryService,
    eventsService,
    googleAuthService,
    googleCalendarService,
    reconciliationService,
    icsExportService,
    syncService,
    providerScheduleService,
    schedulerService,
    icsSyncService,
    agendaService,
    icsImportService,
    enrichmentRuleService,
    providerCredentialStore,
    gradesService,
    coursesService,
  };
}

export type Services = ReturnType<typeof createServices>;
