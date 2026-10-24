import { Router } from 'express';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import { enrichmentRuleInputSchema } from '../modules/enrichment/enrichment-rule.service';

export function createEnrichmentRulesRouter(services: Services) {
  const router = Router();

  /** GET /api/enrichment-rules — list all rules ordered by priority desc */
  router.get(
    '/',
    asyncHandler(async (_request, response) => {
      response.json(await services.enrichmentRuleService.list());
    }),
  );

  /** GET /api/enrichment-rules/:id — get a single rule */
  router.get(
    '/:id',
    asyncHandler(async (request, response) => {
      response.json(await services.enrichmentRuleService.getById(String(request.params.id)));
    }),
  );

  /** POST /api/enrichment-rules — create a rule */
  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const input = enrichmentRuleInputSchema.parse(request.body);
      response.status(201).json(await services.enrichmentRuleService.create(input));
    }),
  );

  /** PUT /api/enrichment-rules/:id — replace a rule */
  router.put(
    '/:id',
    asyncHandler(async (request, response) => {
      const input = enrichmentRuleInputSchema.parse(request.body);
      response.json(
        await services.enrichmentRuleService.update(String(request.params.id), input),
      );
    }),
  );

  /** DELETE /api/enrichment-rules/:id — delete a rule */
  router.delete(
    '/:id',
    asyncHandler(async (request, response) => {
      await services.enrichmentRuleService.delete(String(request.params.id));
      response.status(204).end();
    }),
  );

  return router;
}
