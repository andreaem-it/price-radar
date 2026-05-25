import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Logger } from '@price-radar/shared';
import {
  applyStealthScripts,
  buildContextOptions,
  buildLaunchOptions,
  DEFAULT_CHROME_USER_AGENT,
} from './stealth.js';

export interface BrowserSessionOptions {
  headless?: boolean;
  timeoutMs?: number;
  userAgent?: string;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export { DEFAULT_CHROME_USER_AGENT };

export async function createBrowserSession(
  logger: Logger,
  options: BrowserSessionOptions = {},
): Promise<BrowserSession> {
  const timeoutMs = options.timeoutMs ?? 30_000;

  const browser = await chromium.launch(buildLaunchOptions(options));

  const context = await browser.newContext(buildContextOptions(options));
  await applyStealthScripts(context);

  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(timeoutMs);

  const page = await context.newPage();

  logger.debug('Browser session created', {
    headless: buildLaunchOptions(options).headless,
    timeoutMs,
  });

  const close = async (): Promise<void> => {
    try {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      logger.debug('Browser session closed');
    } catch (error) {
      logger.error('Failed to close browser session', error);
    }
  };

  return { browser, context, page, close };
}

export async function withBrowserSession<T>(
  logger: Logger,
  fn: (session: BrowserSession) => Promise<T>,
  options?: BrowserSessionOptions,
): Promise<T> {
  const session = await createBrowserSession(logger, options);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}
