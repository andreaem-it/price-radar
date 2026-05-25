import { ScraperRegistry } from './registry.js';
import { amazonScraper } from './scrapers/amazon/index.js';
import { mediaworldScraper } from './scrapers/mediaworld/index.js';
import { unieuroScraper } from './scrapers/unieuro/index.js';

export function createDefaultRegistry(): ScraperRegistry {
  const registry = new ScraperRegistry();
  registry.register(amazonScraper);
  registry.register(unieuroScraper);
  registry.register(mediaworldScraper);
  return registry;
}

export { ScraperRegistry } from './registry.js';
export type { PlaywrightScraperPlugin } from './registry.js';
export { createBrowserSession, withBrowserSession } from './browser-session.js';
export type { BrowserSession, BrowserSessionOptions } from './browser-session.js';
export { runExtractJob } from './runner.js';
export type { ScrapeRunParams, ScrapeRunResult } from './runner.js';
export { amazonScraper } from './scrapers/amazon/index.js';
export { unieuroScraper } from './scrapers/unieuro/index.js';
export { mediaworldScraper } from './scrapers/mediaworld/index.js';
export { parsePrice, mapAvailability } from './utils.js';
