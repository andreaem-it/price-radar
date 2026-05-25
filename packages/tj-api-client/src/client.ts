import type {
  TjApiErrorBody,
  TjApiFetchParams,
  TjApiPriceFeedItem,
  TjApiPricesResponse,
  TjApiPushResponse,
  TjApiProduct,
} from './types.js';

export interface TjApiClientConfig {
  baseUrl: string;
  feedWriteKey: string;
  defaultPerPage?: number;
  defaultSource?: string;
  requestTimeoutMs?: number;
}

export class TjApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: TjApiErrorBody,
  ) {
    super(message);
    this.name = 'TjApiError';
  }
}

export function normalizeAsin(asin: string): string | null {
  const normalized = asin.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function isAmazonSource(source: string): boolean {
  return source === 'amazon_it' || source.startsWith('amazon');
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export class TjApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: TjApiClientConfig) {
    if (!config.baseUrl) {
      throw new Error('TJ_API_BASE_URL is required');
    }
    this.baseUrl = trimTrailingSlash(config.baseUrl);
    this.timeoutMs = config.requestTimeoutMs ?? 30_000;
  }

  async fetchPrices(params: TjApiFetchParams = {}): Promise<TjApiPricesResponse> {
    const query = new URLSearchParams();
    if (params.brand) query.set('brand', params.brand);
    if (params.category) query.set('category', params.category);
    if (params.search) query.set('search', params.search);
    query.set('page', String(params.page ?? 1));
    query.set('perPage', String(params.perPage ?? this.config.defaultPerPage ?? 50));

    const url = `${this.baseUrl}/api/price-radar/prices?${query.toString()}`;
    return this.requestJson<TjApiPricesResponse>(url, { method: 'GET' });
  }

  async fetchAllProducts(params: Omit<TjApiFetchParams, 'page'> = {}): Promise<TjApiProduct[]> {
    const perPage = Math.min(params.perPage ?? this.config.defaultPerPage ?? 50, 100);
    const all: TjApiProduct[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const response = await this.fetchPrices({ ...params, page, perPage });
      all.push(...response.products);
      totalPages = response.totalPages;
      page += 1;
    }

    return all;
  }

  async fetchAmazonProductsToMonitor(): Promise<TjApiProduct[]> {
    const products = await this.fetchAllProducts();
    return products.filter((product) => {
      const asin = normalizeAsin(product.asin);
      return asin !== null && isAmazonSource(product.source);
    });
  }

  async pushPrices(items: TjApiPriceFeedItem[]): Promise<TjApiPushResponse> {
    if (!this.config.feedWriteKey) {
      throw new TjApiError('PRICE_RADAR_FEED_WRITE_KEY is not configured', 503);
    }

    if (items.length === 0) {
      return { ok: true, processed: 0, created: 0, updated: 0 };
    }

    const normalized = items.map((item) => this.normalizeFeedItem(item));
    const url = `${this.baseUrl}/api/price-radar/prices?key=${encodeURIComponent(this.config.feedWriteKey)}`;

    return this.requestJson<TjApiPushResponse>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: normalized }),
    });
  }

  private resolveFeedImageUrl(item: TjApiPriceFeedItem): string | null {
    const candidate =
      item.image_url ??
      (item as TjApiPriceFeedItem & { imageUrl?: string | null }).imageUrl ??
      (item as TjApiPriceFeedItem & { image?: string | null }).image;

    if (!candidate?.trim()) {
      return null;
    }

    let url = candidate.trim();
    if (url.startsWith('//')) {
      url = `https:${url}`;
    } else if (/^http:\/\//i.test(url)) {
      url = url.replace(/^http:\/\//i, 'https://');
    }

    if (!/^https:\/\//i.test(url)) {
      return null;
    }

    if (/media-amazon\.com|images-amazon\.com|ssl-images-amazon/i.test(url)) {
      url = url.replace(/\._AC_[A-Z0-9]+_/g, '._AC_SL1500_');
    }

    return url;
  }

  private normalizeFeedItem(item: TjApiPriceFeedItem): TjApiPriceFeedItem {
    const asin = normalizeAsin(item.asin);
    if (!asin) {
      throw new TjApiError(`Invalid ASIN: ${item.asin}`, 400);
    }

    if (!/^https?:\/\//i.test(item.url)) {
      throw new TjApiError(`Invalid URL for ASIN ${asin}`, 400);
    }

    if (!Number.isFinite(item.price) || item.price <= 0) {
      throw new TjApiError(`Invalid price for ASIN ${asin}`, 400);
    }

    return {
      asin,
      url: item.url,
      price: Math.round(item.price * 100) / 100,
      title: item.title ?? null,
      currency: item.currency ?? 'EUR',
      availability: item.availability ?? 'in_stock',
      source: item.source ?? this.config.defaultSource ?? 'amazon_it',
      image_url: this.resolveFeedImageUrl(item),
      brand: item.brand ?? null,
      category: item.category ?? null,
      detected_at: item.detected_at ?? new Date().toISOString(),
    };
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      const body = text ? (JSON.parse(text) as TjApiErrorBody & T) : ({} as TjApiErrorBody & T);

      if (!response.ok) {
        const message =
          body.error ?? body.message ?? `tj-api request failed (${response.status})`;
        throw new TjApiError(message, response.status, body);
      }

      return body as T;
    } catch (error) {
      if (error instanceof TjApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TjApiError(`tj-api request timeout after ${this.timeoutMs}ms`, 504);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createTjApiClient(config: TjApiClientConfig): TjApiClient {
  return new TjApiClient(config);
}

export function isTjApiConfigured(config: {
  tjApiBaseUrl: string;
  tjApiFeedWriteKey: string;
}): boolean {
  return config.tjApiBaseUrl.length > 0;
}

export function createTjApiClientFromAppConfig(config: {
  tjApiBaseUrl: string;
  tjApiFeedWriteKey: string;
  tjApiPerPage: number;
  tjApiSource: string;
}): TjApiClient {
  return new TjApiClient({
    baseUrl: config.tjApiBaseUrl,
    feedWriteKey: config.tjApiFeedWriteKey,
    defaultPerPage: config.tjApiPerPage,
    defaultSource: config.tjApiSource,
  });
}
