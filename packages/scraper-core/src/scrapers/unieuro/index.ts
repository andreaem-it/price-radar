import type { Page } from 'playwright';
import { normalizeTitle } from '@price-radar/shared';
import type {
  NormalizedProduct,
  RawProductData,
  ScrapeContext,
  ScrapeExtractParams,
  ScrapeSearchParams,
  ScrapeSearchResult,
} from '@price-radar/types';
import type { PlaywrightScraperPlugin } from '../../registry.js';
import { extractExternalIdFromUrl, mapAvailability, parsePrice } from '../../utils.js';

const UNIEURO_ID_PATTERN = /-p(\d+)\.html/i;

export const unieuroScraper: PlaywrightScraperPlugin = {
  slug: 'unieuro',
  name: 'Unieuro',
  baseUrl: 'https://www.unieuro.it',

  async search(
    params: ScrapeSearchParams,
    _ctx: ScrapeContext,
    page: Page,
  ): Promise<ScrapeSearchResult[]> {
    const searchUrl = `https://www.unieuro.it/online/search?q=${encodeURIComponent(params.query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    const items = page.locator('[data-testid="product-card"], .product-item, .c-product');
    const count = Math.min(await items.count(), params.maxResults ?? 10);
    const results: ScrapeSearchResult[] = [];

    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const title =
        (await item.locator('[data-testid="product-title"], .product-title, h3').first().textContent())?.trim() ??
        '';
      const href =
        (await item.locator('a[href]').first().getAttribute('href')) ?? '';
      const priceText =
        (await item.locator('[data-testid="product-price"], .price, .c-price__value').first().textContent()) ??
        '';

      if (!title || !href) continue;

      const url = href.startsWith('http') ? href : `https://www.unieuro.it${href}`;
      const externalId = extractExternalIdFromUrl(url, UNIEURO_ID_PATTERN) ?? title;

      results.push({
        externalId,
        title,
        url,
        price: parsePrice(priceText),
        currency: 'EUR',
      });
    }

    return results;
  },

  async extract(params: ScrapeExtractParams, _ctx: ScrapeContext, page: Page): Promise<RawProductData> {
    await page.goto(params.url, { waitUntil: 'domcontentloaded' });

    const title =
      (await page.locator('h1[data-testid="pdp-title"], h1.product-title, h1').first().textContent())?.trim() ??
      '';

    const priceText =
      (await page.locator('[data-testid="pdp-price"], .price, .c-price__value').first().textContent()) ??
      '';

    const availability =
      (await page.locator('[data-testid="availability"], .availability').first().textContent()) ??
      '';

    const externalId =
      params.externalId ??
      extractExternalIdFromUrl(params.url, UNIEURO_ID_PATTERN) ??
      params.url;

    return {
      title,
      price: parsePrice(priceText),
      currency: 'EUR',
      url: params.url,
      externalId,
      availability: availability.trim(),
    };
  },

  normalize(raw: RawProductData): NormalizedProduct {
    if (!raw.title) {
      throw new Error('Unieuro product title missing');
    }
    if (raw.price === null) {
      throw new Error('Unieuro product price missing');
    }

    return {
      title: raw.title,
      normalizedTitle: normalizeTitle(raw.title),
      price: raw.price,
      currency: raw.currency || 'EUR',
      url: raw.url,
      externalId: raw.externalId,
      availability: mapAvailability(raw.availability),
    };
  },

  validate(product: NormalizedProduct): boolean {
    return product.title.length > 0 && product.price > 0;
  },
};
