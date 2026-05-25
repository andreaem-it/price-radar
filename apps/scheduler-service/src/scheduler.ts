import { and, eq, inArray, lte } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { getDatabase, products, retailers, scrapeJobs } from '@price-radar/db';
import type { AppConfig } from '@price-radar/shared';
import type { Logger } from '@price-radar/shared';
import { isTjApiConfigured } from '@price-radar/tj-api-client';
import type { ScrapeQueueJobData } from '@price-radar/types';
import { syncProductsFromTjApi } from './tj-api-sync.js';

export class ScrapeScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly scrapeQueue: Queue<ScrapeQueueJobData>,
  ) {}

  start(): void {
    if (this.timer) return;

    this.logger.info('Scheduler started', {
      intervalMs: this.config.schedulerIntervalMs,
      tjApi: isTjApiConfigured(this.config) ? this.config.tjApiBaseUrl : false,
    });
    void this.tick();

    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.schedulerIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    const { db } = getDatabase(this.config.databasePath);
    const now = new Date().toISOString();

    const dueJobs = await db.query.scrapeJobs.findMany({
      where: and(
        inArray(scrapeJobs.status, ['pending', 'failed']),
        lte(scrapeJobs.scheduledAt, now),
      ),
      limit: 100,
      with: {
        product: true,
        retailer: true,
      },
    });

    if (dueJobs.length === 0) {
      this.logger.debug('No due scrape jobs');
      return;
    }

    this.logger.info('Enqueueing due scrape jobs', { count: dueJobs.length });

    for (const job of dueJobs) {
      if (!job.retailer.enabled) {
        continue;
      }

      await db
        .update(scrapeJobs)
        .set({ status: 'queued', updatedAt: now })
        .where(eq(scrapeJobs.id, job.id));

      await this.scrapeQueue.add(
        'scrape-product',
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
    }

    await this.schedulePeriodicRescrape(db, now);
    await syncProductsFromTjApi(this.config, this.logger, this.scrapeQueue);
  }

  private async schedulePeriodicRescrape(
    db: ReturnType<typeof getDatabase>['db'],
    now: string,
  ): Promise<void> {
    if (isTjApiConfigured(this.config)) {
      return;
    }
    const enabledRetailers = await db.query.retailers.findMany({
      where: eq(retailers.enabled, true),
    });

    if (enabledRetailers.length === 0) return;

    const allProducts = await db.query.products.findMany({
      where: inArray(
        products.retailerId,
        enabledRetailers.map((r) => r.id),
      ),
      limit: 50,
    });

    for (const product of allProducts) {
      const activeJob = await db.query.scrapeJobs.findFirst({
        where: and(
          eq(scrapeJobs.productId, product.id),
          inArray(scrapeJobs.status, ['pending', 'queued', 'running', 'retrying']),
        ),
      });

      if (activeJob) continue;

      const retailer = enabledRetailers.find((r) => r.id === product.retailerId);
      if (!retailer) continue;

      const [newJob] = await db
        .insert(scrapeJobs)
        .values({
          productId: product.id,
          retailerId: product.retailerId,
          status: 'queued',
          scheduledAt: now,
          updatedAt: now,
        })
        .returning();

      if (!newJob) continue;

      await this.scrapeQueue.add(
        'scrape-product',
        {
          jobId: newJob.id,
          productId: product.id,
          retailerId: product.retailerId,
          retailerSlug: retailer.slug,
          url: product.url,
          externalId: product.externalId ?? undefined,
        },
        { jobId: newJob.id },
      );
    }
  }
}
