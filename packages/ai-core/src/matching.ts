import type { MatchProductsPayload, MatchProductsResult, NormalizedProduct } from '@price-radar/types';
import type { OllamaClient } from './ollama.js';

interface AiMatchResponse {
  matchedIndex: number | null;
  confidence: number;
  reasoning: string;
}

function heuristicMatch(
  source: NormalizedProduct,
  candidates: NormalizedProduct[],
): MatchProductsResult {
  const sourceTokens = new Set(source.normalizedTitle.split(' ').filter(Boolean));
  let bestIndex: number | null = null;
  let bestScore = 0;

  candidates.forEach((candidate, index) => {
    const tokens = candidate.normalizedTitle.split(' ').filter(Boolean);
    const overlap = tokens.filter((token) => sourceTokens.has(token)).length;
    const score = overlap / Math.max(tokens.length, sourceTokens.size, 1);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return {
    matchedIndex: bestScore >= 0.5 ? bestIndex : null,
    confidence: bestScore,
    reasoning: 'Heuristic token overlap match',
  };
}

export async function matchProducts(
  client: OllamaClient,
  payload: MatchProductsPayload,
): Promise<MatchProductsResult> {
  if (payload.candidates.length === 0) {
    return { matchedIndex: null, confidence: 0, reasoning: 'No candidates provided' };
  }

  const available = await client.isAvailable();
  if (!available) {
    return heuristicMatch(payload.sourceProduct, payload.candidates);
  }

  const candidatesText = payload.candidates
    .map(
      (c, i) =>
        `[${i}] title="${c.title}" price=${c.price} ${c.currency} ean=${c.ean ?? 'n/a'} sku=${c.sku ?? 'n/a'}`,
    )
    .join('\n');

  const prompt = `You are a product matching engine for ecommerce price monitoring.
Given a source product and candidate products, return JSON with:
- matchedIndex: index of best match or null
- confidence: 0-1
- reasoning: short explanation

Source: title="${payload.sourceProduct.title}" ean=${payload.sourceProduct.ean ?? 'n/a'} sku=${payload.sourceProduct.sku ?? 'n/a'}

Candidates:
${candidatesText}

Respond ONLY with JSON.`;

  try {
    const result = await client.generateJson<AiMatchResponse>(prompt);
    return {
      matchedIndex: result.matchedIndex,
      confidence: Math.min(Math.max(result.confidence, 0), 1),
      reasoning: result.reasoning,
    };
  } catch {
    return heuristicMatch(payload.sourceProduct, payload.candidates);
  }
}
