import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';

const yearQuerySchema = z.object({
  year: z.string().trim().min(1).optional(),
});

export function createGradesRouter(services: Services) {
  const router = Router();

  /** GET /api/grades/years — academic years available for the active provider. */
  router.get(
    '/years',
    asyncHandler(async (_request, response) => {
      response.json({ years: await services.gradesService.listYears() });
    }),
  );

  /** GET /api/grades?year=YYYY — structured bulletin (defaults to latest year). */
  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const { year } = yearQuerySchema.parse(request.query);
      response.json(await services.gradesService.getBulletin(year));
    }),
  );

  return router;
}
