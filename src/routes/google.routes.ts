import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { env } from '../config/env';
import { asyncHandler } from '../lib/http';

const providerSchema = z.enum(['myges', 'myefrei', 'ensup']);

const oauthConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  redirectUrl: z.string().url(),
});

const createCalendarSchema = z.object({
  provider: providerSchema,
  summary: z.string().min(1),
  timeZone: z.string().min(1).default('Europe/Paris'),
});

const selectCalendarSchema = z.object({
  provider: providerSchema,
  calendarId: z.string().min(1),
});

export function createGoogleRouter(services: Services) {
  const router = Router();

  router.get(
    '/status',
    asyncHandler(async (_request, response) => {
      response.json(await services.googleAuthService.getStatus());
    }),
  );

  router.get(
    '/config',
    asyncHandler(async (_request, response) => {
      response.json(await services.googleAuthService.getOAuthConfigStatus());
    }),
  );

  router.put(
    '/config',
    asyncHandler(async (request, response) => {
      const body = oauthConfigSchema.parse(request.body);
      await services.googleAuthService.saveOAuthConfig(body.clientId, body.clientSecret, body.redirectUrl);
      response.json({
        ok: true,
        status: await services.googleAuthService.getOAuthConfigStatus(),
      });
    }),
  );

  router.post(
    '/oauth/start',
    asyncHandler(async (_request, response) => {
      response.json({
        authUrl: await services.googleAuthService.createAuthorizationUrl(),
      });
    }),
  );

  router.get(
    '/oauth/callback',
    asyncHandler(async (request, response) => {
      const code = request.query.code;
      const state = request.query.state;

      if (typeof code !== 'string' || typeof state !== 'string') {
        response.redirect(`${env.appBaseUrl}/google?status=error`);
        return;
      }

      await services.googleAuthService.handleOAuthCallback(code, state);
      response.redirect(`${env.appBaseUrl}/google?status=connected`);
    }),
  );

  router.post(
    '/disconnect',
    asyncHandler(async (_request, response) => {
      await services.googleAuthService.disconnect();
      response.json({
        ok: true,
        status: await services.googleAuthService.getStatus(),
      });
    }),
  );

  router.get(
    '/calendars',
    asyncHandler(async (_request, response) => {
      response.json(await services.googleCalendarService.listCalendars());
    }),
  );

  router.post(
    '/calendars',
    asyncHandler(async (request, response) => {
      const body = createCalendarSchema.parse(request.body);
      response.status(201).json(
        await services.googleCalendarService.createCalendar(body.provider, body.summary, body.timeZone),
      );
    }),
  );

  router.put(
    '/calendar',
    asyncHandler(async (request, response) => {
      const body = selectCalendarSchema.parse(request.body);
      response.json(await services.googleCalendarService.selectCalendar(body.provider, body.calendarId));
    }),
  );

  return router;
}
