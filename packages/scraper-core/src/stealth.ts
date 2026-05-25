import type { BrowserContext, BrowserContextOptions, LaunchOptions } from 'playwright';
import type { BrowserSessionOptions } from './browser-session.js';

export const DEFAULT_CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const STEALTH_INIT_SCRIPT = `
(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  if (!window.chrome) {
    window.chrome = { runtime: {} };
  }

  Object.defineProperty(navigator, 'languages', {
    get: () => ['it-IT', 'it', 'en-US', 'en'],
  });

  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });
})();
`;

export function resolveHeadless(options: BrowserSessionOptions = {}): boolean {
  if (options.headless !== undefined) return options.headless;
  return process.env.PLAYWRIGHT_HEADLESS !== 'false';
}

export function resolveUserAgent(options: BrowserSessionOptions = {}): string {
  return (
    options.userAgent ??
    process.env.PLAYWRIGHT_USER_AGENT ??
    DEFAULT_CHROME_USER_AGENT
  );
}

export function buildLaunchOptions(options: BrowserSessionOptions = {}): LaunchOptions {
  return {
    headless: resolveHeadless(options),
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
    ],
  };
}

export function buildContextOptions(options: BrowserSessionOptions = {}): BrowserContextOptions {
  const userAgent = resolveUserAgent(options);

  return {
    userAgent,
    viewport: { width: 1366, height: 768 },
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    extraHTTPHeaders: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Upgrade-Insecure-Requests': '1',
    },
  };
}

export async function applyStealthScripts(context: BrowserContext): Promise<void> {
  await context.addInitScript(STEALTH_INIT_SCRIPT);
}

export function resolveScrapeDelayMs(): number {
  const base = Number.parseInt(process.env.SCRAPE_DELAY_MS ?? '1500', 10);
  const jitter = Number.parseInt(process.env.SCRAPE_JITTER_MS ?? '2000', 10);
  const safeBase = Number.isFinite(base) ? Math.max(0, base) : 1500;
  const safeJitter = Number.isFinite(jitter) ? Math.max(0, jitter) : 2000;
  return safeBase + Math.floor(Math.random() * safeJitter);
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}
