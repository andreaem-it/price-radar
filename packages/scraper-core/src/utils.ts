import type { Page } from 'playwright';
import { normalizeImageUrl } from '@price-radar/shared';

export function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;

  const normalized = text
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:[,.]|$))/g, '')
    .replace(',', '.');

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

export function extractExternalIdFromUrl(url: string, pattern: RegExp): string | null {
  const match = url.match(pattern);
  return match?.[1] ?? null;
}

export async function safePageContent(page: Page): Promise<string> {
  try {
    return await page.content();
  } catch {
    return '';
  }
}

export async function safeScreenshot(page: Page): Promise<Buffer | undefined> {
  try {
    return await page.screenshot({ fullPage: true });
  } catch {
    return undefined;
  }
}

export async function extractAmazonPrice(page: Page): Promise<number | null> {
  const readText = async (selector: string): Promise<string | null> => {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) return null;
    return locator.textContent({ timeout: 2_000 }).catch(() => null);
  };

  const readAttr = async (selector: string, attribute: string): Promise<string | null> => {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) return null;
    return locator.getAttribute(attribute, { timeout: 2_000 }).catch(() => null);
  };

  const selectors = [
    '#corePriceDisplay_desktop_feature_div .a-offscreen',
    '#corePrice_feature_div .a-offscreen',
    '#apex_desktop .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#priceblock_saleprice',
    '.reinventPricePriceToPayMargin .a-offscreen',
    '.priceToPay .a-offscreen',
    '#buyNewSection .a-offscreen',
    '#newBuyBoxPrice',
    '#sns-base-price .a-offscreen',
    '.a-price[data-a-size="xl"] .a-offscreen',
    '.a-price .a-offscreen',
  ];

  for (const selector of selectors) {
    const price = parsePrice(await readText(selector));
    if (price !== null && price > 0) return price;
  }

  const hiddenPrice = parsePrice(await readAttr('#twister-plus-price-data-price', 'value'));
  if (hiddenPrice !== null && hiddenPrice > 0) return hiddenPrice;

  const metaPrice = parsePrice(await readAttr('meta[itemprop="price"]', 'content'));
  if (metaPrice !== null && metaPrice > 0) return metaPrice;

  const jsonLdPrice = await page
    .$$eval('script[type="application/ld+json"]', (scripts) => {
      for (const script of scripts) {
        try {
          const parsed = JSON.parse(script.textContent ?? '') as unknown;
          const items = Array.isArray(parsed) ? parsed : [parsed];

          for (const item of items) {
            const record = item as {
              offers?: { price?: string | number } | Array<{ price?: string | number }>;
            };
            const offers = record.offers;
            const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];

            for (const offer of offerList) {
              const raw = offer?.price;
              if (raw === undefined || raw === null) continue;

              const value = Number.parseFloat(String(raw).replace(',', '.'));
              if (Number.isFinite(value) && value > 0) return value;
            }
          }
        } catch {
          /* ignore malformed JSON-LD */
        }
      }

      return null;
    })
    .catch(() => null);

  if (jsonLdPrice !== null && jsonLdPrice > 0) return jsonLdPrice;

  return null;
}

export async function extractAmazonImageUrl(page: Page): Promise<string | undefined> {
  const readAttr = async (selector: string, attribute: string): Promise<string | null> => {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) return null;
    return locator.getAttribute(attribute, { timeout: 2_000 }).catch(() => null);
  };

  const dynamicUrl = await page
    .locator('#landingImage')
    .first()
    .evaluate((el) => {
      const dynamic = el.getAttribute('data-a-dynamic-image');
      if (!dynamic) return null;

      try {
        const urls = Object.keys(JSON.parse(dynamic) as Record<string, unknown>);
        return urls.at(-1) ?? null;
      } catch {
        return null;
      }
    })
    .catch(() => null);

  const candidates = [
    await readAttr('meta[property="og:image"]', 'content'),
    await readAttr('#landingImage', 'data-old-hires'),
    dynamicUrl,
    await readAttr('#landingImage', 'src'),
    await readAttr('#imgTagWrapperId img', 'data-src'),
    await readAttr('#imgTagWrapperId img', 'src'),
    await readAttr('#main-image-container img', 'src'),
    await readAttr('#imgBlkFront', 'src'),
  ];

  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith('data:')) continue;

    const normalized = normalizeImageUrl(candidate);
    if (normalized) return normalized;
  }

  return undefined;
}

