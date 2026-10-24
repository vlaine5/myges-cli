import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import { ProviderCredentialStore } from '../modules/providers/provider-credential.store';
import type { AcademicProviderId } from '../modules/events/types';

function normalizeIcsUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

const icsSyncSchema = z.object({
  provider: z.enum(['myges', 'myefrei', 'ensup']),
  icsUrl: z.string().min(1).transform(normalizeIcsUrl).pipe(z.string().url()),
});

export function createIcsRouter(services: Services) {
  const router = Router();
  const credentialStore = new ProviderCredentialStore(services.prisma);

  /**
   * POST /api/ics/sync
   * Trigger a smart ICS sync for a given provider + ICS URL.
   * Also persists the ICS URL in the provider config for future reference.
   */
  router.post(
    '/sync',
    asyncHandler(async (request, response) => {
      const body = icsSyncSchema.parse(request.body);
      const result = await services.icsSyncService.syncFromIcs(
        body.provider as AcademicProviderId,
        body.icsUrl,
      );

      // Persist the ICS URL in provider config so it's shown in the UI next time
      await credentialStore.patchConfig(body.provider as AcademicProviderId, { icsUrl: body.icsUrl });

      response.json({ ok: true, ...result });
    }),
  );

  return router;
}
