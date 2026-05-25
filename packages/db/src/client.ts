import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as schema from './schema.js';

export interface DatabaseClient {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

let dbInstance: DatabaseClient | null = null;

export function createDatabase(databasePath: string): DatabaseClient {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  return { db, sqlite };
}

export function getDatabase(databasePath: string): DatabaseClient {
  if (!dbInstance) {
    dbInstance = createDatabase(databasePath);
  }
  return dbInstance;
}

export function runMigrations(databasePath: string, migrationsFolder: string): void {
  const { db, sqlite } = createDatabase(databasePath);
  migrate(db, { migrationsFolder });
  sqlite.close();
}

export async function seedRetailers(databasePath: string): Promise<void> {
  const { db, sqlite } = createDatabase(databasePath);

  const retailers = [
    { slug: 'amazon', name: 'Amazon', baseUrl: 'https://www.amazon.it', enabled: true },
    { slug: 'unieuro', name: 'Unieuro', baseUrl: 'https://www.unieuro.it', enabled: false },
    {
      slug: 'mediaworld',
      name: 'MediaWorld',
      baseUrl: 'https://www.mediaworld.it',
      enabled: false,
    },
  ];

  const now = new Date().toISOString();

  for (const retailer of retailers) {
    const existing = await db.query.retailers.findFirst({
      where: eq(schema.retailers.slug, retailer.slug),
    });

    if (!existing) {
      await db.insert(schema.retailers).values(retailer);
      continue;
    }

    await db
      .update(schema.retailers)
      .set({ enabled: retailer.enabled, updatedAt: now })
      .where(eq(schema.retailers.slug, retailer.slug));
  }

  sqlite.close();
}

export { schema };
export * from './schema.js';
