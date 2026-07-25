/** Display helpers safe to use in client components. */

export function money(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function moneyCompact(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—';
  const v = cents / 100;
  if (Math.abs(v) < 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(v);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(v);
}

export function signedMoney(cents: number, currency = 'USD'): string {
  const s = moneyCompact(Math.abs(cents), currency);
  return cents < 0 ? `−${s}` : cents > 0 ? `+${s}` : s;
}

export function pct(bps: number | null | undefined, decimals = 1): string {
  if (bps === null || bps === undefined) return '—';
  return `${(bps / 100).toFixed(decimals)}%`;
}

export function multiple(bps: number | null | undefined, decimals = 1): string {
  if (bps === null || bps === undefined) return '—';
  return `${(bps / 10_000).toFixed(decimals)}x`;
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value.length <= 10 ? `${value}T00:00:00Z` : value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—';
  if (days === 0) return 'today';
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d overdue`;
}

/** snake_case or camelCase to Title Case. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function truncate(value: string | null | undefined, max = 60): string {
  if (!value) return '—';
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Tag class for a status-ish value, so colour is consistent across screens. */
export function tagClass(value: string | null | undefined): string {
  if (!value) return 'tag';
  const v = String(value).toLowerCase();

  if (['closed_won', 'renewed', 'auto_renewed', 'approved', 'accepted', 'active', 'excellent', 'good', 'met', 'succeeded', 'commit', 'paid', 'resolved', 'closed', 'completed', 'granted', 'connected'].includes(v)) {
    return 'tag tag-good';
  }
  if (['closed_lost', 'churned', 'rejected', 'critical', 'breached', 'dead_letter', 'failed', 'delinquent', 'omitted', 'escalated', 'urgent', 'blocker'].includes(v)) {
    return 'tag tag-alarm';
  }
  if (['negotiation', 'contract', 'in_approval', 'quoted', 'committed', 'best_case', 'high', 'poor', 'late', 'retrying', 'degraded', 'pending_customer', 'at_risk', 'blocked'].includes(v)) {
    return 'tag tag-warn';
  }
  if (['proposal', 'solution_design', 'discovery', 'srl', 'pipeline', 'in_progress', 'working', 'mql', 'open', 'new', 'fair', 'medium', 'running', 'pending', 'draft'].includes(v)) {
    return 'tag tag-info';
  }
  if (['re_nurture', 'nurture', 'omitted', 'low', 'not_started', 'skipped', 'expired', 'superseded'].includes(v)) {
    return 'tag';
  }
  return 'tag';
}

export function healthClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'tag';
  if (score >= 85) return 'tag tag-good';
  if (score >= 70) return 'tag tag-good';
  if (score >= 55) return 'tag tag-info';
  if (score >= 40) return 'tag tag-warn';
  return 'tag tag-alarm';
}
