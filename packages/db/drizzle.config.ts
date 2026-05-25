import { defineConfig } from 'drizzle-kit';

const databasePath = process.env.DATABASE_PATH ?? './data/price-radar.db';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: databasePath,
  },
});
