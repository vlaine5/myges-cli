import { Router } from 'express';
import { z } from 'zod';
import type { AcademicProviderId } from '../modules/events/types';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import { ProviderCredentialStore } from '../modules/providers/provider-credential.store';

const providerIdSchema = z.enum(['myges', 'myefrei', 'ensup']);
const credentialInputSchema = z.object({
  username: z.string().trim().min(1).optional(),
  password: z.string().min(1).optional(),
  sessionCookie: z.string().min(1).optional(),
  config: z
    .object({
      agendaEndpoint: z.string().url().optional(),
      icsUrl: z.string().url().optional(),
    })
    .passthrough()
    .optional(),
});

function resolveProviderId(rawValue: unknown) {
  return providerIdSchema.parse(rawValue) as AcademicProviderId;
}

const configPatchSchema = z.object({
  agendaEndpoint: z.string().url().nullish(),
  icsUrl: z.string().url().nullish(),
}).passthrough();

export function createProvidersRouter(services: Services) {
  const router = Router();
  const credentialStore = new ProviderCredentialStore(services.prisma);
  const buildStatusPayload = async () => ({
    activeProvider: await services.settingsService.getActiveProviderId(),
    providers: await services.providerRegistryService.listStatuses(),
  });

  router.get(
    '/',
    asyncHandler(async (_request, response) => {
      response.json(await buildStatusPayload());
    }),
  );

  router.get(
    '/status',
    asyncHandler(async (_request, response) => {
      response.json(await buildStatusPayload());
    }),
  );

  router.get(
    '/:provider/status',
    asyncHandler(async (request, response) => {
      const provider = services.providerRegistryService.getProvider(
        resolveProviderId(request.params.provider),
      );
      response.json(await provider.getStatus());
    }),
  );

  router.post(
    '/:provider/login',
    asyncHandler(async (request, response) => {
      const provider = services.providerRegistryService.getProvider(
        resolveProviderId(request.params.provider),
      );
      const payload = credentialInputSchema.parse(request.body);
      response.json({
        ok: true,
        status: await provider.authenticate(payload),
      });
    }),
  );

  router.post(
    '/:provider/connect',
    asyncHandler(async (request, response) => {
      const provider = services.providerRegistryService.getProvider(
        resolveProviderId(request.params.provider),
      );
      const payload = credentialInputSchema.parse(request.body);
      response.json({
        ok: true,
        status: await provider.authenticate(payload),
      });
    }),
  );

  router.post(
    '/:provider/test',
    asyncHandler(async (request, response) => {
      const provider = services.providerRegistryService.getProvider(
        resolveProviderId(request.params.provider),
      );
      const payload = credentialInputSchema.parse(request.body);
      response.json(await provider.testConnection(payload));
    }),
  );

  router.get(
    '/:provider/test',
    asyncHandler(async (request, response) => {
      const provider = services.providerRegistryService.getProvider(
        resolveProviderId(request.params.provider),
      );
      response.json(await provider.testConnection());
    }),
  );

  /**
   * PATCH /api/providers/:provider/config
   * Update provider config fields (icsUrl, agendaEndpoint) without re-authenticating.
   */
  router.patch(
    '/:provider/config',
    asyncHandler(async (request, response) => {
      const providerId = resolveProviderId(request.params.provider);
      const patch = configPatchSchema.parse(request.body);
      await credentialStore.patchConfig(providerId, patch as Record<string, unknown>);
      const provider = services.providerRegistryService.getProvider(providerId);
      response.json({ ok: true, status: await provider.getStatus() });
    }),
  );

  return router;
}
