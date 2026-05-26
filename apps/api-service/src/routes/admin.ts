import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { scrapeJobs } from '@price-radar/db';
import {
  checkRedisConnection,
  getQueueOverview,
  unblockScrapeQueue,
} from '@price-radar/shared';

const adminDir = join(dirname(fileURLToPath(import.meta.url)), '../admin');

function assertAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  adminToken: string,
): reply is FastifyReply {
  if (!adminToken) {
    return true;
  }

  const header = request.headers.authorization;
  if (header === `Bearer ${adminToken}`) {
    return true;
  }

  void reply.status(401).send({ error: 'Unauthorized' });
  return false;
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  let adminHtml: string | null = null;

  async function loadAdminHtml(): Promise<string> {
    if (!adminHtml) {
      adminHtml = await readFile(join(adminDir, 'admin.html'), 'utf-8');
    }
    return adminHtml;
  }

  app.get('/', async (_request, reply) => {
    const html = await loadAdminHtml();
    return reply.type('text/html; charset=utf-8').send(html);
  });

  await app.register(async (api) => {
    api.addHook('preHandler', async (request, reply) => {
      if (!assertAdmin(request, reply, app.config.adminToken)) {
        return reply;
      }
    });

    api.get('/api/overview', async (_request, reply) => {
      const redis = await checkRedisConnection(app.config);
      const overview = await getQueueOverview(app.db, app.queues.scrapeQueue);

      return reply.send({
        health: {
          redis,
          database: true,
        },
        ...overview,
      });
    });

    api.get('/api/jobs', async (request, reply) => {
      const { status, limit = '50' } = request.query as { status?: string; limit?: string };
      const take = Math.min(Number.parseInt(limit, 10) || 50, 200);

      const jobs = await app.db.query.scrapeJobs.findMany({
        where: status ? eq(scrapeJobs.status, status) : undefined,
        orderBy: [desc(scrapeJobs.updatedAt)],
        limit: take,
        with: {
          product: true,
          retailer: true,
        },
      });

      return reply.send(jobs);
    });

    api.post('/api/queue/unblock', async (request, reply) => {
      app.logger.warn('Admin queue unblock requested', {
        requestId: request.id,
      });

      const result = await unblockScrapeQueue(app.db, app.queues.scrapeQueue);
      const overview = await getQueueOverview(app.db, app.queues.scrapeQueue);

      return reply.send({
        ok: result.errors.length === 0,
        result,
        overview,
      });
    });
  });
};
