import type { AppConfig } from './config.js';

export interface UpdateScrapeJobPayload {
  status?: string;
  attempts?: number;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string;
}

export interface UpdateProductPayload {
  title?: string;
  normalizedTitle?: string;
  externalId?: string | null;
  updatedAt?: string;
}

export interface CreateAnomalyPayload {
  productId: string;
  previousPrice: number;
  currentPrice: number;
  deviationPercent: number;
  currency: string;
}

export class ControlApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ControlApiError';
  }
}

export function isRemoteDbEnabled(config: AppConfig): boolean {
  return config.controlApiUrl.length > 0;
}

export class ControlApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AppConfig) {
    if (!config.controlApiUrl) {
      throw new Error('CONTROL_API_URL is not configured');
    }
    this.baseUrl = config.controlApiUrl.replace(/\/+$/, '');
    this.apiKey = config.internalApiKey;
  }

  async updateScrapeJob(jobId: string, payload: UpdateScrapeJobPayload): Promise<void> {
    await this.request(`/api/internal/jobs/${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...payload,
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
      }),
    });
  }

  async updateProduct(productId: string, payload: UpdateProductPayload): Promise<void> {
    await this.request(`/api/internal/products/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...payload,
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
      }),
    });
  }

  async createAnomaly(payload: CreateAnomalyPayload): Promise<void> {
    await this.request('/api/internal/anomalies', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  private async request(path: string, init: RequestInit): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };

    if (this.apiKey) {
      headers['X-Internal-Key'] = this.apiKey;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      let message = text || `control-api request failed (${response.status})`;
      try {
        const body = JSON.parse(text) as { error?: string; message?: string };
        message = body.message ?? body.error ?? message;
      } catch {
        // keep raw text
      }
      throw new ControlApiError(message, response.status);
    }
  }
}

export function createControlApiClient(config: AppConfig): ControlApiClient {
  return new ControlApiClient(config);
}
