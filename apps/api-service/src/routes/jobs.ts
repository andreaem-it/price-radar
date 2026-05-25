import type { FastifyPluginAsync } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { scrapeJobs } from '@price-radar/db';

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (request, reply) => {
    const { status, limit = '50' } = request.query as { status?: string; limit?: string };
    const take = Math.min(Number.parseInt(limit, 10) || 50, 200);

    const jobs = await app.db.query.scrapeJobs.findMany({
      where: status ? eq(scrapeJobs.status, status) : undefined,
      orderBy: [desc(scrapeJobs.createdAt)],
      limit: take,
      with: {
        product: true,
        retailer: true,
      },
    });

    return reply.send(jobs);
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const job = await app.db.query.scrapeJobs.findFirst({
      where: eq(scrapeJobs.id, id),
      with: {
        product: true,
        retailer: true,
      },
    });

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return reply.send(job);
  });
};
