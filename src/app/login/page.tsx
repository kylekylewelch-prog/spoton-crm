'use client';

import { useActionState } from 'react';
import { signIn } from './actions';
import { SpotOnMark } from '@/components/brand';

const DEMO_LOGINS = [
  { email: 'admin@spoton.dev', role: 'Administrator — full access' },
  { email: 'ae@spoton.dev', role: 'Account Executive — scoped writes, 10% discount authority' },
  { email: 'renewals@spoton.dev', role: 'Renewal Manager — renewal desk' },
  { email: 'csm@spoton.dev', role: 'Customer Success Manager — health and risk' },
  { email: 'dealdesk@spoton.dev', role: 'Deal Desk — quoting and approvals' },
  { email: 'support@spoton.dev', role: 'Support Engineer — tickets, revenue figures hidden' },
  { email: 'cro@spoton.dev', role: 'CRO — forecast and approvals' },
];

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: 880, display: 'grid', gap: '1rem' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1rem',
          }}
        >
          {/* --- sign in ---------------------------------------------------- */}
          <section className="panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <SpotOnMark size={44} />
              <div>
                <div className="display" style={{ fontSize: '1.75rem' }}>
                  SPOT<span style={{ color: 'var(--color-signal-500)' }}>ON</span>
                </div>
                <div
                  style={{
                    height: 3,
                    background: 'var(--color-alarm-500)',
                    margin: '4px 0',
                    width: 140,
                  }}
                />
                <div
                  style={{
                    fontSize: '0.5625rem',
                    letterSpacing: '0.22em',
                    color: 'var(--fg-muted)',
                    fontWeight: 700,
                  }}
                >
                  REVENUE OPERATING SYSTEM
                </div>
              </div>
            </div>

            <form action={action} style={{ marginTop: '1.5rem', display: 'grid', gap: '0.75rem' }}>
              <div>
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  className="field"
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  defaultValue="admin@spoton.dev"
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  className="field"
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  defaultValue="spoton"
                  required
                />
              </div>

              {state?.error && (
                <p
                  style={{
                    color: 'var(--color-alarm-400)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                  }}
                >
                  {state.error}
                </p>
              )}

              <button className="btn btn-primary" type="submit" disabled={pending}>
                {pending ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </section>

          {/* --- role explorer --------------------------------------------- */}
          <section className="panel">
            <header className="panel-head">
              <h2 className="panel-title">Seeded roles</h2>
            </header>
            <p
              style={{
                padding: '0.75rem 0.875rem 0',
                fontSize: '0.75rem',
                color: 'var(--fg-muted)',
              }}
            >
              Every account uses the password <strong style={{ color: 'var(--fg)' }}>spoton</strong>.
              Sign in as different roles to see object permissions, record scope and field-level
              security take effect.
            </p>
            <ul style={{ listStyle: 'none', padding: '0.75rem 0.875rem' }}>
              {DEMO_LOGINS.map((d) => (
                <li
                  key={d.email}
                  style={{
                    padding: '0.5rem 0',
                    borderBottom: '1px solid var(--rule)',
                    fontSize: '0.75rem',
                  }}
                >
                  <code style={{ color: 'var(--color-signal-500)', fontWeight: 700 }}>
                    {d.email}
                  </code>
                  <div style={{ color: 'var(--fg-muted)', marginTop: 2 }}>{d.role}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
