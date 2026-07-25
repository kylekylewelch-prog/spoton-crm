import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getDbHandle, isPgliteUrl } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../drizzle');

/** Applies all pending migrations against whichever driver is configured. */
export async function runMigrations(db: any) {
  if (isPgliteUrl()) {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db, { migrationsFolder });
  } else {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(db, { migrationsFolder });
  }
}

async function main() {
  const handle = await getDbHandle();
  await runMigrations(handle.db);
  console.log(`[migrate] schema up to date (${handle.kind})`);
  await handle.close();
}

if (process.argv[1] && process.argv[1].includes('migrate')) {
  main().catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
}
