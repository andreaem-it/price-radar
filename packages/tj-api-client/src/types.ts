export type TjAvailability = 'in_stock' | 'out_of_stock' | 'unknown';

export interface TjApiProduct {
  id: number;
  asin: string;
  source: string;
  title: string | null;
  image_url: string | null;
  url: string;
  current_price: number | null;
  currency: string;
  availability: TjAvailability;
  last_seen_at: string | null;
  last_checked_at: string | null;
  last_price_change_at: string | null;
  updated_at: string;
  brand?: string | null;
  category?: string | null;
}

export interface TjApiPricesResponse {
  products: TjApiProduct[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface TjApiFetchParams {
  brand?: string;
  category?: string;
  search?: string;
  page?: number;
  perPage?: number;
}

export interface TjApiPriceFeedItem {
  asin: string;
  url: string;
  price: number;
  title?: string | null;
  currency?: string;
  availability?: TjAvailability;
  source?: string;
  image_url?: string | null;
  brand?: string | null;
  category?: string | null;
  detected_at?: string;
}

export interface TjApiPushResponse {
  ok: boolean;
  processed: number;
  created: number;
  updated: number;
}

export interface TjApiErrorBody {
  error?: string;
  message?: string;
}
