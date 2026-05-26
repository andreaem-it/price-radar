import { desc, eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import type { Queue } from 'bullmq';
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
import { normalizeImageUrl } from '@price-radar/shared';
import { QUEUE_NAMES } from '@price-radar/shared';
import {
  TjApiError,
  createTjApiClientFromAppConfig,
  isTjApiConfigured,
  normalizeAsin,
} from '@price-radar/tj-api-client';
import type { AiQueueJobData, ScrapeQueueJobData } from '@price-radar/types';

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
  const useTjApi = isTjApiConfigured(config);

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
      externalId: job.data.externalId ?? job.data.asin,
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
  const asin = normalizeAsin(job.data.asin ?? product.externalId);

  if (useTjApi) {
    if (!asin) {
      throw new Error(`Invalid ASIN for tj-api push: ${product.externalId}`);
    }

    const client = createTjApiClientFromAppConfig(config);

    try {
      const pushResult = await client.pushPrices([
        {
          asin,
          url: product.url,
          price: product.price,
          title: product.title,
          currency: product.currency,
          availability: product.availability,
          source: job.data.source ?? config.tjApiSource,
          image_url:
            normalizeImageUrl(product.imageUrl) ??
            normalizeImageUrl(job.data.imageUrl) ??
            null,
          brand: product.brand ?? job.data.brand ?? null,
          category: product.category ?? job.data.category ?? null,
          detected_at: now,
        },
      ]);

      childLogger.info('Pushed price to tj-api', {
        asin,
        processed: pushResult.processed,
        updated: pushResult.updated,
        created: pushResult.created,
        imageUrl:
          normalizeImageUrl(product.imageUrl) ??
          normalizeImageUrl(job.data.imageUrl) ??
          null,
        brand: product.brand ?? job.data.brand ?? null,
        category: product.category ?? job.data.category ?? null,
      });
    } catch (error) {
      const message =
        error instanceof TjApiError
          ? `tj-api push failed (${error.status}): ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);

      await db
        .update(scrapeJobs)
        .set({
          status: attempt >= config.scrapeMaxAttempts ? 'failed' : 'retrying',
          error: message,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(scrapeJobs.id, job.data.jobId));

      throw new Error(message);
    }
  } else {
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

    if (previousPrice) {
      await enqueueAnomalyIfNeeded(
        job,
        aiQueue,
        db,
        previousPrice.price,
        product.price,
        product.currency,
      );
    }
  }

  await db
    .update(products)
    .set({
      title: product.title,
      normalizedTitle: product.normalizedTitle,
      externalId: asin ?? product.externalId,
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
    tjApi: useTjApi,
  });

  if (useTjApi && job.data.previousPrice != null && job.data.previousPrice > 0) {
    await enqueueAnomalyIfNeeded(
      job,
      aiQueue,
      db,
      job.data.previousPrice,
      product.price,
      product.currency,
    );
  }
}

async function enqueueAnomalyIfNeeded(
  job: Job<ScrapeQueueJobData>,
  aiQueue: Queue<AiQueueJobData>,
  db: ReturnType<typeof getDatabase>['db'],
  previousPrice: number,
  currentPrice: number,
  currency: string,
): Promise<void> {
  const deviation = computeDeviationPercent(previousPrice, currentPrice);

  if (deviation < 40) return;

  await aiQueue.add(
    'detect-anomaly',
    {
      jobId: crypto.randomUUID(),
      type: 'detect_anomaly',
      payload: {
        productId: job.data.productId,
        previousPrice,
        currentPrice,
        currency,
        history: [previousPrice, currentPrice],
      },
    },
    { jobId: `anomaly-${job.data.productId}-${Date.now()}` },
  );

  await db.insert(priceAnomalies).values({
    productId: job.data.productId,
    previousPrice,
    currentPrice,
    deviationPercent: deviation,
    currency,
    resolved: false,
  });
}

export { QUEUE_NAMES, registry };
