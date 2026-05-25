import { desc, eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { computeDeviationPercent } from '@price-radar/ai-core';
import {
  getDatabase,
  priceAnomalies,
  productPrices,
  products,
  scrapeJobs,
} from '@price-radar/db';
import { createDefaultRegistry, runExtractJob } from '@price-radar/scraper-core';
import type { AppConfig } from '@price-radar/shared';
import type { Logger } from '@price-radar/shared';
import { QUEUE_NAMES } from '@price-radar/shared';
import type { AiQueueJobData, ScrapeQueueJobData } from '@price-radar/types';
import type { Queue } from 'bullmq';

const registry = createDefaultRegistry();

export async function processScrapeJob(
  job: Job<ScrapeQueueJobData>,
  config: AppConfig,
  logger: Logger,
  aiQueue: Queue<AiQueueJobData>,
): Promise<void> {
  const { db } = getDatabase(config.databasePath);
  const now = new Date().toISOString();
  const attempt = job.attemptsMade + 1;

  const childLogger = logger.child({
    jobId: job.data.jobId,
    retailerSlug: job.data.retailerSlug,
    productId: job.data.productId,
  });

  await db
    .update(scrapeJobs)
    .set({
      status: 'running',
      attempts: attempt,
      startedAt: now,
      updatedAt: now,
      error: null,
    })
    .where(eq(scrapeJobs.id, job.data.jobId));

  childLogger.info('Processing scrape job', { attempt, url: job.data.url });

  const result = await runExtractJob(registry, config, childLogger, {
    retailerSlug: job.data.retailerSlug,
    jobId: job.data.jobId,
    attempt,
    extractParams: {
      url: job.data.url,
      externalId: job.data.externalId,
    },
  });

  if (!result.success || !result.product) {
    const status = result.isAntiBot ? 'retrying' : attempt >= config.scrapeMaxAttempts ? 'failed' : 'retrying';

    await db
      .update(scrapeJobs)
      .set({
        status,
        error: result.error ?? 'Unknown scrape error',
        updatedAt: new Date().toISOString(),
        completedAt: status === 'failed' ? new Date().toISOString() : null,
      })
      .where(eq(scrapeJobs.id, job.data.jobId));

    if (result.isAntiBot) {
      childLogger.antiBotDetected(job.data.jobId, job.data.retailerSlug, job.data.url);
    }

    childLogger.scrapeRetry(job.data.jobId, attempt, result.error ?? 'scrape failed');

    throw new Error(result.error ?? 'Scrape failed');
  }

  const product = result.product;

  const previousPrice = await db.query.productPrices.findFirst({
    where: eq(productPrices.productId, job.data.productId),
    orderBy: [desc(productPrices.scrapedAt)],
  });

  await db.insert(productPrices).values({
    productId: job.data.productId,
    price: product.price,
    currency: product.currency,
    availability: product.availability,
    rawData: {
      title: product.title,
      externalId: product.externalId,
      url: product.url,
    },
    scrapedAt: now,
  });

  await db
    .update(products)
    .set({
      title: product.title,
      normalizedTitle: product.normalizedTitle,
      externalId: product.externalId,
      updatedAt: now,
    })
    .where(eq(products.id, job.data.productId));

  await db
    .update(scrapeJobs)
    .set({
      status: 'completed',
      completedAt: now,
      updatedAt: now,
      error: null,
    })
    .where(eq(scrapeJobs.id, job.data.jobId));

  childLogger.info('Scrape job completed', {
    price: product.price,
    currency: product.currency,
  });

  if (previousPrice) {
    const deviation = computeDeviationPercent(previousPrice.price, product.price);

    if (deviation >= 40) {
      await aiQueue.add(
        'detect-anomaly',
        {
          jobId: crypto.randomUUID(),
          type: 'detect_anomaly',
          payload: {
            productId: job.data.productId,
            previousPrice: previousPrice.price,
            currentPrice: product.price,
            currency: product.currency,
            history: [previousPrice.price, product.price],
          },
        },
        { jobId: `anomaly-${job.data.productId}-${Date.now()}` },
      );

      await db.insert(priceAnomalies).values({
        productId: job.data.productId,
        previousPrice: previousPrice.price,
        currentPrice: product.price,
        deviationPercent: deviation,
        currency: product.currency,
        resolved: false,
      });
    }
  }
}

export { QUEUE_NAMES, registry };
