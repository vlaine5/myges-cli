import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import { agendaInputSchema } from '../modules/agendas/agenda.service';

export function createAgendasRouter(services: Services) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_request, response) => {
      response.json(await services.agendaService.list());
    }),
  );

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const input = agendaInputSchema.parse(request.body);
      const agenda = await services.agendaService.create(input);
      response.status(201).json(agenda);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (request, response) => {
      response.json(await services.agendaService.getById(String(request.params.id)));
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (request, response) => {
      const input = agendaInputSchema.parse(request.body);
      response.json(await services.agendaService.update(String(request.params.id), input));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (request, response) => {
      await services.agendaService.delete(String(request.params.id));
      response.status(204).send();
    }),
  );

  router.post(
    '/:id/sync',
    asyncHandler(async (request, response) => {
      const dryRun = z.boolean().optional().parse(request.body?.dryRun) ?? false;
      response.json(await services.agendaService.sync(String(request.params.id), dryRun));
    }),
  );

  router.post(
    '/:id/test',
    asyncHandler(async (request, response) => {
      response.json(await services.agendaService.test(String(request.params.id)));
    }),
  );

  return router;
}
