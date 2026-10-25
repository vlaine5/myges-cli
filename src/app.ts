import fs from 'fs';
import path from 'path';
import express from 'express';
import pinoHttp from 'pino-http';
import { ZodError } from 'zod';
import type { Services } from './services';
import { logger, serializeError } from './lib/logger';
import { AppError, isAppError } from './lib/app-error';
import { createSystemRouter } from './routes/system.routes';
import { createProvidersRouter } from './routes/providers.routes';
import { createEventsRouter } from './routes/events.routes';
import { createSyncRouter } from './routes/sync.routes';
import { createGoogleRouter } from './routes/google.routes';
import { createSettingsRouter } from './routes/settings.routes';
import { createExportRouter } from './routes/export.routes';
import { createStatsRouter } from './routes/stats.routes';
import { createIcsRouter } from './routes/ics.routes';
import { createAgendasRouter } from './routes/agendas.routes';
import { createImportsRouter } from './routes/imports.routes';
import { createEnrichmentRulesRouter } from './routes/enrichment-rules.routes';
import { createReconciliationRouter } from './routes/reconciliation.routes';
import { createGlobalEventsRouter } from './routes/global-events.routes';
import { createGradesRouter } from './routes/grades.routes';
import { createCoursesRouter } from './routes/courses.routes';

export function createApp(services: Services) {
  const app = express();
  const webDistPath = path.resolve(process.cwd(), 'dist/web');

  app.use(
    pinoHttp({
      logger,
      // Never log request headers: browsers send every cookie for the host,
      // including other self-hosted apps' session tokens on the same IP.
      serializers: {
        req: (req: { method?: string; url?: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
        err: serializeError,
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createSystemRouter(services));
  app.use('/api/providers', createProvidersRouter(services));
  app.use('/api/events', createEventsRouter(services));
  app.use('/api/sync', createSyncRouter(services));
  app.use('/api/google', createGoogleRouter(services));
  app.use('/api/settings', createSettingsRouter(services));
  app.use('/api/export', createExportRouter(services));
  app.use('/api/stats', createStatsRouter(services));
  app.use('/api/ics', createIcsRouter(services));
  app.use('/api/agendas', createAgendasRouter(services));
  app.use('/api/imports', createImportsRouter(services));
  app.use('/api/enrichment-rules', createEnrichmentRulesRouter(services));
  app.use('/api/reconciliation', createReconciliationRouter(services));
  app.use('/api/global-events', createGlobalEventsRouter(services));
  app.use('/api/grades', createGradesRouter(services));
  app.use('/api/courses', createCoursesRouter(services));

  app.use('/api/*', (_request, _response, next) => {
    next(new AppError('API route not found.', 404, 'NOT_FOUND'));
  });

  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get('*', (request, response, next) => {
      if (request.path.startsWith('/api')) {
        next();
        return;
      }

      response.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  app.use((
    error: unknown,
    _request: express.Request,
    response: express.Response,
    next: express.NextFunction,
  ) => {
    void next;
    if (error instanceof ZodError) {
      response.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: error.flatten(),
      });
      return;
    }

    if (isAppError(error)) {
      response.status(error.statusCode).json({
        error: error.code,
        message: error.message,
        details: error.details ?? null,
      });
      return;
    }

    logger.error({ err: error }, 'Unhandled request error.');
    response.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    });
  });

  return app;
}
