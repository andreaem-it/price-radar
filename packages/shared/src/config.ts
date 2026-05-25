import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScrapeFailureArtifact } from '@price-radar/types';

export interface AppConfig {
  nodeEnv: string;
  logLevel: string;
  databasePath: string;
  redisUrl: string;
  ollamaUrl: string;
  ollamaModel: string;
  apiPort: number;
  mcpPort: number;
  dataDir: string;
  screenshotsDir: string;
  htmlFailuresDir: string;
  logsDir: string;
  scrapeConcurrency: number;
  aiConcurrency: number;
  scrapeMaxAttempts: number;
  schedulerIntervalMs: number;
  tjApiBaseUrl: string;
  tjApiFeedWriteKey: string;
  tjApiPerPage: number;
  tjApiSource: string;
}

function envInt(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR ?? './data';

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    databasePath: process.env.DATABASE_PATH ?? join(dataDir, 'price-radar.db'),
    redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.2',
    apiPort: envInt('API_PORT', 3000),
    mcpPort: envInt('MCP_PORT', 3100),
    dataDir,
    screenshotsDir: join(dataDir, 'screenshots'),
    htmlFailuresDir: join(dataDir, 'html-failures'),
    logsDir: join(dataDir, 'logs'),
    scrapeConcurrency: envInt('SCRAPE_CONCURRENCY', 3),
    aiConcurrency: envInt('AI_CONCURRENCY', 2),
    scrapeMaxAttempts: envInt('SCRAPE_MAX_ATTEMPTS', 3),
    schedulerIntervalMs: envInt('SCHEDULER_INTERVAL_MS', 60_000),
    tjApiBaseUrl: (process.env.TJ_API_BASE_URL ?? '').replace(/\/+$/, ''),
    tjApiFeedWriteKey: process.env.PRICE_RADAR_FEED_WRITE_KEY ?? '',
    tjApiPerPage: envInt('TJ_API_PER_PAGE', 50),
    tjApiSource: process.env.TJ_API_SOURCE ?? 'amazon_it',
  };
}

export async function ensureDataDirs(config: AppConfig): Promise<void> {
  await Promise.all([
    mkdir(config.dataDir, { recursive: true }),
    mkdir(config.screenshotsDir, { recursive: true }),
    mkdir(config.htmlFailuresDir, { recursive: true }),
    mkdir(config.logsDir, { recursive: true }),
  ]);
}

export async function saveFailureArtifacts(
  config: AppConfig,
  artifact: ScrapeFailureArtifact,
  screenshot?: Buffer,
  html?: string,
): Promise<ScrapeFailureArtifact> {
  const timestamp = artifact.timestamp.replace(/[:.]/g, '-');
  const baseName = `${artifact.retailerSlug}-${artifact.jobId}-${timestamp}-attempt${artifact.attempt}`;

  if (screenshot) {
    const screenshotPath = join(config.screenshotsDir, `${baseName}.png`);
    await writeFile(screenshotPath, screenshot);
    artifact.screenshotPath = screenshotPath;
  }

  if (html) {
    const htmlPath = join(config.htmlFailuresDir, `${baseName}.html`);
    await writeFile(htmlPath, html, 'utf-8');
    artifact.htmlPath = htmlPath;
  }

  const logPath = join(config.logsDir, 'scrape-failures.jsonl');
  await writeFile(logPath, `${JSON.stringify(artifact)}\n`, { flag: 'a' });

  return artifact;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const QUEUE_NAMES = {
  SCRAPE: 'scrape-jobs',
  AI: 'ai-jobs',
} as const;
