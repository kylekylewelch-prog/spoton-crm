import { createIsolatedDb, setDbHandle, type Database } from '@/db';
import { runMigrations } from '@/db/migrate';
import { seed } from '@/db/seed';
import { eq } from 'drizzle-orm';
import { roles, users } from '@/db/schema';
import type { AuthenticatedUser } from '@/server/auth';
import type { AuditContext } from '@/server/audit';

/**
 * Integration test harness.
 *
 * Each test file gets a private in-memory PGlite database — real Postgres, no
 * server — migrated and seeded through the same code paths production uses. That
 * means the integration tests exercise genuine SQL, genuine constraints and the
 * genuine service layer rather than mocks.
 */

export type TestHarness = {
  db: Database;
  close: () => Promise<void>;
  as: (email: string) => Promise<AuthenticatedUser>;
  ctx: (email?: string) => Promise<AuditContext>;
};

export async function setupDatabase({ withSeed = true }: { withSeed?: boolean } = {}): Promise<TestHarness> {
  const handle = await createIsolatedDb('pglite://memory');
  setDbHandle(handle);
  await runMigrations(handle.db);
  if (withSeed) await seed();

  const as = async (email: string): Promise<AuthenticatedUser> => {
    const rows = await handle.db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.email, email))
      .limit(1);

    const row = rows[0];
    if (!row) throw new Error(`Test user ${email} not found`);

    return {
      id: row.user.id,
      email: row.user.email,
      name: row.user.name,
      title: row.user.title,
      teamId: row.user.teamId,
      managerId: row.user.managerId,
      region: row.user.region,
      roleId: row.role.id,
      roleKey: row.role.key,
      roleName: row.role.name,
      isAdmin: row.role.isAdmin,
      permissions: (row.role.permissions ?? {}) as Record<string, string[]>,
      fieldSecurity: (row.role.fieldSecurity ?? {}) as Record<string, string>,
      discountAuthorityBps: row.role.discountAuthorityBps,
    };
  };

  return {
    db: handle.db,
    close: handle.close,
    as,
    ctx: async (email?: string) => {
      if (!email) return { source: 'seed', user: null };
      const user = await as(email);
      return { source: 'ui', user: { id: user.id } };
    },
  };
}
