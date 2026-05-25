import { Queue, type JobsOptions } from 'bullmq';
import type { AiQueueJobData, ScrapeQueueJobData } from '@price-radar/types';
import type { AppConfig } from './config.js';
import { QUEUE_NAMES } from './config.js';
import { createRedisConnection } from './redis.js';

export interface QueueBundle {
  scrapeQueue: Queue<ScrapeQueueJobData>;
  aiQueue: Queue<AiQueueJobData>;
  connection: ReturnType<typeof createRedisConnection>;
}

export async function enqueueScrapeJob(
  queue: Queue<ScrapeQueueJobData>,
  data: ScrapeQueueJobData,
  options: JobsOptions = {},
): Promise<void> {
  const jobId = options.jobId ?? data.jobId;

  if (jobId) {
    const existing = await queue.getJob(String(jobId));
    if (existing) {
      await existing.remove().catch(() => undefined);
    }
  }

  await queue.add('scrape-product', data, {
    ...options,
    jobId,
  });
}

export function createQueues(config: AppConfig): QueueBundle {
  const connection = createRedisConnection(config);

  const scrapeQueue = new Queue<ScrapeQueueJobData>(QUEUE_NAMES.SCRAPE, {
    connection,
    defaultJobOptions: {
      attempts: config.scrapeMaxAttempts,
      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
      removeOnComplete: 500,
      removeOnFail: 1000,
    },
  });

  const aiQueue = new Queue<AiQueueJobData>(QUEUE_NAMES.AI, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 3_000,
      },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });

  return { scrapeQueue, aiQueue, connection };
}

export async function closeQueues(bundle: QueueBundle): Promise<void> {
  await Promise.all([bundle.scrapeQueue.close(), bundle.aiQueue.close(), bundle.connection.quit()]);
}
