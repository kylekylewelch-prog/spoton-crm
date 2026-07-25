/**
 * Brand marks.
 *
 * The mark is inline SVG so it inherits colour and scales crisply; the wordmark is
 * live text so it picks up the display face the rest of the interface uses.
 */

export function SpotOnMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <rect width="64" height="64" fill="var(--color-ink-900)" />
      <g stroke="var(--color-bone-100)" strokeWidth="3">
        <path d="M32 2v7M32 55v7M2 32h7M55 32h7" />
      </g>
      <circle
        cx="32"
        cy="32"
        r="23"
        fill="none"
        stroke="var(--color-signal-500)"
        strokeWidth="6"
        strokeDasharray="100 20"
        transform="rotate(-58 32 32)"
      />
      <circle cx="32" cy="32" r="12.5" fill="none" stroke="var(--color-alarm-500)" strokeWidth="6" />
      <circle cx="32" cy="32" r="4.5" fill="var(--color-signal-500)" />
    </svg>
  );
}

export function SpotOnLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
      <SpotOnMark size={compact ? 26 : 34} />
      {!compact && (
        <div style={{ lineHeight: 1 }}>
          <div
            className="display"
            style={{ fontSize: '1.375rem', letterSpacing: '0.01em' }}
          >
            SPOT<span style={{ color: 'var(--color-signal-500)' }}>ON</span>
          </div>
          <div
            style={{
              height: 2,
              width: '100%',
              background: 'var(--color-alarm-500)',
              margin: '3px 0 3px',
            }}
          />
          <div
            style={{
              fontSize: '0.5rem',
              letterSpacing: '0.22em',
              color: 'var(--fg-muted)',
              fontWeight: 700,
            }}
          >
            REVENUE OS
          </div>
        </div>
      )}
    </div>
  );
}
