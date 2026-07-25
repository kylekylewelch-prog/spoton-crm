import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isPgliteUrl } from './index';

/**
 * Drops everything. For PGlite that means deleting the data directory; for a
 * real server it drops and recreates the public schema so migrations replay
 * from scratch.
 */
async function main() {
  const url = process.env.DATABASE_URL?.trim() || 'pglite://./.pglite';

  if (isPgliteUrl(url)) {
    const dir = resolve(process.cwd(), url.replace(/^pglite:\/\//, ''));
    await rm(dir, { recursive: true, force: true });
    console.log(`[reset] removed ${dir}`);
    return;
  }

  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url });
  await pool.query('drop schema if exists public cascade; create schema public;');
  await pool.query('drop schema if exists drizzle cascade;');
  await pool.end();
  console.log('[reset] public schema recreated');
}

main().catch((err) => {
  console.error('[reset] failed:', err);
  process.exit(1);
});