export function normalizeAmazonBrand(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;

  let brand = raw.replace(/\s+/g, ' ').trim();
  brand = brand
    .replace(/^Visita lo Store di\s+/i, '')
    .replace(/^Visita lo store di\s+/i, '')
    .replace(/^Marca:\s*/i, '')
    .replace(/^Brand:\s*/i, '')
    .replace(/^Visit the\s+/i, '')
    .replace(/\s+Store$/i, '')
    .trim();

  return brand.length > 0 ? brand : null;
}

export function normalizeAmazonCategory(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;

  const category = raw.replace(/\s+/g, ' ').trim();
  return category.length > 0 ? category : null;
}

export async function extractAmazonBrand(page: Page): Promise<string | undefined> {
  const readText = async (selector: string): Promise<string | null> => {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) return null;
    return locator.textContent({ timeout: 2_000 }).catch(() => null);
  };

  const jsonLdBrand = await page
    .$$eval('script[type="application/ld+json"]', (scripts) => {
      for (const script of scripts) {
        try {
          const parsed = JSON.parse(script.textContent ?? '') as unknown;
          const items = Array.isArray(parsed) ? parsed : [parsed];

          for (const item of items) {
            const brand = (item as { brand?: { name?: string } | string }).brand;
            if (typeof brand === 'string' && brand.trim()) return brand.trim();
            if (brand && typeof brand === 'object' && brand.name?.trim()) {
              return brand.name.trim();
            }
          }
        } catch {
          /* ignore malformed JSON-LD */
        }
      }

      return null;
    })
    .catch(() => null);

  const candidates = [
    jsonLdBrand,
    await readText('#bylineInfo'),
    await readText('a#brand'),
    await readText('#brandSnapshot_feature_div .a-size-base'),
    await readText('tr.po-brand .po-break-word'),
    await readText('#productOverview_feature_div tr.po-brand td:nth-child(2)'),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeAmazonBrand(candidate);
    if (normalized) return normalized;
  }

  return undefined;
}

export async function extractAmazonCategory(page: Page): Promise<string | undefined> {
  const breadcrumbCategory = await page
    .locator('#wayfinding-breadcrumbs_feature_div')
    .first()
    .evaluate((root) => {
      const links = Array.from(root.querySelectorAll('a'))
        .map((anchor) => {
          const text = (anchor as { textContent?: string | null }).textContent;
          return text?.replace(/[\u203A\u00BB]/g, '').trim();
        })
        .filter((text): text is string => Boolean(text));

      const filtered = links.filter((text) => !/^amazon(\.it)?$/i.test(text));
      return filtered.at(-1) ?? null;
    })
    .catch(() => null);

  const normalizedBreadcrumb = normalizeAmazonCategory(breadcrumbCategory);
  if (normalizedBreadcrumb) return normalizedBreadcrumb;

  const readText = async (selector: string): Promise<string | null> => {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) return null;
    return locator.textContent({ timeout: 2_000 }).catch(() => null);
  };

  const fallback = normalizeAmazonCategory(
    await readText('tr.po-product_details-dept .po-break-word'),
  );
  return fallback ?? undefined;
}

export function mapAvailability(text: string | null | undefined): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();
  if (/disponib|in stock|aggiungi al carrello|acquista/i.test(lower)) return 'in_stock';
  if (/esaurito|non disponib|out of stock/i.test(lower)) return 'out_of_stock';
  return 'unknown';
}
