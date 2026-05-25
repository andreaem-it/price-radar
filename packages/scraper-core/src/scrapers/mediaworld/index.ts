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

const MEDIAWORLD_ID_PATTERN = /-(\d+)\.html/i;

export const mediaworldScraper: PlaywrightScraperPlugin = {
  slug: 'mediaworld',
  name: 'MediaWorld',
  baseUrl: 'https://www.mediaworld.it',

  async search(
    params: ScrapeSearchParams,
    _ctx: ScrapeContext,
    page: Page,
  ): Promise<ScrapeSearchResult[]> {
    const searchUrl = `https://www.mediaworld.it/it/search.html?query=${encodeURIComponent(params.query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    const items = page.locator('[data-test="m-product-tile"], .c-product__wrapper, .product');
    const count = Math.min(await items.count(), params.maxResults ?? 10);
    const results: ScrapeSearchResult[] = [];

    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const title =
        (await item.locator('[data-test="product-title"], .c-product__title, h3').first().textContent())?.trim() ??
        '';
      const href =
        (await item.locator('a[href]').first().getAttribute('href')) ?? '';
      const priceText =
        (await item.locator('[data-test="product-price"], .c-product__price').first().textContent()) ??
        '';

      if (!title || !href) continue;

      const url = href.startsWith('http') ? href : `https://www.mediaworld.it${href}`;
      const externalId = extractExternalIdFromUrl(url, MEDIAWORLD_ID_PATTERN) ?? title;

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
      (await page.locator('[data-test="pdp-title"], h1.c-product__title, h1').first().textContent())?.trim() ??
      '';

    const priceText =
      (await page.locator('[data-test="pdp-price"], .c-product__price').first().textContent()) ??
      '';

    const availability =
      (await page.locator('[data-test="availability"], .c-product__availability').first().textContent()) ??
      '';

    const externalId =
      params.externalId ??
      extractExternalIdFromUrl(params.url, MEDIAWORLD_ID_PATTERN) ??
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
      throw new Error('MediaWorld product title missing');
    }
    if (raw.price === null) {
      throw new Error('MediaWorld product price missing');
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
