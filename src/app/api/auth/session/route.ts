import { NextResponse } from 'next/server';
import { authenticate, resolveSession, revokeSession, SESSION_COOKIE } from '@/server/auth';
import { recordAudit } from '@/server/audit';

export const dynamic = 'force-dynamic';

/**
 * Session endpoint for API clients.
 *
 * The browser signs in through a server action; integrations, scripts and test
 * harnesses need a documented HTTP route. It returns the same opaque session token
 * the cookie carries, so an API client and a browser session are the same thing to
 * every downstream permission and audit check — there is no second, weaker auth path.
 *
 *   POST   /api/auth/session   { email, password }  → { token, user }
 *   GET    /api/auth/session   (cookie or bearer)   → { user }
 *   DELETE /api/auth/session                        → revokes the session
 */

function bearer(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}

function cookieToken(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1];
}

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  if (!body.email || !body.password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  const result = await authenticate(body.email, body.password);
  if ('error' in result) {
    // Deliberately vague, and deliberately the same for unknown users.
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  await recordAudit(
    { user: { id: result.user.id }, source: 'api' },
    { objectType: 'users', recordId: result.user.id, action: 'login' },
  );

  const response = NextResponse.json({
    token: result.token,
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.roleKey,
      roleName: result.user.roleName,
      discountAuthorityBps: result.user.discountAuthorityBps,
    },
  });

  response.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60,
  });

  return response;
}

export async function GET(request: Request) {
  const token = bearer(request) ?? cookieToken(request);
  const user = await resolveSession(token);
  if (!user) return NextResponse.json({ error: 'No active session' }, { status: 401 });

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.roleKey,
      roleName: user.roleName,
    },
  });
}

export async function DELETE(request: Request) {
  const token = bearer(request) ?? cookieToken(request);
  if (token) await revokeSession(token);

  const response = NextResponse.json({ revoked: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
