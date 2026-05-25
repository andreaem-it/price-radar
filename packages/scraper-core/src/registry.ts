import type { Page } from 'playwright';
import type {
  NormalizedProduct,
  RawProductData,
  ScrapeContext,
  ScrapeExtractParams,
  ScrapeSearchParams,
  ScrapeSearchResult,
} from '@price-radar/types';

export interface PlaywrightScraperPlugin {
  slug: string;
  name: string;
  baseUrl: string;
  search(
    params: ScrapeSearchParams,
    ctx: ScrapeContext,
    page: Page,
  ): Promise<ScrapeSearchResult[]>;
  extract(params: ScrapeExtractParams, ctx: ScrapeContext, page: Page): Promise<RawProductData>;
  normalize(raw: RawProductData): NormalizedProduct;
  validate(product: NormalizedProduct): boolean;
}

export class ScraperRegistry {
  private readonly scrapers = new Map<string, PlaywrightScraperPlugin>();

  register(scraper: PlaywrightScraperPlugin): void {
    this.scrapers.set(scraper.slug, scraper);
  }

  get(slug: string): PlaywrightScraperPlugin {
    const scraper = this.scrapers.get(slug);
    if (!scraper) {
      throw new Error(`Scraper not registered: ${slug}`);
    }
    return scraper;
  }

  has(slug: string): boolean {
    return this.scrapers.has(slug);
  }

  list(): PlaywrightScraperPlugin[] {
    return [...this.scrapers.values()];
  }
}
