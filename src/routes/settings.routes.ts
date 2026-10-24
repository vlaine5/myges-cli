import { Router } from 'express';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import { settingsInputSchema } from '../modules/settings/settings.service';

export function createSettingsRouter(services: Services) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_request, response) => {
      response.json(await services.settingsService.getSettings());
    }),
  );

  router.put(
    '/',
    asyncHandler(async (request, response) => {
      const payload = settingsInputSchema.parse(request.body);
      const settings = await services.settingsService.updateSettings(payload);
      await services.schedulerService.reschedule();
      response.json(settings);
    }),
  );

  return router;
}
