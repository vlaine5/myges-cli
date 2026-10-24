import { Router } from 'express';
import { z } from 'zod';
import type { AcademicProviderId } from '../modules/events/types';
import type { Services } from '../services';
import { asyncHandler, parseBoolean, parseDateValue } from '../lib/http';
import { getRangeFromOffsets } from '../lib/time';

// 'all' is a sentinel meaning "no provider filter — return all providers"
const providerQuerySchema = z.enum(['myges', 'myefrei', 'ensup', 'generic', 'all']);

async function resolveRange(
  services: Services,
  startValue: unknown,
  endValue: unknown,
) {
  if (typeof startValue === 'string' && typeof endValue === 'string') {
    return {
      start: parseDateValue(startValue, 'start'),
      end: parseDateValue(endValue, 'end'),
    };
  }

  const settings = await services.settingsService.getSettings();
  return getRangeFromOffsets(settings.syncLookbackDays, settings.syncFutureDays);
}

export function createEventsRouter(services: Services) {
  const router = Router();

  /**
   * GET /api/events/providers
   * Returns the distinct provider values that have events in the requested range.
   * Used by the Calendar frontend to build a dynamic provider filter.
   */
  router.get(
    '/providers',
    asyncHandler(async (request, response) => {
      const range = await resolveRange(services, request.query.start, request.query.end);
      const providers = await services.eventsService.listActiveProviders(range);
      response.json(providers);
    }),
  );

  /**
   * GET /api/events
   * Query params:
   *   start, end       — ISO date range (optional, defaults to settings range)
   *   provider         — myges | myefrei | ensup | generic | all (default: all)
   *   agendaId         — filter by AgendaConfig id (optional)
   *   refresh          — boolean, re-fetch from upstream (optional)
   *   includeRawPayload — boolean (optional)
   */
  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const range = await resolveRange(services, request.query.start, request.query.end);
      const refresh = parseBoolean(request.query.refresh, false);
      const includeRawPayload = parseBoolean(request.query.includeRawPayload, false);

      // Parse provider: undefined or 'all' → no filter (return all providers)
      const rawProvider = request.query.provider;
      let providerId: AcademicProviderId | undefined;
      if (typeof rawProvider === 'string' && rawProvider !== 'all') {
        const parsed = providerQuerySchema.parse(rawProvider);
        if (parsed !== 'all') providerId = parsed as AcademicProviderId;
      }

      // Parse agendaId
      const agendaId = typeof request.query.agendaId === 'string' ? request.query.agendaId : undefined;

      if (refresh && providerId) {
        await services.eventsService.refreshRange(range, { includeRawPayload, providerId });
      }

      response.json(
        await services.eventsService.listEvents(range, { includeRawPayload, providerId, agendaId }),
      );
    }),
  );

  /**
   * DELETE /api/events
   * Delete events from the snapshot table.
   * Query params:
   *   provider  — provider to target (optional, required if no agendaId)
   *   agendaId  — agendaId to target (optional)
   *   scope     — 'future' (default) | 'all'
   */
  router.delete(
    '/',
    asyncHandler(async (request, response) => {
      const provider = typeof request.query.provider === 'string' ? request.query.provider : undefined;
      const agendaId = typeof request.query.agendaId === 'string' ? request.query.agendaId : undefined;
      const scope = request.query.scope === 'all' ? 'all' : 'future';

      if (!provider && !agendaId) {
        return response.status(400).json({ error: 'BAD_REQUEST', message: 'Provide at least provider or agendaId.' });
      }

      const result = await services.eventsService.deleteEvents({ providerId: provider, agendaId, scope });
      response.json(result);
    }),
  );

  /**
   * GET /api/events/:id
   */
  router.get(
    '/:id',
    asyncHandler(async (request, response) => {
      const includeRawPayload = parseBoolean(request.query.includeRawPayload, true);
      response.json(await services.eventsService.getEventById(String(request.params.id), includeRawPayload));
    }),
  );

  return router;
}
