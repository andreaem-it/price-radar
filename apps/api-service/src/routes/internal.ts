import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { priceAnomalies, products, scrapeJobs } from '@price-radar/db';

function assertInternal(
  request: FastifyRequest,
  reply: FastifyReply,
  internalApiKey: string,
): boolean {
  if (!internalApiKey) {
    return true;
  }

  const header = request.headers['x-internal-key'];
  if (header === internalApiKey) {
    return true;
  }

  void reply.status(401).send({ error: 'Unauthorized' });
  return false;
}

export const internalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request, reply) => {
    if (!assertInternal(request, reply, app.config.internalApiKey)) {
      return reply;
    }
  });

  app.patch('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      status?: string;
      attempts?: number;
      error?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
      updatedAt?: string;
    };

    const now = body.updatedAt ?? new Date().toISOString();

    const result = await app.db
      .update(scrapeJobs)
      .set({
        ...(body.status ? { status: body.status } : {}),
        ...(body.attempts !== undefined ? { attempts: body.attempts } : {}),
        ...(body.error !== undefined ? { error: body.error } : {}),
        ...(body.startedAt !== undefined ? { startedAt: body.startedAt } : {}),
        ...(body.completedAt !== undefined ? { completedAt: body.completedAt } : {}),
        updatedAt: now,
      })
      .where(eq(scrapeJobs.id, id))
      .returning({ id: scrapeJobs.id });

    if (result.length === 0) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return reply.send({ ok: true, id });
  });

  app.patch('/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      title?: string;
      normalizedTitle?: string;
      externalId?: string | null;
      updatedAt?: string;
    };

    const now = body.updatedAt ?? new Date().toISOString();

    const result = await app.db
      .update(products)
      .set({
        ...(body.title ? { title: body.title } : {}),
        ...(body.normalizedTitle ? { normalizedTitle: body.normalizedTitle } : {}),
        ...(body.externalId !== undefined ? { externalId: body.externalId } : {}),
        updatedAt: now,
      })
      .where(eq(products.id, id))
      .returning({ id: products.id });

    if (result.length === 0) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    return reply.send({ ok: true, id });
  });

  app.post('/anomalies', async (request, reply) => {
    const body = request.body as {
      productId: string;
      previousPrice: number;
      currentPrice: number;
      deviationPercent: number;
      currency: string;
    };

    const [inserted] = await app.db
      .insert(priceAnomalies)
      .values({
        productId: body.productId,
        previousPrice: body.previousPrice,
        currentPrice: body.currentPrice,
        deviationPercent: body.deviationPercent,
        currency: body.currency,
        resolved: false,
      })
      .returning({ id: priceAnomalies.id });

    return reply.status(201).send({ ok: true, id: inserted?.id });
  });
};
