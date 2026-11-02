import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';

const querySchema = z.object({
  provider: z.enum(['myges', 'myefrei', 'ensup']).optional(),
  kind: z.enum(['ADDED', 'UPDATED', 'REMOVED']).optional(),
  since: z.coerce.date().optional(),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().optional(),
});

export function createChangesRouter(services: Services) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      response.json(await services.planningHistoryService.list(querySchema.parse(request.query)));
    }),
  );

  return router;
}
