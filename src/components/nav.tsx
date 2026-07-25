'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { SpotOnLogo } from './brand';

export type NavItem = { href: string; label: string; badge?: number };
export type NavSection = { label: string; items: NavItem[] };

/**
 * The application shell navigation.
 *
 * Workspaces come first because that is where work happens; the full object
 * catalogue is grouped below it, generated from the object registry, so every
 * registered object is reachable without a bespoke screen.
 */
export function Nav({
  sections,
  user,
  onSignOut,
}: {
  sections: NavSection[];
  user: { name: string; roleName: string; email: string };
  onSignOut: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="btn"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'none',
          position: 'fixed',
          top: '0.5rem',
          left: '0.5rem',
          zIndex: 50,
        }}
        data-mobile-toggle
      >
        Menu
      </button>

      <nav
        aria-label="Primary"
        style={{
          width: 232,
          flexShrink: 0,
          borderRight: '1px solid var(--rule)',
          background: 'var(--bg-raised)',
          height: '100vh',
          position: 'sticky',
          top: 0,
          overflowY: 'auto',
          display: open ? 'block' : undefined,
        }}
      >
        <div style={{ padding: '0.875rem', borderBottom: '1px solid var(--rule)' }}>
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <SpotOnLogo />
          </Link>
        </div>

        {sections.map((section) => (
          <div key={section.label} style={{ padding: '0.75rem 0 0.25rem' }}>
            <div className="eyebrow" style={{ padding: '0 0.875rem 0.375rem' }}>
              {section.label}
            </div>
            <ul style={{ listStyle: 'none' }}>
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(`${item.href}/`));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                        padding: '0.3125rem 0.875rem',
                        fontSize: '0.75rem',
                        textDecoration: 'none',
                        color: active ? 'var(--color-ink-900)' : 'var(--fg)',
                        background: active ? 'var(--color-signal-500)' : 'transparent',
                        fontWeight: active ? 700 : 500,
                        borderLeft: active
                          ? '3px solid var(--color-alarm-500)'
                          : '3px solid transparent',
                      }}
                    >
                      <span>{item.label}</span>
                      {item.badge ? (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.625rem',
                            fontWeight: 700,
                            background: active ? 'var(--color-ink-900)' : 'var(--color-alarm-500)',
                            color: active ? 'var(--color-signal-500)' : '#fff',
                            padding: '0 4px',
                            minWidth: 18,
                            textAlign: 'center',
                          }}
                        >
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div
          style={{
            borderTop: '1px solid var(--rule)',
            padding: '0.75rem 0.875rem',
            marginTop: '0.5rem',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 700 }}>{user.name}</div>
          <div style={{ fontSize: '0.625rem', color: 'var(--fg-muted)', marginBottom: '0.5rem' }}>
            {user.roleName}
          </div>
          {onSignOut}
        </div>
      </nav>
    </>
  );
}

export function ThemeToggle() {
  return (
    <button
      className="btn"
      onClick={() => {
        const root = document.documentElement;
        const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        root.setAttribute('data-theme', next);
        try {
          localStorage.setItem('spoton-theme', next);
        } catch {
          /* storage unavailable — the toggle still works for this session */
        }
      }}
      title="Toggle light and dark"
    >
      Theme
    </button>
  );
}
