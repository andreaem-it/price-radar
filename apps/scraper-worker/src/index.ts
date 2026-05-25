import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Worker } from 'bullmq';
import {
  createLogger,
  createQueues,
  ensureDataDirs,
  loadConfig,
  QUEUE_NAMES,
} from '@price-radar/shared';
import { getDatabase, runMigrations, seedRetailers } from '@price-radar/db';
import { processScrapeJob } from './processor.js';
import { closeBrowserPool } from '@price-radar/scraper-core';

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

async function main() {
  const config = loadConfig();
  const logger = createLogger('scraper-worker', config.logLevel);

  await ensureDataDirs(config);
  runMigrations(config.databasePath, migrationsFolder);
  await seedRetailers(config.databasePath);
  getDatabase(config.databasePath);

  const { scrapeQueue, aiQueue, connection } = createQueues(config);

  const worker = new Worker(
    QUEUE_NAMES.SCRAPE,
    async (job) => processScrapeJob(job, config, logger, aiQueue),
    {
      connection,
      concurrency: config.scrapeConcurrency,
    },
  );

  worker.on('completed', (job) => {
    logger.info('BullMQ job completed', { bullJobId: job.id, scrapeJobId: job.data.jobId });
  });

  worker.on('failed', (job, error) => {
    logger.error('BullMQ job failed', error, {
      bullJobId: job?.id,
      scrapeJobId: job?.data.jobId,
      attemptsMade: job?.attemptsMade,
    });
  });

  logger.info('Scraper worker started', { concurrency: config.scrapeConcurrency });

  const shutdown = async (signal: string) => {
    logger.info('Shutting down scraper worker', { signal });
    await worker.close();
    await scrapeQueue.close();
    await aiQueue.close();
    await closeBrowserPool();
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
