import Link from 'next/link';
import { moneyCompact, pct, tagClass } from '@/lib/format';

/**
 * Presentation primitives.
 *
 * Deliberately thin: hard edges, hairline rules and one accent colour doing the
 * emphatic work, matching the house style declared in globals.css.
 */

export function Panel({
  title,
  action,
  children,
  eyebrow,
  className = '',
}: {
  title?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <header className="panel-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2 className="panel-title">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'signal' | 'good' | 'alarm' | 'warn';
  href?: string;
}) {
  const accent =
    tone === 'signal'
      ? 'var(--color-signal-500)'
      : tone === 'good'
        ? 'var(--color-good-400)'
        : tone === 'alarm'
          ? 'var(--color-alarm-400)'
          : tone === 'warn'
            ? 'var(--color-warn-500)'
            : 'var(--fg)';

  const body = (
    <div
      className="panel"
      style={{ padding: '0.75rem 0.875rem', borderLeft: `3px solid ${accent}`, height: '100%' }}
    >
      <div className="eyebrow">{label}</div>
      <div
        className="display"
        style={{ fontSize: '1.5rem', marginTop: '0.375rem', color: accent }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)', marginTop: '0.25rem' }}>
          {sub}
        </div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function Tag({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
  return <span className={tagClass(value)}>{label ?? value.replace(/_/g, ' ')}</span>;
}

/** Horizontal bar used for pipeline, health and waterfall breakdowns. */
export function Bar({
  segments,
  height = 10,
}: {
  segments: { label: string; value: number; color: string }[];
  height?: number;
}) {
  const total = segments.reduce((s, x) => s + Math.abs(x.value), 0);
  if (total === 0) {
    return <div style={{ height, background: 'var(--bg-inset)', border: '1px solid var(--rule)' }} />;
  }
  return (
    <div style={{ display: 'flex', height, border: '1px solid var(--rule)' }}>
      {segments.map((seg) => (
        <div
          key={seg.label}
          title={`${seg.label}: ${moneyCompact(seg.value)}`}
          style={{
            width: `${(Math.abs(seg.value) / total) * 100}%`,
            background: seg.color,
          }}
        />
      ))}
    </div>
  );
}

export function Meter({
  valueBps,
  tone = 'signal',
  label,
}: {
  valueBps: number;
  tone?: 'signal' | 'good' | 'alarm' | 'warn';
  label?: string;
}) {
  const colour =
    tone === 'good'
      ? 'var(--color-good-500)'
      : tone === 'alarm'
        ? 'var(--color-alarm-500)'
        : tone === 'warn'
          ? 'var(--color-warn-500)'
          : 'var(--color-signal-500)';

  const clamped = Math.max(0, Math.min(10_000, valueBps));

  return (
    <div>
      <div
        style={{
          height: 8,
          background: 'var(--bg-inset)',
          border: '1px solid var(--rule)',
          position: 'relative',
        }}
      >
        <div style={{ width: `${clamped / 100}%`, height: '100%', background: colour }} />
      </div>
      {label && (
        <div style={{ fontSize: '0.625rem', color: 'var(--fg-muted)', marginTop: 2 }}>
          {label} · {pct(valueBps, 0)}
        </div>
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '1.5rem 0.875rem',
        color: 'var(--fg-muted)',
        fontSize: '0.8125rem',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '1rem',
        marginBottom: '1rem',
        paddingBottom: '0.75rem',
        borderBottom: '2px solid var(--color-signal-500)',
        flexWrap: 'wrap',
      }}
    >
      <div>
        <h1 style={{ fontSize: '1.625rem' }}>{title}</h1>
        {subtitle && (
          <p
            style={{
              color: 'var(--fg-muted)',
              fontSize: '0.8125rem',
              marginTop: '0.375rem',
              maxWidth: '68ch',
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

export function Grid({
  cols = 4,
  gap = '0.75rem',
  children,
}: {
  cols?: number;
  gap?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${Math.floor(1100 / cols)}px, 1fr))`,
        gap,
      }}
    >
      {children}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '0.625rem 1.25rem',
        padding: '0.875rem',
      }}
    >
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`}>
          <dt className="eyebrow">{item.label}</dt>
          <dd style={{ fontSize: '0.8125rem', marginTop: '0.125rem', wordBreak: 'break-word' }}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
