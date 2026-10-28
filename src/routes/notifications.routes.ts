import { Router } from 'express';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import {
  notificationSettingsInputSchema,
  notificationTestInputSchema,
} from '../modules/notifications/notification.service';

export function createNotificationsRouter(services: Services) {
  const router = Router();

  router.get(
    '/settings',
    asyncHandler(async (_request, response) => {
      response.json(await services.notificationService.getSettings());
    }),
  );

  router.put(
    '/settings',
    asyncHandler(async (request, response) => {
      const input = notificationSettingsInputSchema.parse(request.body);
      response.json(await services.notificationService.updateSettings(input));
    }),
  );

  /**
   * POST /api/notifications/test
   * Sends a sample planning change on one channel with the saved settings.
   */
  router.post(
    '/test',
    asyncHandler(async (request, response) => {
      const { channel } = notificationTestInputSchema.parse(request.body);
      await services.notificationService.sendTest(channel);
      response.json({ ok: true });
    }),
  );

  router.get(
    '/log',
    asyncHandler(async (_request, response) => {
      response.json(await services.notificationService.listLog());
    }),
  );

  return router;
}
