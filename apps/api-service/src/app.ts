import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  checkRedisConnection,
  createLogger,
  createQueues,
  loadConfig,
} from '@price-radar/shared';
import { eq } from 'drizzle-orm';
import { getDatabase, runMigrations, schema, seedRetailers } from '@price-radar/db';
import { healthRoutes } from './routes/health.js';
import { productRoutes } from './routes/products.js';
import { jobRoutes } from './routes/jobs.js';

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

export async function buildApp() {
  const config = loadConfig();
  const logger = createLogger('api-service', config.logLevel);

  runMigrations(config.databasePath, migrationsFolder);
  await seedRetailers(config.databasePath);

  const { db } = getDatabase(config.databasePath);
  const queues = createQueues(config);

  const app = Fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(cors, { origin: true });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('queues', queues);
  app.decorate('logger', logger);

  app.addHook('onRequest', async (request) => {
    logger.info('Incoming request', {
      method: request.method,
      url: request.url,
      requestId: request.id,
    });
  });

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(productRoutes, { prefix: '/api/products' });
  await app.register(jobRoutes, { prefix: '/api/jobs' });

  app.get('/api/retailers', async (_request, reply) => {
    const list = await db.query.retailers.findMany({
      where: eq(schema.retailers.enabled, true),
    });
    return reply.send(list);
  });

  app.setErrorHandler((error, request, reply) => {
    logger.error('Unhandled API error', error, { requestId: request.id });
    reply.status(500).send({ error: 'Internal server error' });
  });

  app.addHook('onClose', async () => {
    await queues.scrapeQueue.close();
    await queues.aiQueue.close();
    await queues.connection.quit();
  });

  const redisOk = await checkRedisConnection(config);
  if (!redisOk) {
    logger.warn('Redis is not reachable at startup');
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: ReturnType<typeof loadConfig>;
    db: ReturnType<typeof getDatabase>['db'];
    queues: ReturnType<typeof createQueues>;
    logger: ReturnType<typeof createLogger>;
  }
}
