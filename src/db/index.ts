import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

/**
 * Database access layer.
 *
 * Two drivers, one schema. `postgres://` URLs go to a real Postgres server via
 * node-postgres; anything else (including an unset URL) uses PGlite, which is
 * Postgres itself compiled to WebAssembly. That means local development, CI and
 * the test suite exercise genuine Postgres semantics — enums, jsonb, window
 * functions, transactions — with no server to install, and production runs the
 * identical migrations against managed Postgres.
 *
 * Both drivers expose the same query-builder surface, so the handle is typed as
 * `NodePgDatabase<typeof schema>` for full inference regardless of which one is
 * actually in use. Typing it loosely here would silently erase result types
 * across every service.
 */

export type Database = NodePgDatabase<typeof schema>;

type Handle = { db: Database; kind: 'pg' | 'pglite'; close: () => Promise<void> };

let cached: Promise<Handle> | null = null;

function resolveUrl(): string {
  return process.env.DATABASE_URL?.trim() || 'pglite://./.pglite';
}

export function isPgliteUrl(url = resolveUrl()): boolean {
  return !url.startsWith('postgres://') && !url.startsWith('postgresql://');
}

async function createDb(url = resolveUrl()): Promise<Handle> {
  if (isPgliteUrl(url)) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');

    // `pglite://memory` gives each test file a private, throwaway database.
    const target = url.replace(/^pglite:\/\//, '');
    const client =
      target === 'memory' || target === ':memory:' ? new PGlite() : new PGlite(target);
    await client.waitReady;

    return {
      db: drizzle(client, { schema }) as unknown as Database,
      kind: 'pglite',
      close: async () => {
        await client.close();
      },
    };
  }

  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new Pool({ connectionString: url, max: 10 });

  return {
    db: drizzle(pool, { schema }),
    kind: 'pg',
    close: async () => {
      await pool.end();
    },
  };
}

/** Process-wide singleton. Next.js reuses the module across requests. */
export async function getDb(): Promise<Database> {
  if (!cached) cached = createDb();
  return (await cached).db;
}

export async function getDbHandle(): Promise<Handle> {
  if (!cached) cached = createDb();
  return cached;
}

/** Fresh, isolated database — used by tests and the reset script. */
export async function createIsolatedDb(url?: string): Promise<Handle> {
  return createDb(url);
}

/** Lets the test harness install a per-file database as the singleton. */
export function setDbHandle(handle: Handle): void {
  cached = Promise.resolve(handle);
}

export async function closeDb(): Promise<void> {
  if (!cached) return;
  const handle = await cached;
  await handle.close();
  cached = null;
}

export { schema };
