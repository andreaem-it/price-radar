import type { Job } from 'bullmq';
import type { Queue } from 'bullmq';
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
import { createJobStore } from './job-store.js';

const registry = createDefaultRegistry();

export async function processScrapeJob(
  job: Job<ScrapeQueueJobData>,
  config: AppConfig,
  logger: Logger,
  aiQueue: Queue<AiQueueJobData>,
): Promise<void> {
  const store = createJobStore(config);
  const now = new Date().toISOString();
  const attempt = job.attemptsMade + 1;
  const useTjApi = isTjApiConfigured(config);

  const childLogger = logger.child({
    jobId: job.data.jobId,
    retailerSlug: job.data.retailerSlug,
    productId: job.data.productId,
  });

  await store.markRunning(job.data.jobId, attempt, now);

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
    const status =
      result.isAntiBot ? 'retrying' : attempt >= config.scrapeMaxAttempts ? 'failed' : 'retrying';

    await store.markFailure(job.data.jobId, status, result.error ?? 'Unknown scrape error', now);

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

      await store.markFailure(
        job.data.jobId,
        attempt >= config.scrapeMaxAttempts ? 'failed' : 'retrying',
        message,
        now,
      );

      throw new Error(message);
    }
  } else {
    const { previousPrice } = await store.savePriceHistory(job.data.productId, {
      price: product.price,
      currency: product.currency,
      availability: product.availability,
      title: product.title,
      externalId: product.externalId,
      url: product.url,
      now,
    });

    if (previousPrice != null) {
      await store.enqueueAnomalyIfNeeded(
        job,
        aiQueue,
        previousPrice,
        product.price,
        product.currency,
      );
    }
  }

  await store.updateProductAfterScrape(job.data.productId, {
    title: product.title,
    normalizedTitle: product.normalizedTitle,
    externalId: asin ?? product.externalId,
    now,
  });

  await store.markCompleted(job.data.jobId, now);

  childLogger.info('Scrape job completed', {
    price: product.price,
    currency: product.currency,
    tjApi: useTjApi,
  });

  if (useTjApi && job.data.previousPrice != null && job.data.previousPrice > 0) {
    await store.enqueueAnomalyIfNeeded(
      job,
      aiQueue,
      job.data.previousPrice,
      product.price,
      product.currency,
    );
  }
}

export { QUEUE_NAMES, registry };
