import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSession, SESSION_COOKIE, type AuthenticatedUser } from './auth';
import type { AuditContext } from './audit';

/**
 * Request-scoped session access for server components and server actions.
 */

export async function currentUser(): Promise<AuthenticatedUser | null> {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
}

/** Redirects to the sign-in page when there is no live session. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export async function auditContext(source: AuditContext['source'] = 'ui'): Promise<AuditContext> {
  const user = await currentUser();
  return { user: user ? { id: user.id } : null, source };
}
