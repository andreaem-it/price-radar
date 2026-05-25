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

export function mapAvailability(text: string | null | undefined): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();
  if (/disponib|in stock|aggiungi al carrello|acquista/i.test(lower)) return 'in_stock';
  if (/esaurito|non disponib|out of stock/i.test(lower)) return 'out_of_stock';
  return 'unknown';
}
