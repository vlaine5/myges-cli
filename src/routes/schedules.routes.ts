import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import {
  providerScheduleInputSchema,
  SCHEDULABLE_PROVIDERS,
} from '../modules/scheduler/provider-schedule.service';

const providerParamSchema = z.enum(SCHEDULABLE_PROVIDERS);

export function createSchedulesRouter(services: Services) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_request, response) => {
      response.json(await services.providerScheduleService.list());
    }),
  );

  router.put(
    '/:provider',
    asyncHandler(async (request, response) => {
      const provider = providerParamSchema.parse(request.params.provider);
      const input = providerScheduleInputSchema.parse(request.body);
      response.json(await services.providerScheduleService.save(provider, input));
    }),
  );

  /**
   * POST /api/schedules/:provider/run
   * Runs the provider now with its schedule's Google setting, without consuming a slot.
   */
  router.post(
    '/:provider/run',
    asyncHandler(async (request, response) => {
      const provider = providerParamSchema.parse(request.params.provider);
      const schedule = (await services.providerScheduleService.list()).find((row) => row.provider === provider);
      response.json(
        await services.syncService.run({
          trigger: 'MANUAL',
          providerId: provider,
          pushToGoogle: schedule?.pushToGoogle ?? true,
        }),
      );
    }),
  );

  return router;
}
