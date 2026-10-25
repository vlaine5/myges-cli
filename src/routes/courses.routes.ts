import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';

const yearQuerySchema = z.object({
  year: z.string().trim().min(1).optional(),
});

export function createCoursesRouter(services: Services) {
  const router = Router();

  /** GET /api/courses/years — academic years available for the active provider. */
  router.get(
    '/years',
    asyncHandler(async (_request, response) => {
      response.json({ years: await services.coursesService.listYears() });
    }),
  );

  /** GET /api/courses?year=YYYY — courses for a year (defaults to latest). */
  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const { year } = yearQuerySchema.parse(request.query);
      response.json(await services.coursesService.getCourses(year));
    }),
  );

  return router;
}
