import type { LogLevel, LoggerContext, StructuredLogEntry } from '@price-radar/types';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private readonly minLevel: number;

  constructor(
    private readonly context: LoggerContext,
    logLevel: string = 'info',
  ) {
    this.minLevel = LOG_LEVELS[logLevel as LogLevel] ?? LOG_LEVELS.info;
  }

  child(extra: Partial<LoggerContext>): Logger {
    return new Logger({ ...this.context, ...extra }, this.levelName());
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.write('debug', message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.write('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.write('warn', message, metadata);
  }

  error(message: string, error?: unknown, metadata?: Record<string, unknown>): void {
    const errorMessage = error instanceof Error ? error.message : String(error ?? '');
    this.write('error', message, { ...metadata, error: errorMessage });
  }

  scrapeRetry(
    jobId: string,
    attempt: number,
    reason: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.write('warn', 'Scrape retry scheduled', {
      jobId,
      attempt,
      reason,
      ...metadata,
    });
  }

  scrapeFailure(
    jobId: string,
    retailerSlug: string,
    url: string,
    error: unknown,
    metadata?: Record<string, unknown>,
  ): void {
    this.error('Scrape job failed', error, {
      jobId,
      retailerSlug,
      url,
      ...metadata,
    });
  }

  antiBotDetected(jobId: string, retailerSlug: string, url: string): void {
    this.warn('Anti-bot detection triggered', {
      jobId,
      retailerSlug,
      url,
      isAntiBot: true,
    });
  }

  private write(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (LOG_LEVELS[level] < this.minLevel) return;

    const entry: StructuredLogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: this.context.service,
      ...(this.context.jobId ? { jobId: this.context.jobId } : {}),
      ...(this.context.retailerSlug ? { retailerSlug: this.context.retailerSlug } : {}),
      ...(this.context.productId ? { productId: this.context.productId } : {}),
      ...(metadata ?? {}),
    };

    const line = JSON.stringify(entry);

    if (level === 'error') {
      console.error(line);
      return;
    }

    if (level === 'warn') {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  private levelName(): string {
    const entry = Object.entries(LOG_LEVELS).find(([, value]) => value === this.minLevel);
    return entry?.[0] ?? 'info';
  }
}

export function createLogger(service: string, logLevel?: string): Logger {
  return new Logger({ service }, logLevel);
}
