CREATE TABLE `retailers` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retailers_slug_unique` ON `retailers` (`slug`);--> statement-breakpoint
CREATE INDEX `retailers_slug_idx` ON `retailers` (`slug`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`retailer_id` text NOT NULL,
	`title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`url` text NOT NULL,
	`external_id` text,
	`sku` text,
	`ean` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`retailer_id`) REFERENCES `retailers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `products_retailer_idx` ON `products` (`retailer_id`);--> statement-breakpoint
CREATE INDEX `products_external_id_idx` ON `products` (`external_id`);--> statement-breakpoint
CREATE INDEX `products_normalized_title_idx` ON `products` (`normalized_title`);--> statement-breakpoint
CREATE TABLE `product_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`price` real NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`availability` text DEFAULT 'unknown' NOT NULL,
	`raw_data` text,
	`scraped_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_prices_product_idx` ON `product_prices` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_prices_scraped_at_idx` ON `product_prices` (`scraped_at`);--> statement-breakpoint
CREATE TABLE `scrape_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`retailer_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`scheduled_at` text DEFAULT (datetime('now')) NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error` text,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`retailer_id`) REFERENCES `retailers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scrape_jobs_status_idx` ON `scrape_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `scrape_jobs_product_idx` ON `scrape_jobs` (`product_id`);--> statement-breakpoint
CREATE INDEX `scrape_jobs_scheduled_at_idx` ON `scrape_jobs` (`scheduled_at`);--> statement-breakpoint
CREATE TABLE `price_anomalies` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`previous_price` real NOT NULL,
	`current_price` real NOT NULL,
	`deviation_percent` real NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`ai_analysis` text,
	`detected_at` text DEFAULT (datetime('now')) NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `price_anomalies_product_idx` ON `price_anomalies` (`product_id`);--> statement-breakpoint
CREATE INDEX `price_anomalies_resolved_idx` ON `price_anomalies` (`resolved`);
