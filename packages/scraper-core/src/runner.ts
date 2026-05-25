import type { Page } from 'playwright';
import type { Logger } from '@price-radar/shared';
import { detectAntiBot, normalizeTitle, saveFailureArtifacts } from '@price-radar/shared';
import type { AppConfig } from '@price-radar/shared';
import type { NormalizedProduct, ScrapeContext, ScrapeExtractParams } from '@price-radar/types';
import { getBrowserPool } from './browser-pool.js';
import { withBrowserSession } from './browser-session.js';
import type { ScraperRegistry } from './registry.js';
import { resolveScrapeDelayMs, sleep } from './stealth.js';
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

function buildReferer(url: string, retailerSlug: string): string | undefined {
  if (retailerSlug === 'amazon') {
    return 'https://www.amazon.it/';
  }

  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return undefined;
  }
}

async function executeExtractOnPage(
  registry: ScraperRegistry,
  config: AppConfig,
  logger: Logger,
  params: ScrapeRunParams,
  page: Page,
): Promise<ScrapeRunResult> {
  const scraper = registry.get(params.retailerSlug);
  const ctx: ScrapeContext = {
    retailerSlug: params.retailerSlug,
    jobId: params.jobId,
    attempt: params.attempt,
  };

  await sleep(resolveScrapeDelayMs());

  const referer = buildReferer(params.extractParams.url, params.retailerSlug);
  const response = await page.goto(params.extractParams.url, {
    waitUntil: 'domcontentloaded',
    ...(referer ? { referer } : {}),
  });

  const html = await safePageContent(page);
  const statusCode = response?.status();

  if (detectAntiBot(html, statusCode, { url: params.extractParams.url })) {
    logger.antiBotDetected(params.jobId, params.retailerSlug, params.extractParams.url);

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

  logger.info('Scrape extract completed', {
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
}

async function runExtractWithErrorHandling(
  config: AppConfig,
  logger: Logger,
  params: ScrapeRunParams,
  run: () => Promise<ScrapeRunResult>,
): Promise<ScrapeRunResult> {
  const childLogger = logger.child({
    jobId: params.jobId,
    retailerSlug: params.retailerSlug,
  });

  try {
    return await run();
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

export async function runExtractJob(
  registry: ScraperRegistry,
  config: AppConfig,
  logger: Logger,
  params: ScrapeRunParams,
): Promise<ScrapeRunResult> {
  const childLogger = logger.child({
    jobId: params.jobId,
    retailerSlug: params.retailerSlug,
  });

  const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';

  if (params.retailerSlug === 'amazon') {
    return runExtractWithErrorHandling(config, logger, params, () =>
      getBrowserPool().withAmazonPage(childLogger, { headless }, (page) =>
        executeExtractOnPage(registry, config, childLogger, params, page),
      ),
    );
  }

  return runExtractWithErrorHandling(config, logger, params, () =>
    withBrowserSession(childLogger, async ({ page }) =>
      executeExtractOnPage(registry, config, childLogger, params, page),
    { headless }),
  );
}
