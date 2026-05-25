import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Logger } from '@price-radar/shared';
import type { BrowserSessionOptions } from './browser-session.js';
import {
  applyStealthScripts,
  buildContextOptions,
  buildLaunchOptions,
  sleep,
} from './stealth.js';

async function warmupAmazonContext(page: Page): Promise<void> {
  await page.goto('https://www.amazon.it/', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  await sleep(800 + Math.floor(Math.random() * 700));

  const cookieAccept = page.locator(
    '#sp-cc-accept, input#accept, button[name="accept"]',
  );
  if ((await cookieAccept.count()) > 0) {
    await cookieAccept.first().click({ timeout: 3_000 }).catch(() => undefined);
    await sleep(400);
  }
}

export class BrowserPool {
  private browser: Browser | null = null;
  private amazonContext: BrowserContext | null = null;
  private amazonReady = false;

  async withAmazonPage<T>(
    logger: Logger,
    options: BrowserSessionOptions,
    fn: (page: Page) => Promise<T>,
  ): Promise<T> {
    const context = await this.ensureAmazonContext(logger, options);
    const page = await context.newPage();

    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.amazonContext?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.amazonContext = null;
    this.browser = null;
    this.amazonReady = false;
  }

  private async ensureAmazonContext(
    logger: Logger,
    options: BrowserSessionOptions,
  ): Promise<BrowserContext> {
    if (this.amazonContext) {
      return this.amazonContext;
    }

    if (!this.browser) {
      this.browser = await chromium.launch(buildLaunchOptions(options));
      logger.debug('Shared Chromium browser launched');
    }

    this.amazonContext = await this.browser.newContext(buildContextOptions(options));
    await applyStealthScripts(this.amazonContext);

    if (!this.amazonReady) {
      const warmupPage = await this.amazonContext.newPage();
      try {
        await warmupAmazonContext(warmupPage);
        this.amazonReady = true;
        logger.debug('Amazon session warmed up');
      } catch (error) {
        logger.warn('Amazon warmup failed — continuing without cookies', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await warmupPage.close().catch(() => undefined);
      }
    }

    return this.amazonContext;
  }
}

let globalPool: BrowserPool | null = null;

export function getBrowserPool(): BrowserPool {
  if (!globalPool) {
    globalPool = new BrowserPool();
  }
  return globalPool;
}

export async function closeBrowserPool(): Promise<void> {
  await globalPool?.close();
  globalPool = null;
}
