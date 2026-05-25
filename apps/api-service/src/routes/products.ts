import type { FastifyPluginAsync } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { enqueueScrapeJob, normalizeTitle } from '@price-radar/shared';
import { productPrices, products, retailers, scrapeJobs } from '@price-radar/db';
import type { CreateProductRequest } from '@price-radar/types';

export const productRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreateProductRequest }>('/', async (request, reply) => {
    const body = request.body;

    const retailer = await app.db.query.retailers.findFirst({
      where: eq(retailers.slug, body.retailerSlug),
    });

    if (!retailer) {
      return reply.status(400).send({ error: `Unknown retailer: ${body.retailerSlug}` });
    }

    if (!retailer.enabled) {
      return reply.status(400).send({ error: `Retailer disabled: ${body.retailerSlug}` });
    }

    const normalizedTitle = normalizeTitle(body.title);
    const now = new Date().toISOString();

    const [product] = await app.db
      .insert(products)
      .values({
        retailerId: retailer.id,
        title: body.title,
        normalizedTitle,
        url: body.url,
        externalId: body.externalId ?? null,
        sku: body.sku ?? null,
        ean: body.ean ?? null,
        updatedAt: now,
      })
      .returning();

    if (!product) {
      return reply.status(500).send({ error: 'Failed to create product' });
    }

    const [job] = await app.db
      .insert(scrapeJobs)
      .values({
        productId: product.id,
        retailerId: retailer.id,
        status: 'queued',
        scheduledAt: now,
        updatedAt: now,
      })
      .returning();

    if (job) {
      await enqueueScrapeJob(
        app.queues.scrapeQueue,
        {
          jobId: job.id,
          productId: product.id,
          retailerId: retailer.id,
          retailerSlug: retailer.slug,
          url: product.url,
          externalId: product.externalId ?? undefined,
        },
        { jobId: job.id },
      );
    }

    return reply.status(201).send({
      id: product.id,
      title: product.title,
      normalizedTitle: product.normalizedTitle,
      url: product.url,
      externalId: product.externalId,
      sku: product.sku,
      ean: product.ean,
      retailerId: product.retailerId,
      retailerSlug: retailer.slug,
      currentPrice: null,
      currency: null,
      lastScrapedAt: null,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    });
  });

  app.get('/:id/price', async (request, reply) => {
    const { id } = request.params as { id: string };

    const product = await app.db.query.products.findFirst({
      where: eq(products.id, id),
      with: { retailer: true },
    });

    if (!product) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    const latestPrice = await app.db.query.productPrices.findFirst({
      where: eq(productPrices.productId, id),
      orderBy: [desc(productPrices.scrapedAt)],
    });

    return reply.send({
      productId: product.id,
      title: product.title,
      url: product.url,
      retailerSlug: product.retailer.slug,
      price: latestPrice?.price ?? null,
      currency: latestPrice?.currency ?? null,
      availability: latestPrice?.availability ?? null,
      scrapedAt: latestPrice?.scrapedAt ?? null,
    });
  });

  app.get('/', async (_request, reply) => {
    const list = await app.db.query.products.findMany({
      with: { retailer: true },
      orderBy: [desc(products.updatedAt)],
      limit: 100,
    });

    const enriched = await Promise.all(
      list.map(async (product) => {
        const latestPrice = await app.db.query.productPrices.findFirst({
          where: eq(productPrices.productId, product.id),
          orderBy: [desc(productPrices.scrapedAt)],
        });

        return {
          id: product.id,
          title: product.title,
          normalizedTitle: product.normalizedTitle,
          url: product.url,
          externalId: product.externalId,
          sku: product.sku,
          ean: product.ean,
          retailerId: product.retailerId,
          retailerSlug: product.retailer.slug,
          currentPrice: latestPrice?.price ?? null,
          currency: latestPrice?.currency ?? null,
          lastScrapedAt: latestPrice?.scrapedAt ?? null,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
        };
      }),
    );

    return reply.send(enriched);
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const product = await app.db.query.products.findFirst({
      where: eq(products.id, id),
      with: { retailer: true },
    });

    if (!product) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    const prices = await app.db.query.productPrices.findMany({
      where: eq(productPrices.productId, id),
      orderBy: [desc(productPrices.scrapedAt)],
      limit: 50,
    });

    return reply.send({
      ...product,
      retailerSlug: product.retailer.slug,
      prices,
    });
  });
};
