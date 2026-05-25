import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createLogger,
  createQueues,
  ensureDataDirs,
  loadConfig,
} from '@price-radar/shared';
import { getDatabase, runMigrations, seedRetailers } from '@price-radar/db';
import { ScrapeScheduler } from './scheduler.js';

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

async function main() {
  const config = loadConfig();
  const logger = createLogger('scheduler-service', config.logLevel);

  await ensureDataDirs(config);
  runMigrations(config.databasePath, migrationsFolder);
  await seedRetailers(config.databasePath);
  getDatabase(config.databasePath);

  const { scrapeQueue, connection } = createQueues(config);
  const scheduler = new ScrapeScheduler(config, logger, scrapeQueue);

  scheduler.start();

  const shutdown = async (signal: string) => {
    logger.info('Shutting down scheduler', { signal });
    scheduler.stop();
    await scrapeQueue.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
