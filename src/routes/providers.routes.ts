import { Router } from 'express';
import { z } from 'zod';
import type { AcademicProviderId } from '../modules/events/types';
import { isWebcalUrl } from '../lib/ics-parser';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import { ProviderCredentialStore } from '../modules/providers/provider-credential.store';

export type ConnectionMethod = 'api' | 'ics' | 'webcal';

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
  icsUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => /^(https?|webcals?):\/\//i.test(value), 'Lien ICS invalide : https:// ou webcal:// attendu.')
    .nullish(),
}).passthrough();

export function createProvidersRouter(services: Services) {
  const router = Router();
  const credentialStore = new ProviderCredentialStore(services.prisma);
  /**
   * A provider syncs through exactly one method: its calendar link when one is
   * saved (webcal subscription or plain ICS), the live API otherwise.
   */
  const connectionMethodOf = async (providerId: AcademicProviderId): Promise<ConnectionMethod> => {
    const record = await credentialStore.get(providerId);
    const raw = record ? credentialStore.getConfig(record).icsUrl : null;
    if (typeof raw !== 'string' || !raw.trim()) return 'api';
    return isWebcalUrl(raw) ? 'webcal' : 'ics';
  };
  const withMethod = async <T extends { provider?: unknown }>(status: T, providerId?: AcademicProviderId) => {
    const id = (providerId ?? status.provider) as AcademicProviderId;
    return { ...status, connectionMethod: await connectionMethodOf(id) };
  };
  const buildStatusPayload = async () => ({
    activeProvider: await services.settingsService.getActiveProviderId(),
    providers: await Promise.all(
      (await services.providerRegistryService.listStatuses()).map((status) => withMethod(status as { provider?: unknown })),
    ),
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
      response.json(await withMethod(await provider.getStatus(), resolveProviderId(request.params.provider)));
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
        status: await withMethod(await provider.authenticate(payload), resolveProviderId(request.params.provider)),
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
      response.json({ ok: true, status: await withMethod(await provider.getStatus(), providerId) });
    }),
  );

  return router;
}
