import type { FastifyPluginAsync } from 'fastify';
import { checkRedisConnection } from '@price-radar/shared';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    const redis = await checkRedisConnection(app.config);

    let database = false;
    try {
      await app.db.query.retailers.findFirst();
      database = true;
    } catch {
      database = false;
    }

    return {
      status: redis && database ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database,
        redis,
      },
    };
  });

  app.get('/live', async () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    const redis = await checkRedisConnection(app.config);
    if (!redis) {
      return reply.status(503).send({ status: 'not_ready', redis: false });
    }
    return { status: 'ready', redis: true };
  });
};
