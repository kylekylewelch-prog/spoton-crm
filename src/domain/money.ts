/**
 * Money and rate primitives.
 *
 * All amounts are integer cents; all rates are integer basis points. Rounding is
 * explicit and half-up at every step, which is what keeps an ARR waterfall
 * summing to the penny instead of drifting.
 */

export const BPS = 10_000;

export function roundHalfUp(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Applies a basis-point rate to an amount. */
export function applyBps(amountCents: number, rateBps: number): number {
  return roundHalfUp((amountCents * rateBps) / BPS);
}

/** Reduces an amount by a discount expressed in basis points. */
export function applyDiscount(amountCents: number, discountBps: number): number {
  return amountCents - applyBps(amountCents, discountBps);
}

/** Discount implied by a net price against list, in basis points. */
export function discountBpsFrom(listCents: number, netCents: number): number {
  if (listCents <= 0) return 0;
  return roundHalfUp(((listCents - netCents) / listCents) * BPS);
}

export function ratioBps(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return roundHalfUp((numerator / denominator) * BPS);
}

/**
 * Prorates an amount by an exact ratio.
 *
 * Deliberately not `applyBps(amount, ratioBps(...))`: rounding the ratio to whole
 * basis points first loses real cents on large amounts (92/365 of $120,000 is
 * $30,246.58, but via a 2521 bps intermediate it becomes $30,252.00). Proration
 * feeds invoices, so it is computed in one step from the raw numerator and
 * denominator and rounded exactly once, at the end.
 */
export function prorate(amountCents: number, numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return roundHalfUp((amountCents * numerator) / denominator);
}

/**
 * Distributes an amount across weights without losing or inventing cents.
 * The largest-remainder method assigns leftover cents to the entries with the
 * biggest fractional parts, so the parts always sum exactly to the whole.
 */
export function allocate(amountCents: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (amountCents * w) / totalWeight);
  const floored = exact.map((v) => Math.floor(v));
  let remainder = amountCents - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const out = [...floored];
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    out[order[k].i] += 1;
  }
  return out;
}

/** Splits basis-point weights so they total exactly 10000. */
export function normaliseBps(weights: number[]): number[] {
  return allocate(BPS, weights);
}

export function centsToNumber(cents: number): number {
  return cents / 100;
}

const COMPACT_UNITS = [
  { limit: 1e12, suffix: 'T' },
  { limit: 1e9, suffix: 'B' },
  { limit: 1e6, suffix: 'M' },
  { limit: 1e3, suffix: 'K' },
] as const;

/**
 * Formats an amount for display.
 *
 * Compaction is done here rather than handed to `Intl`'s `notation: 'compact'`,
 * which renders trailing fraction digits differently across ICU versions — the
 * same call yields "$125.0K" on Node 22 and "$125K" on Node 24. A money figure
 * that changes shape with the runtime is not acceptable in a dashboard tile or an
 * MCP response, so the scale and the digits are decided here and `Intl` is left
 * to do only what it is reliable at: the currency symbol and thousands grouping.
 */
export function formatMoney(
  cents: number,
  currency = 'USD',
  opts: { compact?: boolean; decimals?: boolean } = {},
): string {
  const value = cents / 100;

  if (opts.compact) {
    const magnitude = Math.abs(value);
    for (const unit of COMPACT_UNITS) {
      if (magnitude >= unit.limit) {
        const scaled = value / unit.limit;
        // One decimal below 100 ("$1.3M"), none above it ("$125K"), and never a
        // trailing zero, because minimumFractionDigits is pinned to 0.
        const formatted = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency,
          minimumFractionDigits: 0,
          maximumFractionDigits: Math.abs(scaled) < 100 ? 1 : 0,
        }).format(scaled);
        return `${formatted}${unit.suffix}`;
      }
    }
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: opts.decimals ? 2 : 0,
  }).format(value);
}

export function formatBps(bps: number, decimals = 1): string {
  return `${(bps / 100).toFixed(decimals)}%`;
}

/** Converts to the reporting currency using a decimal rate string from fx_rates. */
export function convertCents(cents: number, rate: string | number): number {
  return roundHalfUp(cents * Number(rate));
}
