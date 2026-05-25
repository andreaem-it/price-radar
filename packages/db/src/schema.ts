import { relations, sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const retailers = sqliteTable(
  'retailers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('retailers_slug_idx').on(table.slug)],
);

export const products = sqliteTable(
  'products',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    url: text('url').notNull(),
    externalId: text('external_id'),
    sku: text('sku'),
    ean: text('ean'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('products_retailer_idx').on(table.retailerId),
    index('products_external_id_idx').on(table.externalId),
    index('products_normalized_title_idx').on(table.normalizedTitle),
  ],
);

export const productPrices = sqliteTable(
  'product_prices',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    price: real('price').notNull(),
    currency: text('currency').notNull().default('EUR'),
    availability: text('availability').notNull().default('unknown'),
    rawData: text('raw_data', { mode: 'json' }).$type<Record<string, unknown>>(),
    scrapedAt: text('scraped_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('product_prices_product_idx').on(table.productId),
    index('product_prices_scraped_at_idx').on(table.scrapedAt),
  ],
);

export const scrapeJobs = sqliteTable(
  'scrape_jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    status: text('status').notNull().default('pending'),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    scheduledAt: text('scheduled_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    error: text('error'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('scrape_jobs_status_idx').on(table.status),
    index('scrape_jobs_product_idx').on(table.productId),
    index('scrape_jobs_scheduled_at_idx').on(table.scheduledAt),
  ],
);

export const priceAnomalies = sqliteTable(
  'price_anomalies',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    previousPrice: real('previous_price').notNull(),
    currentPrice: real('current_price').notNull(),
    deviationPercent: real('deviation_percent').notNull(),
    currency: text('currency').notNull().default('EUR'),
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    aiAnalysis: text('ai_analysis'),
    detectedAt: text('detected_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    resolvedAt: text('resolved_at'),
  },
  (table) => [
    index('price_anomalies_product_idx').on(table.productId),
    index('price_anomalies_resolved_idx').on(table.resolved),
  ],
);

export const retailersRelations = relations(retailers, ({ many }) => ({
  products: many(products),
  scrapeJobs: many(scrapeJobs),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  retailer: one(retailers, {
    fields: [products.retailerId],
    references: [retailers.id],
  }),
  prices: many(productPrices),
  scrapeJobs: many(scrapeJobs),
  anomalies: many(priceAnomalies),
}));

export const productPricesRelations = relations(productPrices, ({ one }) => ({
  product: one(products, {
    fields: [productPrices.productId],
    references: [products.id],
  }),
}));

export const scrapeJobsRelations = relations(scrapeJobs, ({ one }) => ({
  product: one(products, {
    fields: [scrapeJobs.productId],
    references: [products.id],
  }),
  retailer: one(retailers, {
    fields: [scrapeJobs.retailerId],
    references: [retailers.id],
  }),
}));

export const priceAnomaliesRelations = relations(priceAnomalies, ({ one }) => ({
  product: one(products, {
    fields: [priceAnomalies.productId],
    references: [products.id],
  }),
}));

export type Retailer = typeof retailers.$inferSelect;
export type NewRetailer = typeof retailers.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductPrice = typeof productPrices.$inferSelect;
export type NewProductPrice = typeof productPrices.$inferInsert;
export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type NewScrapeJob = typeof scrapeJobs.$inferInsert;
export type PriceAnomaly = typeof priceAnomalies.$inferSelect;
export type NewPriceAnomaly = typeof priceAnomalies.$inferInsert;
