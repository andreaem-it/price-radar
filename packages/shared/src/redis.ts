import { Redis } from 'ioredis';
import type { AppConfig } from './config.js';

let redisClient: Redis | null = null;

export function createRedisConnection(config: AppConfig): Redis {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  client.on('error', (error) => {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Redis connection error',
        timestamp: new Date().toISOString(),
        error: error.message,
      }),
    );
  });

  return client;
}

export function getRedisClient(config: AppConfig): Redis {
  if (!redisClient) {
    redisClient = createRedisConnection(config);
  }
  return redisClient;
}

export async function checkRedisConnection(config: AppConfig): Promise<boolean> {
  try {
    const client = getRedisClient(config);
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
