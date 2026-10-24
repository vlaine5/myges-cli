import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import type { AcademicProviderId } from '../modules/events/types';

const providerQuerySchema = z.enum(['myges', 'myefrei', 'ensup']);

const syncBodySchema = z
  .object({
    start: z.string().datetime().optional(),
    end: z.string().datetime().optional(),
    provider: providerQuerySchema.optional(),
  })
  .optional();

function resolveRange(payload: z.infer<typeof syncBodySchema>) {
  if (!payload?.start || !payload?.end) {
    return undefined;
  }

  return {
    start: new Date(payload.start),
    end: new Date(payload.end),
  };
}

export function createSyncRouter(services: Services) {
  const router = Router();

  router.post(
    '/run',
    asyncHandler(async (request, response) => {
      const payload = syncBodySchema.parse(request.body);
      response.json(
        await services.syncService.run({
          trigger: 'MANUAL',
          providerId: payload?.provider as AcademicProviderId | undefined,
          range: resolveRange(payload),
        }),
      );
    }),
  );

  router.post(
    '/dry-run',
    asyncHandler(async (request, response) => {
      const payload = syncBodySchema.parse(request.body);
      response.json(
        await services.syncService.run({
          trigger: 'MANUAL',
          dryRun: true,
          providerId: payload?.provider as AcademicProviderId | undefined,
          range: resolveRange(payload),
        }),
      );
    }),
  );

  router.get(
    '/history',
    asyncHandler(async (request, response) => {
      const limit = request.query.limit ? Number.parseInt(String(request.query.limit), 10) : 20;
      const providerId =
        typeof request.query.provider === 'string'
          ? (providerQuerySchema.parse(request.query.provider) as AcademicProviderId)
          : undefined;
      response.json(await services.syncService.listHistory(limit, providerId));
    }),
  );

  return router;
}
