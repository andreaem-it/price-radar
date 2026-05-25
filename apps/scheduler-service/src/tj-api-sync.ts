import { and, eq, inArray } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { getDatabase, products, retailers, scrapeJobs } from '@price-radar/db';
import { normalizeTitle, type AppConfig, type Logger } from '@price-radar/shared';
import {
  createTjApiClientFromAppConfig,
  isTjApiConfigured,
  normalizeAsin,
} from '@price-radar/tj-api-client';
import type { ScrapeQueueJobData } from '@price-radar/types';

export async function syncProductsFromTjApi(
  config: AppConfig,
  logger: Logger,
  scrapeQueue: Queue<ScrapeQueueJobData>,
): Promise<void> {
  if (!isTjApiConfigured(config)) {
    return;
  }

  const client = createTjApiClientFromAppConfig(config);
  const { db } = getDatabase(config.databasePath);
  const now = new Date().toISOString();

  const amazonRetailer = await db.query.retailers.findFirst({
    where: eq(retailers.slug, 'amazon'),
  });

  if (!amazonRetailer?.enabled) {
    logger.warn('Amazon retailer disabled — skip tj-api sync');
    return;
  }

  let remoteProducts;
  try {
    remoteProducts = await client.fetchAmazonProductsToMonitor();
  } catch (error) {
    logger.error('Failed to fetch products from tj-api', error);
    return;
  }

  if (remoteProducts.length === 0) {
    logger.info('No Amazon products returned from tj-api');
    return;
  }

  logger.info('Syncing scrape jobs from tj-api', { count: remoteProducts.length });

  for (const remote of remoteProducts) {
    const asin = normalizeAsin(remote.asin);
    if (!asin || !remote.url) continue;

    let localProduct = await db.query.products.findFirst({
      where: and(eq(products.externalId, asin), eq(products.retailerId, amazonRetailer.id)),
    });

    const title = remote.title?.trim() || `Amazon ${asin}`;

    if (!localProduct) {
      const [inserted] = await db
        .insert(products)
        .values({
          retailerId: amazonRetailer.id,
          title,
          normalizedTitle: normalizeTitle(title),
          url: remote.url,
          externalId: asin,
          updatedAt: now,
        })
        .returning();

      localProduct = inserted;
    } else {
      await db
        .update(products)
        .set({
          title,
          normalizedTitle: normalizeTitle(title),
          url: remote.url,
          updatedAt: now,
        })
        .where(eq(products.id, localProduct.id));
    }

    if (!localProduct) continue;

    const activeJob = await db.query.scrapeJobs.findFirst({
      where: and(
        eq(scrapeJobs.productId, localProduct.id),
        inArray(scrapeJobs.status, ['pending', 'queued', 'running', 'retrying']),
      ),
    });

    if (activeJob) continue;

    const [newJob] = await db
      .insert(scrapeJobs)
      .values({
        productId: localProduct.id,
        retailerId: amazonRetailer.id,
        status: 'queued',
        scheduledAt: now,
        updatedAt: now,
        metadata: {
          tjProductId: remote.id,
          asin,
          source: remote.source,
        },
      })
      .returning();

    if (!newJob) continue;

    await scrapeQueue.add(
      'scrape-product',
      {
        jobId: newJob.id,
        productId: localProduct.id,
        retailerId: amazonRetailer.id,
        retailerSlug: amazonRetailer.slug,
        url: remote.url,
        externalId: asin,
        asin,
        source: remote.source,
        previousPrice: remote.current_price,
        brand: remote.brand ?? null,
        category: remote.category ?? null,
        imageUrl: remote.image_url,
      },
      { jobId: newJob.id },
    );
  }
}
