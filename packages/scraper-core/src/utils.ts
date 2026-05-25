import type { Page } from 'playwright';

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

export function mapAvailability(text: string | null | undefined): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();
  if (/disponib|in stock|aggiungi al carrello|acquista/i.test(lower)) return 'in_stock';
  if (/esaurito|non disponib|out of stock/i.test(lower)) return 'out_of_stock';
  return 'unknown';
}
