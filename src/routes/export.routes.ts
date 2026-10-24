import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler, parseBoolean, parseDateValue } from '../lib/http';
import { getRangeFromOffsets } from '../lib/time';
import type { AcademicProviderId } from '../modules/events/types';

export function createExportRouter(services: Services) {
  const router = Router();
  const providerQuerySchema = z.enum(['myges', 'myefrei', 'ensup']);

  router.get(
    '/ics',
    asyncHandler(async (request, response) => {
      const settings = await services.settingsService.getSettings();
      const providerId =
        typeof request.query.provider === 'string'
          ? (providerQuerySchema.parse(request.query.provider) as AcademicProviderId)
          : await services.settingsService.getActiveProviderId();
      const range =
        typeof request.query.start === 'string' && typeof request.query.end === 'string'
          ? {
              start: parseDateValue(request.query.start, 'start'),
              end: parseDateValue(request.query.end, 'end'),
            }
          : getRangeFromOffsets(settings.syncLookbackDays, settings.syncFutureDays);
      const shouldRefresh = parseBoolean(request.query.refresh, false);
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
        parseBoolean(request.query.save, true),
      );

      response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${providerId}-calendar.ics"`,
      );
      response.send(exported.content);
    }),
  );

  router.get(
    '/ics/latest',
    asyncHandler(async (_request, response) => {
      response.json(
        await services.icsExportService.getLastExport(
          await services.settingsService.getActiveProviderId(),
        ),
      );
    }),
  );

  return router;
}
