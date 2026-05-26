import { and, count, eq, inArray, lte } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { products, scrapeJobs } from '@price-radar/db';
import type { getDatabase } from '@price-radar/db';
import type { ScrapeQueueJobData } from '@price-radar/types';
import { enqueueScrapeJob } from './queues.js';

type Db = ReturnType<typeof getDatabase>['db'];

export interface QueueOverview {
  timestamp: string;
  database: {
    products: number;
    jobsByStatus: Record<string, number>;
    stuckQueued: number;
    stuckRunning: number;
  };
  redis: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
    paused: number;
  };
  drift: {
    sqliteQueuedOrRunning: number;
    redisInFlight: number;
    likelyStuck: boolean;
  };
}

export async function getQueueOverview(
  db: Db,
  scrapeQueue: Queue<ScrapeQueueJobData>,
): Promise<QueueOverview> {
  const [productRow] = await db.select({ total: count() }).from(products);
  const productsTotal = productRow?.total ?? 0;

  const statusRows = await db
    .select({ status: scrapeJobs.status, total: count() })
    .from(scrapeJobs)
    .groupBy(scrapeJobs.status);

  const jobsByStatus: Record<string, number> = {};
  for (const row of statusRows) {
    jobsByStatus[row.status] = row.total;
  }

  const bullCounts = await scrapeQueue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'failed',
    'completed',
    'paused',
  );

  const stuckQueued = jobsByStatus.queued ?? 0;
  const stuckRunning = jobsByStatus.running ?? 0;
  const redisInFlight = (bullCounts.waiting ?? 0) + (bullCounts.active ?? 0) + (bullCounts.delayed ?? 0);
  const sqliteQueuedOrRunning = stuckQueued + stuckRunning;

  return {
    timestamp: new Date().toISOString(),
    database: {
      products: productsTotal,
      jobsByStatus,
      stuckQueued,
      stuckRunning,
    },
    redis: {
      waiting: bullCounts.waiting ?? 0,
      active: bullCounts.active ?? 0,
      delayed: bullCounts.delayed ?? 0,
      failed: bullCounts.failed ?? 0,
      completed: bullCounts.completed ?? 0,
      paused: bullCounts.paused ?? 0,
    },
    drift: {
      sqliteQueuedOrRunning,
      redisInFlight,
      likelyStuck: sqliteQueuedOrRunning > 0 && redisInFlight === 0,
    },
  };
}

export interface UnblockQueueResult {
  resetCount: number;
  enqueuedCount: number;
  errors: string[];
}

export async function unblockScrapeQueue(
  db: Db,
  scrapeQueue: Queue<ScrapeQueueJobData>,
): Promise<UnblockQueueResult> {
  const now = new Date().toISOString();
  const errors: string[] = [];

  const reset = await db
    .update(scrapeJobs)
    .set({
      status: 'pending',
      updatedAt: now,
      error: null,
      startedAt: null,
      completedAt: null,
    })
    .where(inArray(scrapeJobs.status, ['queued', 'running']))
    .returning({ id: scrapeJobs.id });

  const dueJobs = await db.query.scrapeJobs.findMany({
    where: and(
      inArray(scrapeJobs.status, ['pending', 'failed', 'retrying']),
      lte(scrapeJobs.scheduledAt, now),
    ),
    limit: 200,
    with: {
      product: true,
      retailer: true,
    },
  });

  let enqueuedCount = 0;

  for (const job of dueJobs) {
    if (!job.retailer.enabled) {
      continue;
    }

    try {
      await db
        .update(scrapeJobs)
        .set({ status: 'queued', updatedAt: now })
        .where(eq(scrapeJobs.id, job.id));

      await enqueueScrapeJob(
        scrapeQueue,
        {
          jobId: job.id,
          productId: job.productId,
          retailerId: job.retailerId,
          retailerSlug: job.retailer.slug,
          url: job.product.url,
          externalId: job.product.externalId ?? undefined,
          asin: job.product.externalId ?? undefined,
          priority: job.priority,
        },
        {
          jobId: job.id,
          priority: job.priority,
        },
      );

      enqueuedCount += 1;
    } catch (error) {
      errors.push(
        `${job.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    resetCount: reset.length,
    enqueuedCount,
    errors,
  };
}
