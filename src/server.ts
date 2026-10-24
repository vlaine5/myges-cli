import { configureSqlite, prisma } from './db/prisma';
import { applySqlMigrations } from './db/migrate';
import { env } from './config/env';
import { logger } from './lib/logger';
import { ensureDirectory } from './lib/fs';
import { createServices } from './services';
import { createApp } from './app';

async function bootstrap() {
  await ensureDirectory(env.dataDir);
  await applySqlMigrations();
  await prisma.$connect();
  await configureSqlite(prisma);

  const services = createServices(prisma);
  await services.settingsService.ensureDefaults();
  await services.syncService.markInterruptedJobsAsFailed();
  await services.schedulerService.start();

  const app = createApp(services);
  const server = app.listen(env.port, env.host, () => {
    logger.info(
      {
        host: env.host,
        port: env.port,
        baseUrl: env.appBaseUrl,
      },
      'myges-app started.',
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Stopping myges-app.');
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void bootstrap().catch(async (error) => {
  logger.error({ err: error }, 'Startup failed.');
  await prisma.$disconnect();
  process.exit(1);
});
