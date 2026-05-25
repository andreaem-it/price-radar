export type ScrapeJobStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'retrying';

export type AiJobType = 'match_products' | 'detect_anomaly' | 'repair_selector';

export type AiJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface RetailerConfig {
  slug: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
}

export interface RawProductData {
  title: string;
  price: number | null;
  currency: string;
  url: string;
  externalId: string;
  imageUrl?: string;
  availability?: string;
  rawHtml?: string;
}

export interface NormalizedProduct {
  title: string;
  normalizedTitle: string;
  price: number;
  currency: string;
  url: string;
  externalId: string;
  sku?: string;
  ean?: string;
  imageUrl?: string;
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
}

export interface ScrapeSearchParams {
  query: string;
  maxResults?: number;
}

export interface ScrapeSearchResult {
  externalId: string;
  title: string;
  url: string;
  price: number | null;
  currency: string;
}

export interface ScrapeExtractParams {
  url: string;
  externalId?: string;
}

export interface ScrapeContext {
  retailerSlug: string;
  jobId: string;
  attempt: number;
}

export interface ScraperPlugin {
  slug: string;
  name: string;
  baseUrl: string;
  search(params: ScrapeSearchParams, ctx: ScrapeContext): Promise<ScrapeSearchResult[]>;
  extract(params: ScrapeExtractParams, ctx: ScrapeContext): Promise<RawProductData>;
  normalize(raw: RawProductData): NormalizedProduct;
  validate(product: NormalizedProduct): boolean;
}

export interface ScrapeQueueJobData {
  jobId: string;
  productId: string;
  retailerId: string;
  retailerSlug: string;
  url: string;
  externalId?: string;
  asin?: string;
  source?: string;
  previousPrice?: number | null;
  brand?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  priority?: number;
}

export interface AiQueueJobData {
  jobId: string;
  type: AiJobType;
  payload: MatchProductsPayload | DetectAnomalyPayload | RepairSelectorPayload;
}

export interface MatchProductsPayload {
  sourceProduct: NormalizedProduct;
  candidates: NormalizedProduct[];
}

export interface DetectAnomalyPayload {
  productId: string;
  previousPrice: number;
  currentPrice: number;
  currency: string;
  history: number[];
}

export interface RepairSelectorPayload {
  retailerSlug: string;
  url: string;
  failedSelector: string;
  htmlSnippet: string;
}

export interface MatchProductsResult {
  matchedIndex: number | null;
  confidence: number;
  reasoning: string;
}

export interface DetectAnomalyResult {
  isAnomaly: boolean;
  deviationPercent: number;
  reasoning: string;
}

export interface RepairSelectorResult {
  suggestedSelector: string;
  confidence: number;
  reasoning: string;
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  format?: 'json';
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export interface ApiHealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  services: {
    database: boolean;
    redis: boolean;
  };
}

export interface CreateProductRequest {
  title: string;
  url: string;
  retailerSlug: string;
  externalId?: string;
  sku?: string;
  ean?: string;
}

export interface ProductResponse {
  id: string;
  title: string;
  normalizedTitle: string;
  url: string;
  externalId: string | null;
  sku: string | null;
  ean: string | null;
  retailerId: string;
  retailerSlug: string;
  currentPrice: number | null;
  currency: string | null;
  lastScrapedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScrapeFailureArtifact {
  jobId: string;
  retailerSlug: string;
  url: string;
  error: string;
  screenshotPath?: string;
  htmlPath?: string;
  isAntiBot: boolean;
  attempt: number;
  timestamp: string;
}

export interface LoggerContext {
  service: string;
  jobId?: string;
  retailerSlug?: string;
  productId?: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  service: string;
  jobId?: string;
  retailerSlug?: string;
  productId?: string;
  attempt?: number;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}
