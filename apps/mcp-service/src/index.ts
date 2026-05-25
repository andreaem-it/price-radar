import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createLogger, ensureDataDirs, loadConfig } from '@price-radar/shared';
import { getDatabase, runMigrations, seedRetailers } from '@price-radar/db';
import { startMcpServer } from './server.js';

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

async function main() {
  const config = loadConfig();
  const logger = createLogger('mcp-service', config.logLevel);

  await ensureDataDirs(config);
  runMigrations(config.databasePath, migrationsFolder);
  await seedRetailers(config.databasePath);
  getDatabase(config.databasePath);

  await startMcpServer(config, logger);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
