'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate, revokeSession, SESSION_COOKIE } from '@/server/auth';
import { recordAudit } from '@/server/audit';

export async function signIn(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) return { error: 'Enter an email address and password' };

  const result = await authenticate(email, password);
  if ('error' in result) return { error: result.error };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60,
  });

  await recordAudit(
    { user: { id: result.user.id }, source: 'ui' },
    { objectType: 'users', recordId: result.user.id, action: 'login' },
  );

  redirect('/');
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}
