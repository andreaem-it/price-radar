import type { RepairSelectorPayload, RepairSelectorResult } from '@price-radar/types';
import type { OllamaClient } from './ollama.js';

interface AiRepairResponse {
  suggestedSelector: string;
  confidence: number;
  reasoning: string;
}

export async function repairSelector(
  client: OllamaClient,
  payload: RepairSelectorPayload,
): Promise<RepairSelectorResult> {
  const available = await client.isAvailable();
  if (!available) {
    return {
      suggestedSelector: payload.failedSelector,
      confidence: 0,
      reasoning: 'Ollama unavailable, returning original selector',
    };
  }

  const snippet = payload.htmlSnippet.slice(0, 4000);

  const prompt = `You are a CSS selector repair assistant for web scraping.
A selector failed on ${payload.retailerSlug} at ${payload.url}.

Failed selector: ${payload.failedSelector}

HTML snippet:
${snippet}

Return JSON:
- suggestedSelector: improved CSS selector
- confidence: 0-1
- reasoning: short explanation

Respond ONLY with JSON.`;

  try {
    const result = await client.generateJson<AiRepairResponse>(prompt);
    return {
      suggestedSelector: result.suggestedSelector || payload.failedSelector,
      confidence: Math.min(Math.max(result.confidence, 0), 1),
      reasoning: result.reasoning,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      suggestedSelector: payload.failedSelector,
      confidence: 0,
      reasoning: `Repair failed: ${message}`,
    };
  }
}
