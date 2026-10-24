import { Router } from 'express';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import { appInfo } from '../lib/app-info';

export function createSystemRouter(services: Services) {
  const router = Router();

  router.get(
    '/health',
    asyncHandler(async (_request, response) => {
      await services.prisma.$queryRaw`SELECT 1`;

      response.json({
        status: 'ok',
        version: appInfo.version,
        scheduler: services.schedulerService.getStatus(),
      });
    }),
  );

  router.get(
    '/diagnostics',
    asyncHandler(async (_request, response) => {
      const activeProviderId = await services.settingsService.getActiveProviderId();
      const [providers, google, settings, lastJob, lastExport, eventCount] = await Promise.all([
        services.providerRegistryService.listStatuses(),
        services.googleAuthService.getStatus(),
        services.settingsService.getSettings(),
        services.syncService.getLastJob(activeProviderId),
        services.icsExportService.getLastExport(activeProviderId),
        services.prisma.eventSnapshot.count({
          where: {
            provider: activeProviderId,
          },
        }),
      ]);

      response.json({
        version: appInfo.version,
        uptimeSeconds: Math.round(process.uptime()),
        scheduler: services.schedulerService.getStatus(),
        providers,
        activeProvider: activeProviderId,
        google,
        settings,
        lastJob,
        lastExport,
        cachedEvents: eventCount,
      });
    }),
  );

  router.get(
    '/dashboard',
    asyncHandler(async (_request, response) => {
      const activeProviderId = await services.settingsService.getActiveProviderId();
      const [provider, google, settings, lastJob] = await Promise.all([
        services.providerRegistryService.getProvider(activeProviderId).getStatus(),
        services.googleAuthService.getStatus(),
        services.settingsService.getSettings(),
        services.syncService.getLastJob(activeProviderId),
      ]);

      response.json({
        provider,
        google,
        settings,
        scheduler: services.schedulerService.getStatus(),
        lastJob,
      });
    }),
  );

  return router;
}
