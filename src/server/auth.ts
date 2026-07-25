import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { roles, sessions, users } from '@/db/schema';

/**
 * Authentication.
 *
 * Passwords use scrypt from the Node standard library — no native build step, no
 * extra dependency to keep patched. Session tokens are random 32-byte values and
 * only their SHA-256 hash is stored, so a database leak does not hand over live
 * sessions.
 */

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expectedBuf = Buffer.from(expected, 'hex');
  if (expectedBuf.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuf);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  title: string | null;
  teamId: string | null;
  managerId: string | null;
  region: string | null;
  roleId: string;
  roleKey: string;
  roleName: string;
  isAdmin: boolean;
  permissions: Record<string, string[]>;
  fieldSecurity: Record<string, string>;
  discountAuthorityBps: number;
};

async function loadUser(userId: string): Promise<AuthenticatedUser | null> {
  const db = await getDb();
  const rows = await db
    .select({ user: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.id, userId), eq(users.active, true)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

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
}

export async function authenticate(
  email: string,
  password: string,
): Promise<{ user: AuthenticatedUser; token: string } | { error: string }> {
  const db = await getDb();
  const found = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);

  const record = found[0];
  // Same message either way — never reveal whether an address exists.
  if (!record || !record.active) return { error: 'Invalid email or password' };
  if (!verifyPassword(password, record.passwordHash)) {
    return { error: 'Invalid email or password' };
  }

  const user = await loadUser(record.id);
  if (!user) return { error: 'Invalid email or password' };

  const token = randomBytes(32).toString('hex');
  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  return { user, token };
}

export async function resolveSession(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
      ),
    )
    .limit(1);

  if (!rows[0]) return null;
  return loadUser(rows[0].userId);
}

export async function revokeSession(token: string): Promise<void> {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(token)));
}

/** Used by the MCP HTTP transport, which authenticates as a service principal. */
export async function resolveIntegrationUser(email: string): Promise<AuthenticatedUser | null> {
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ? loadUser(rows[0].id) : null;
}

export const SESSION_COOKIE = 'spoton_session';
