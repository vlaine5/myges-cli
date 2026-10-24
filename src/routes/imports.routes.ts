import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import type { Services } from '../services';
import { asyncHandler } from '../lib/http';
import { detectProviderFromIcs } from '../lib/ics-provider-detector';
import { previewIcsContent, type DeleteEventsStrategy } from '../modules/imports/ics-import.service';

const providerSchema = z.enum(['myges', 'myefrei', 'ensup', 'generic']);

const importFileBodySchema = z.object({
  /** Raw ICS file content as a string */
  content: z.string().min(1),
  /** Provider to use for the events */
  provider: providerSchema,
  /** Display name for this import */
  name: z.string().trim().min(1).max(200).optional(),
  /** Original filename, for display purposes */
  filename: z.string().trim().max(200).optional(),
});

const importUrlBodySchema = z.object({
  /** Remote ICS URL to fetch and import */
  icsUrl: z.string().url(),
  /** Provider to use for the events */
  provider: providerSchema,
  /** Display name for this import */
  name: z.string().trim().min(1).max(200).optional(),
});

const detectBodySchema = z.object({
  content: z.string().min(1),
});

const previewFileBodySchema = z.object({
  /** Raw ICS file content */
  content: z.string().min(1),
  /** Fallback provider when per-event and file-level detection both fail */
  fallbackProvider: z.enum(['myges', 'myefrei', 'ensup', 'generic']).default('generic'),
});

const previewUrlBodySchema = z.object({
  /** Remote ICS URL to fetch and preview */
  icsUrl: z.string().url(),
  /** Fallback provider when detection fails */
  fallbackProvider: z.enum(['myges', 'myefrei', 'ensup', 'generic']).default('generic'),
});

export function createImportsRouter(services: Services) {
  const router = Router();

  // Allow larger JSON bodies for ICS file content (up to 5 MB)
  const largeJson = express.json({ limit: '5mb' });

  /**
   * POST /api/imports/detect
   * Detect provider from raw ICS content without importing.
   */
  router.post(
    '/detect',
    largeJson,
    asyncHandler(async (request, response) => {
      const body = detectBodySchema.parse(request.body);
      const result = detectProviderFromIcs(body.content);
      response.json(result);
    }),
  );

  /**
   * POST /api/imports/ics/preview/file
   * Preview what a file-based ICS import would produce — no DB writes.
   * Returns per-event provider detection, noise classification, and normalized fields.
   */
  router.post(
    '/ics/preview/file',
    largeJson,
    asyncHandler(async (request, response) => {
      const body = previewFileBodySchema.parse(request.body);
      const result = previewIcsContent(body.content, body.fallbackProvider);
      response.json(result);
    }),
  );

  /**
   * POST /api/imports/ics/preview/url
   * Preview what a URL-based ICS import would produce — no DB writes.
   * Fetches the URL then runs the same preview pipeline as the file endpoint.
   */
  router.post(
    '/ics/preview/url',
    asyncHandler(async (request, response) => {
      const body = previewUrlBodySchema.parse(request.body);
      const rawContent = await (async () => {
        // We need the raw text for file-level detection; fetchAndParseIcs discards it.
        const resp = await fetch(body.icsUrl, {
          headers: {
            Accept: 'text/calendar, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (compatible; AcademicSync/1.0)',
          },
        });
        if (!resp.ok) {
          throw new Error(`ICS fetch failed: HTTP ${resp.status}`);
        }
        return resp.text();
      })();

      const result = previewIcsContent(rawContent, body.fallbackProvider);
      response.json(result);
    }),
  );

  /**
   * POST /api/imports/ics/file
   * Import ICS from raw file content (sent as JSON string).
   * Frontend reads the file with FileReader.text() and sends content here.
   */
  router.post(
    '/ics/file',
    largeJson,
    asyncHandler(async (request, response) => {
      const body = importFileBodySchema.parse(request.body);

      // Auto-detect provider from content for metadata purposes
      const detection = detectProviderFromIcs(body.content);

      const name = body.name ?? body.filename ?? `Import fichier ICS — ${new Date().toLocaleDateString('fr-FR')}`;

      const result = await services.icsImportService.importFromContent({
        content: body.content,
        provider: body.provider as Parameters<typeof services.icsImportService.importFromContent>[0]['provider'],
        name,
        filename: body.filename,
        detectedProvider: detection.provider !== 'generic' ? detection.provider : undefined,
        detectionConfidence: detection.confidence !== 'none' ? detection.confidence : undefined,
        detectionReason: detection.reason,
      });

      response.status(201).json(result);
    }),
  );

  /**
   * POST /api/imports/ics/url
   * Import ICS from a remote URL.
   */
  router.post(
    '/ics/url',
    asyncHandler(async (request, response) => {
      const body = importUrlBodySchema.parse(request.body);
      const name = body.name ?? `Import URL ICS — ${new Date().toLocaleDateString('fr-FR')}`;

      const result = await services.icsImportService.importFromUrl({
        icsUrl: body.icsUrl,
        provider: body.provider as Parameters<typeof services.icsImportService.importFromUrl>[0]['provider'],
        name,
      });

      response.status(201).json(result);
    }),
  );

  /**
   * GET /api/imports
   * List all past imports.
   */
  router.get(
    '/',
    asyncHandler(async (_request, response) => {
      response.json(await services.icsImportService.list());
    }),
  );

  /**
   * GET /api/imports/:id
   * Get a single import record.
   */
  router.get(
    '/:id',
    asyncHandler(async (request, response) => {
      response.json(await services.icsImportService.getById(String(request.params.id)));
    }),
  );

  /**
   * GET /api/imports/:id/events
   * List events linked to this import.
   */
  router.get(
    '/:id/events',
    asyncHandler(async (request, response) => {
      response.json(await services.icsImportService.getEvents(String(request.params.id)));
    }),
  );

  /**
   * DELETE /api/imports/:id
   * Delete an import record.
   *
   * Query params:
   *   deleteEvents=none    (default) keep all EventSnapshot rows
   *   deleteEvents=future  delete exclusively-linked future EventSnapshot rows
   *   deleteEvents=all     delete all exclusively-linked EventSnapshot rows
   */
  router.delete(
    '/:id',
    asyncHandler(async (request, response) => {
      const deleteEventsParam = request.query['deleteEvents'];
      const allowedStrategies = ['none', 'future', 'all'] as const;
      const deleteEvents: DeleteEventsStrategy =
        allowedStrategies.includes(deleteEventsParam as DeleteEventsStrategy)
          ? (deleteEventsParam as DeleteEventsStrategy)
          : 'none';

      const result = await services.icsImportService.delete(String(request.params.id), deleteEvents);
      response.status(200).json(result);
    }),
  );

  /**
   * POST /api/imports/:id/reimport
   * Re-fetch and re-import a URL-based import with sync semantics.
   * Disappeared future events are removed; past events are kept.
   */
  router.post(
    '/:id/reimport',
    asyncHandler(async (request, response) => {
      response.json(await services.icsImportService.reimport(String(request.params.id)));
    }),
  );

  return router;
}
