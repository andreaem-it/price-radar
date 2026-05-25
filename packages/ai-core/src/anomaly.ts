import type { DetectAnomalyPayload, DetectAnomalyResult } from '@price-radar/types';
import type { OllamaClient } from './ollama.js';

interface AiAnomalyResponse {
  isAnomaly: boolean;
  deviationPercent: number;
  reasoning: string;
}

function heuristicAnomaly(payload: DetectAnomalyPayload): DetectAnomalyResult {
  const { previousPrice, currentPrice } = payload;
  if (previousPrice <= 0) {
    return { isAnomaly: false, deviationPercent: 0, reasoning: 'No valid previous price' };
  }

  const deviationPercent = Math.abs(((currentPrice - previousPrice) / previousPrice) * 100);
  const isAnomaly = deviationPercent >= 40;

  return {
    isAnomaly,
    deviationPercent,
    reasoning: isAnomaly
      ? `Price changed by ${deviationPercent.toFixed(1)}%`
      : 'Within normal threshold',
  };
}

export async function detectAnomaly(
  client: OllamaClient,
  payload: DetectAnomalyPayload,
): Promise<DetectAnomalyResult> {
  const heuristic = heuristicAnomaly(payload);

  const available = await client.isAvailable();
  if (!available) {
    return heuristic;
  }

  const historyText = payload.history.slice(-10).join(', ') || 'none';

  const prompt = `You are an anomaly detector for ecommerce prices.
Analyze if the current price is an anomaly compared to history.

Previous price: ${payload.previousPrice} ${payload.currency}
Current price: ${payload.currentPrice} ${payload.currency}
Recent history: [${historyText}]

Return JSON:
- isAnomaly: boolean
- deviationPercent: number
- reasoning: short explanation

Respond ONLY with JSON.`;

  try {
    const result = await client.generateJson<AiAnomalyResponse>(prompt);
    return {
      isAnomaly: result.isAnomaly,
      deviationPercent: result.deviationPercent ?? heuristic.deviationPercent,
      reasoning: result.reasoning,
    };
  } catch {
    return heuristic;
  }
}

export function computeDeviationPercent(previousPrice: number, currentPrice: number): number {
  if (previousPrice <= 0) return 0;
  return Math.abs(((currentPrice - previousPrice) / previousPrice) * 100);
}
