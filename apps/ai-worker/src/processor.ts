import { eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import {
  createOllamaClient,
  detectAnomaly,
  matchProducts,
  repairSelector,
} from '@price-radar/ai-core';
import { getDatabase, priceAnomalies } from '@price-radar/db';
import type { AppConfig } from '@price-radar/shared';
import type { Logger } from '@price-radar/shared';
import type {
  AiQueueJobData,
  DetectAnomalyPayload,
  MatchProductsPayload,
  RepairSelectorPayload,
} from '@price-radar/types';

export async function processAiJob(
  job: Job<AiQueueJobData>,
  config: AppConfig,
  logger: Logger,
): Promise<unknown> {
  const client = createOllamaClient(config.ollamaUrl, config.ollamaModel);
  const childLogger = logger.child({ jobId: job.data.jobId });

  childLogger.info('Processing AI job', { type: job.data.type });

  switch (job.data.type) {
    case 'match_products':
      return matchProducts(client, job.data.payload as MatchProductsPayload);

    case 'detect_anomaly': {
      const payload = job.data.payload as DetectAnomalyPayload;
      const result = await detectAnomaly(client, payload);

      if (result.isAnomaly) {
        const { db } = getDatabase(config.databasePath);
        await db
          .update(priceAnomalies)
          .set({ aiAnalysis: result.reasoning })
          .where(eq(priceAnomalies.productId, payload.productId));
      }

      return result;
    }

    case 'repair_selector':
      return repairSelector(client, job.data.payload as RepairSelectorPayload);

    default:
      throw new Error(`Unknown AI job type: ${job.data.type}`);
  }
}
