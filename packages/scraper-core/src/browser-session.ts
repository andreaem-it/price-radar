import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Logger } from '@price-radar/shared';

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

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function createBrowserSession(
  logger: Logger,
  options: BrowserSessionOptions = {},
): Promise<BrowserSession> {
  const headless = options.headless ?? process.env.PLAYWRIGHT_HEADLESS !== 'false';
  const timeoutMs = options.timeoutMs ?? 30_000;

  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  });

  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(timeoutMs);

  const page = await context.newPage();

  logger.debug('Browser session created', { headless, timeoutMs });

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
