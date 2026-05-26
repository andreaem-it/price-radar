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
import {
  extractAmazonBrand,
  extractAmazonCategory,
  extractAmazonImageUrl,
  extractAmazonPrice,
  extractExternalIdFromUrl,
  mapAvailability,
  parsePrice,
} from '../../utils.js';

const AMAZON_ID_PATTERN = /\/dp\/([A-Z0-9]{10})/i;

export const amazonScraper: PlaywrightScraperPlugin = {
  slug: 'amazon',
  name: 'Amazon',
  baseUrl: 'https://www.amazon.it',

  async search(
    params: ScrapeSearchParams,
    _ctx: ScrapeContext,
    page: Page,
  ): Promise<ScrapeSearchResult[]> {
    const searchUrl = `https://www.amazon.it/s?k=${encodeURIComponent(params.query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    const items = page.locator('[data-component-type="s-search-result"]');
    const count = Math.min(await items.count(), params.maxResults ?? 10);
    const results: ScrapeSearchResult[] = [];

    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const title = (await item.locator('h2 a span').first().textContent())?.trim() ?? '';
      const href = (await item.locator('h2 a').first().getAttribute('href')) ?? '';
      const priceText =
        (await item.locator('.a-price .a-offscreen').first().textContent()) ??
        (await item.locator('.a-price-whole').first().textContent());

      if (!title || !href) continue;

      const url = href.startsWith('http') ? href : `https://www.amazon.it${href}`;
      const externalId = extractExternalIdFromUrl(url, AMAZON_ID_PATTERN) ?? title;

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
    const title =
      (await page.locator('#productTitle').first().textContent())?.trim() ??
      (await page.locator('span#title').first().textContent())?.trim() ??
      '';

    const price = await extractAmazonPrice(page);

    const readOptionalText = async (selector: string): Promise<string | null> => {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) return null;
      return locator.textContent({ timeout: 2_000 }).catch(() => null);
    };

    const availability =
      (await readOptionalText('#availabilityInsideBuyBox_feature_div #availability')) ??
      (await readOptionalText('#outOfStock')) ??
      (await readOptionalText('#availability'));

    const imageUrl = await extractAmazonImageUrl(page);
    const brand = await extractAmazonBrand(page);
    const category = await extractAmazonCategory(page);

    const externalId =
      params.externalId ??
      extractExternalIdFromUrl(params.url, AMAZON_ID_PATTERN) ??
      params.url;

    return {
      title,
      price,
      currency: 'EUR',
      url: params.url,
      externalId,
      imageUrl,
      brand,
      category,
      availability: availability?.trim(),
    };
  },

  normalize(raw: RawProductData): NormalizedProduct {
    if (!raw.title) {
      throw new Error('Amazon product title missing');
    }
    if (raw.price === null) {
      throw new Error('Amazon product price missing');
    }

    return {
      title: raw.title,
      normalizedTitle: normalizeTitle(raw.title),
      price: raw.price,
      currency: raw.currency || 'EUR',
      url: raw.url,
      externalId: raw.externalId,
      availability: mapAvailability(raw.availability),
      imageUrl: raw.imageUrl,
      brand: raw.brand,
      category: raw.category,
    };
  },

  validate(product: NormalizedProduct): boolean {
    return product.title.length > 0 && product.price > 0 && product.externalId.length > 0;
  },
};
