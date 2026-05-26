import { desc, eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { computeDeviationPercent } from '@price-radar/ai-core';
import {
  getDatabase,
  priceAnomalies,
  productPrices,
  products,
  scrapeJobs,
} from '@price-radar/db';
import type { AppConfig } from '@price-radar/shared';
import {
  ControlApiClient,
  createControlApiClient,
  isRemoteDbEnabled,
} from '@price-radar/shared';
import type { AiQueueJobData, ScrapeQueueJobData } from '@price-radar/types';
import type { Job } from 'bullmq';

type Db = ReturnType<typeof getDatabase>['db'];

export interface JobStore {
  markRunning(jobId: string, attempt: number, now: string): Promise<void>;
  markFailure(
    jobId: string,
    status: 'retrying' | 'failed',
    error: string,
    now: string,
  ): Promise<void>;
  markCompleted(jobId: string, now: string): Promise<void>;
  updateProductAfterScrape(
    productId: string,
    data: {
      title: string;
      normalizedTitle: string;
      externalId: string;
      now: string;
    },
  ): Promise<void>;
  savePriceHistory(
    productId: string,
    data: {
      price: number;
      currency: string;
      availability: string;
      title: string;
      externalId: string;
      url: string;
      now: string;
    },
  ): Promise<{ previousPrice: number | null }>;
  enqueueAnomalyIfNeeded(
    job: Job<ScrapeQueueJobData>,
    aiQueue: Queue<AiQueueJobData>,
    previousPrice: number,
    currentPrice: number,
    currency: string,
  ): Promise<void>;
}

class LocalJobStore implements JobStore {
  constructor(private readonly db: Db) {}

  async markRunning(jobId: string, attempt: number, now: string): Promise<void> {
    await this.db
      .update(scrapeJobs)
      .set({
        status: 'running',
        attempts: attempt,
        startedAt: now,
        updatedAt: now,
        error: null,
      })
      .where(eq(scrapeJobs.id, jobId));
  }

  async markFailure(
    jobId: string,
    status: 'retrying' | 'failed',
    error: string,
    now: string,
  ): Promise<void> {
    await this.db
      .update(scrapeJobs)
      .set({
        status,
        error,
        updatedAt: now,
        completedAt: status === 'failed' ? now : null,
      })
      .where(eq(scrapeJobs.id, jobId));
  }

  async markCompleted(jobId: string, now: string): Promise<void> {
    await this.db
      .update(scrapeJobs)
      .set({
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        error: null,
      })
      .where(eq(scrapeJobs.id, jobId));
  }

  async updateProductAfterScrape(
    productId: string,
    data: {
      title: string;
      normalizedTitle: string;
      externalId: string;
      now: string;
    },
  ): Promise<void> {
    await this.db
      .update(products)
      .set({
        title: data.title,
        normalizedTitle: data.normalizedTitle,
        externalId: data.externalId,
        updatedAt: data.now,
      })
      .where(eq(products.id, productId));
  }

  async savePriceHistory(
    productId: string,
    data: {
      price: number;
      currency: string;
      availability: string;
      title: string;
      externalId: string;
      url: string;
      now: string;
    },
  ): Promise<{ previousPrice: number | null }> {
    const previousPrice = await this.db.query.productPrices.findFirst({
      where: eq(productPrices.productId, productId),
      orderBy: [desc(productPrices.scrapedAt)],
    });

    await this.db.insert(productPrices).values({
      productId,
      price: data.price,
      currency: data.currency,
      availability: data.availability,
      rawData: {
        title: data.title,
        externalId: data.externalId,
        url: data.url,
      },
      scrapedAt: data.now,
    });

    return { previousPrice: previousPrice?.price ?? null };
  }

  async enqueueAnomalyIfNeeded(
    job: Job<ScrapeQueueJobData>,
    aiQueue: Queue<AiQueueJobData>,
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

    await this.db.insert(priceAnomalies).values({
      productId: job.data.productId,
      previousPrice,
      currentPrice,
      deviationPercent: deviation,
      currency,
      resolved: false,
    });
  }
}

class RemoteJobStore implements JobStore {
  constructor(private readonly client: ControlApiClient) {}

  async markRunning(jobId: string, attempt: number, now: string): Promise<void> {
    await this.client.updateScrapeJob(jobId, {
      status: 'running',
      attempts: attempt,
      startedAt: now,
      error: null,
    });
  }

  async markFailure(
    jobId: string,
    status: 'retrying' | 'failed',
    error: string,
    now: string,
  ): Promise<void> {
    await this.client.updateScrapeJob(jobId, {
      status,
      error,
      completedAt: status === 'failed' ? now : null,
    });
  }

  async markCompleted(jobId: string, now: string): Promise<void> {
    await this.client.updateScrapeJob(jobId, {
      status: 'completed',
      completedAt: now,
      error: null,
    });
  }

  async updateProductAfterScrape(
    productId: string,
    data: {
      title: string;
      normalizedTitle: string;
      externalId: string;
      now: string;
    },
  ): Promise<void> {
    await this.client.updateProduct(productId, {
      title: data.title,
      normalizedTitle: data.normalizedTitle,
      externalId: data.externalId,
    });
  }

  async savePriceHistory(): Promise<{ previousPrice: number | null }> {
    return { previousPrice: null };
  }

  async enqueueAnomalyIfNeeded(
    job: Job<ScrapeQueueJobData>,
    aiQueue: Queue<AiQueueJobData>,
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

    await this.client.createAnomaly({
      productId: job.data.productId,
      previousPrice,
      currentPrice,
      deviationPercent: deviation,
      currency,
    });
  }
}

export function createJobStore(config: AppConfig): JobStore {
  if (isRemoteDbEnabled(config)) {
    return new RemoteJobStore(createControlApiClient(config));
  }

  const { db } = getDatabase(config.databasePath);
  return new LocalJobStore(db);
}
