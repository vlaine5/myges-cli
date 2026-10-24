import { Router } from 'express';
import type { Services } from '../services';
import { asyncHandler, parseDateValue } from '../lib/http';

export function createGlobalEventsRouter(services: Services) {
  const router = Router();

  /**
   * GET /api/global-events
   * Query params: start, end (optional ISO dates).
   */
  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const { start, end } = request.query;
      const range =
        typeof start === 'string' && typeof end === 'string'
          ? { start: parseDateValue(start, 'start'), end: parseDateValue(end, 'end') }
          : {};

      response.json(await services.reconciliationService.listGlobalEvents(range));
    }),
  );

  /**
   * GET /api/global-events/:id
   * Includes linked snapshots inline.
   */
  router.get(
    '/:id',
    asyncHandler(async (request, response) => {
      response.json(await services.reconciliationService.getGlobalEventById(String(request.params.id)));
    }),
  );

  return router;
}
