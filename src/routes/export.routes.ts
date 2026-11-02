import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler, parseBoolean, parseDateValue } from '../lib/http';
import { getRangeFromOffsets } from '../lib/time';
import type { AcademicProviderId } from '../modules/events/types';
import { providerLabel, renderEventsPdf, type PdfGroupBy } from '../modules/export/pdf-export.service';

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

  async function loadPdfEvents(query: Record<string, unknown>) {
    const settings = await services.settingsService.getSettings();
    const range =
      typeof query.start === 'string' && typeof query.end === 'string'
        ? { start: parseDateValue(query.start, 'start'), end: parseDateValue(query.end, 'end') }
        : getRangeFromOffsets(settings.syncLookbackDays, settings.syncFutureDays);
    const providers =
      typeof query.providers === 'string' && query.providers
        ? query.providers.split(',').map((value) => providerQuerySchema.parse(value.trim()))
        : null;
    const subjects =
      typeof query.subjects === 'string' && query.subjects
        ? new Set(query.subjects.split('|').map((value) => value.trim()).filter(Boolean))
        : null;
    const all = await services.eventsService.listEvents(range);
    const events = all.filter(
      (event) =>
        (!providers || providers.includes(event.provider as 'myges' | 'myefrei' | 'ensup')) &&
        (!subjects || subjects.has(event.subject || event.title)),
    );
    return { events, range, timeZone: settings.timezone };
  }

  /** Distinct (provider, subject) pairs of the period, to pick what goes in the PDF. */
  router.get(
    '/pdf/options',
    asyncHandler(async (request, response) => {
      const { events } = await loadPdfEvents({ start: request.query.start, end: request.query.end });
      const counts = new Map<string, { provider: string; subject: string; count: number }>();
      for (const event of events) {
        const subject = event.subject || event.title;
        const key = `${event.provider}|${subject}`;
        const entry = counts.get(key) ?? { provider: event.provider, subject, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
      }
      response.json({
        providers: [...new Set(events.map((event) => event.provider))],
        subjects: [...counts.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'fr')),
      });
    }),
  );

  router.get(
    '/pdf',
    asyncHandler(async (request, response) => {
      const groupBy = ['none', 'provider', 'subject'].includes(String(request.query.group))
        ? (String(request.query.group) as PdfGroupBy)
        : 'provider';
      const { events, range, timeZone } = await loadPdfEvents(request.query);
      const title =
        typeof request.query.title === 'string' && request.query.title
          ? request.query.title
          : typeof request.query.providers === 'string' && !request.query.providers.includes(',')
            ? `Planning ${providerLabel(request.query.providers)}`
            : 'Planning';
      const filename = `${title}`.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'planning';

      response.setHeader('Content-Type', 'application/pdf');
      response.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      const doc = renderEventsPdf({ events, groupBy, timeZone, range, title });
      doc.pipe(response);
      doc.end();
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
