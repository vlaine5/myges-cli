import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import type { AcademicProviderId } from '../modules/events/types';

const providerQuerySchema = z.enum(['myges', 'myefrei', 'ensup', 'generic']);

const decidedBySchema = z.object({
  decidedBy: z.string().min(1).optional(),
});

const unlinkBodySchema = z.object({
  snapshotId: z.string().min(1),
  decidedBy: z.string().min(1).optional(),
});

export function createReconciliationRouter(services: Services) {
  const router = Router();

  /**
   * GET /api/reconciliation/suggestions
   * Pending (not yet confirmed/rejected) SUGGESTED/AMBIGUOUS matches.
   * Query params: provider (optional filter).
   */
  router.get(
    '/suggestions',
    asyncHandler(async (request, response) => {
      const providerId =
        typeof request.query.provider === 'string'
          ? (providerQuerySchema.parse(request.query.provider) as AcademicProviderId)
          : undefined;

      response.json(await services.reconciliationService.listSuggestions({ provider: providerId }));
    }),
  );

  /**
   * POST /api/reconciliation/suggestions/:matchId/confirm
   * Merges the suggested snapshot into the target GlobalEvent.
   */
  router.post(
    '/suggestions/:matchId/confirm',
    asyncHandler(async (request, response) => {
      const payload = decidedBySchema.parse(request.body ?? {});
      await services.reconciliationService.confirmMatch(
        String(request.params.matchId),
        payload.decidedBy ?? 'user',
      );
      response.json({ ok: true });
    }),
  );

  /**
   * POST /api/reconciliation/suggestions/:matchId/reject
   */
  router.post(
    '/suggestions/:matchId/reject',
    asyncHandler(async (request, response) => {
      const payload = decidedBySchema.parse(request.body ?? {});
      await services.reconciliationService.rejectMatch(
        String(request.params.matchId),
        payload.decidedBy ?? 'user',
      );
      response.json({ ok: true });
    }),
  );

  /**
   * POST /api/reconciliation/links/:globalEventId/unlink
   * Body: { snapshotId }
   */
  router.post(
    '/links/:globalEventId/unlink',
    asyncHandler(async (request, response) => {
      const payload = unlinkBodySchema.parse(request.body);
      await services.reconciliationService.unlinkSnapshot(
        String(request.params.globalEventId),
        payload.snapshotId,
        payload.decidedBy ?? 'user',
      );
      response.json({ ok: true });
    }),
  );

  return router;
}
