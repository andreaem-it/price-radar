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
import { getDatabase, runMigrations } from '@price-radar/db';
import { processAiJob } from './processor.js';

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

async function main() {
  const config = loadConfig();
  const logger = createLogger('ai-worker', config.logLevel);

  await ensureDataDirs(config);
  runMigrations(config.databasePath, migrationsFolder);
  getDatabase(config.databasePath);

  const { aiQueue, connection } = createQueues(config);

  const worker = new Worker(
    QUEUE_NAMES.AI,
    async (job) => processAiJob(job, config, logger),
    {
      connection,
      concurrency: config.aiConcurrency,
    },
  );

  worker.on('completed', (job) => {
    logger.info('AI job completed', { bullJobId: job.id, type: job.data.type });
  });

  worker.on('failed', (job, error) => {
    logger.error('AI job failed', error, {
      bullJobId: job?.id,
      type: job?.data.type,
    });
  });

  logger.info('AI worker started', { concurrency: config.aiConcurrency });

  const shutdown = async (signal: string) => {
    logger.info('Shutting down AI worker', { signal });
    await worker.close();
    await aiQueue.close();
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
