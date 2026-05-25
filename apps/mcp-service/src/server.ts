import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import {
  createOllamaClient,
  detectAnomaly,
  matchProducts,
  repairSelector,
} from '@price-radar/ai-core';
import { getDatabase, productPrices, products } from '@price-radar/db';
import type { AppConfig } from '@price-radar/shared';
import type { Logger } from '@price-radar/shared';
import type { NormalizedProduct } from '@price-radar/types';

export function createMcpServer(config: AppConfig, logger: Logger): McpServer {
  const server = new McpServer({
    name: 'price-radar-mcp',
    version: '0.1.0',
  });

  const ollama = createOllamaClient(config.ollamaUrl, config.ollamaModel);
  const { db } = getDatabase(config.databasePath);

  server.tool(
    'getProductPrice',
    'Get the latest tracked price for a product by ID',
    {
      productId: z.string().describe('Internal product UUID'),
    },
    async ({ productId }) => {
      const product = await db.query.products.findFirst({
        where: eq(products.id, productId),
        with: { retailer: true },
      });

      if (!product) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Product not found' }) }],
          isError: true,
        };
      }

      const latestPrice = await db.query.productPrices.findFirst({
        where: eq(productPrices.productId, productId),
        orderBy: [desc(productPrices.scrapedAt)],
      });

      const payload = {
        productId: product.id,
        title: product.title,
        url: product.url,
        retailerSlug: product.retailer.slug,
        price: latestPrice?.price ?? null,
        currency: latestPrice?.currency ?? null,
        availability: latestPrice?.availability ?? null,
        scrapedAt: latestPrice?.scrapedAt ?? null,
      };

      logger.info('MCP getProductPrice', { productId });

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.tool(
    'matchProducts',
    'Match a source product against candidate products using local AI fallback',
    {
      sourceProduct: z.object({
        title: z.string(),
        normalizedTitle: z.string(),
        price: z.number(),
        currency: z.string(),
        url: z.string(),
        externalId: z.string(),
        sku: z.string().optional(),
        ean: z.string().optional(),
        availability: z.enum(['in_stock', 'out_of_stock', 'unknown']),
      }),
      candidates: z.array(
        z.object({
          title: z.string(),
          normalizedTitle: z.string(),
          price: z.number(),
          currency: z.string(),
          url: z.string(),
          externalId: z.string(),
          sku: z.string().optional(),
          ean: z.string().optional(),
          availability: z.enum(['in_stock', 'out_of_stock', 'unknown']),
        }),
      ),
    },
    async ({ sourceProduct, candidates }) => {
      const result = await matchProducts(ollama, {
        sourceProduct: sourceProduct as NormalizedProduct,
        candidates: candidates as NormalizedProduct[],
      });

      logger.info('MCP matchProducts', {
        matchedIndex: result.matchedIndex,
        confidence: result.confidence,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    'detectAnomaly',
    'Detect price anomalies using local AI with heuristic fallback',
    {
      productId: z.string(),
      previousPrice: z.number(),
      currentPrice: z.number(),
      currency: z.string().default('EUR'),
      history: z.array(z.number()).default([]),
    },
    async ({ productId, previousPrice, currentPrice, currency, history }) => {
      const result = await detectAnomaly(ollama, {
        productId,
        previousPrice,
        currentPrice,
        currency,
        history,
      });

      logger.info('MCP detectAnomaly', { productId, isAnomaly: result.isAnomaly });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    'repairSelector',
    'Suggest a repaired CSS selector for a failed scrape using local AI',
    {
      retailerSlug: z.string(),
      url: z.string().url(),
      failedSelector: z.string(),
      htmlSnippet: z.string(),
    },
    async ({ retailerSlug, url, failedSelector, htmlSnippet }) => {
      const result = await repairSelector(ollama, {
        retailerSlug,
        url,
        failedSelector,
        htmlSnippet,
      });

      logger.info('MCP repairSelector', { retailerSlug, url });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}

export async function startMcpServer(config: AppConfig, logger: Logger): Promise<void> {
  const server = createMcpServer(config, logger);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server connected via stdio');
}
