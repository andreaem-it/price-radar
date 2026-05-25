import type { Logger } from '@price-radar/shared';
import { detectAntiBot, normalizeTitle, saveFailureArtifacts } from '@price-radar/shared';
import type { AppConfig } from '@price-radar/shared';
import type { NormalizedProduct, ScrapeContext, ScrapeExtractParams } from '@price-radar/types';
import { withBrowserSession } from './browser-session.js';
import type { ScraperRegistry } from './registry.js';
import { safePageContent, safeScreenshot } from './utils.js';

export interface ScrapeRunResult {
  success: boolean;
  product?: NormalizedProduct;
  rawHtml?: string;
  error?: string;
  isAntiBot?: boolean;
}

export interface ScrapeRunParams {
  retailerSlug: string;
  jobId: string;
  attempt: number;
  extractParams: ScrapeExtractParams;
}

export async function runExtractJob(
  registry: ScraperRegistry,
  config: AppConfig,
  logger: Logger,
  params: ScrapeRunParams,
): Promise<ScrapeRunResult> {
  const scraper = registry.get(params.retailerSlug);
  const ctx: ScrapeContext = {
    retailerSlug: params.retailerSlug,
    jobId: params.jobId,
    attempt: params.attempt,
  };

  const childLogger = logger.child({
    jobId: params.jobId,
    retailerSlug: params.retailerSlug,
  });

  try {
    return await withBrowserSession(childLogger, async ({ page }) => {
      const response = await page.goto(params.extractParams.url, {
        waitUntil: 'domcontentloaded',
      });

      const html = await safePageContent(page);
      const statusCode = response?.status();

      if (detectAntiBot(html, statusCode)) {
        childLogger.antiBotDetected(params.jobId, params.retailerSlug, params.extractParams.url);

        const screenshot = await safeScreenshot(page);
        await saveFailureArtifacts(
          config,
          {
            jobId: params.jobId,
            retailerSlug: params.retailerSlug,
            url: params.extractParams.url,
            error: 'Anti-bot page detected',
            isAntiBot: true,
            attempt: params.attempt,
            timestamp: new Date().toISOString(),
          },
          screenshot,
          html,
        );

        return {
          success: false,
          error: 'Anti-bot page detected',
          isAntiBot: true,
          rawHtml: html,
        };
      }

      const raw = await scraper.extract(params.extractParams, ctx, page);
      raw.rawHtml = html;

      const normalized = scraper.normalize(raw);

      if (!scraper.validate(normalized)) {
        throw new Error('Product validation failed after normalization');
      }

      childLogger.info('Scrape extract completed', {
        externalId: normalized.externalId,
        price: normalized.price,
        currency: normalized.currency,
        imageUrl: normalized.imageUrl ?? null,
      });

      return {
        success: true,
        product: {
          ...normalized,
          normalizedTitle: normalizeTitle(normalized.title),
        },
        rawHtml: html,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    childLogger.scrapeFailure(
      params.jobId,
      params.retailerSlug,
      params.extractParams.url,
      error,
      { attempt: params.attempt },
    );

    await saveFailureArtifacts(config, {
      jobId: params.jobId,
      retailerSlug: params.retailerSlug,
      url: params.extractParams.url,
      error: message,
      isAntiBot: false,
      attempt: params.attempt,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: message,
    };
  }
}
