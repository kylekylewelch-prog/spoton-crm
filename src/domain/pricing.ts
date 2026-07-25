import {
  addDays,
  daysBetween,
  type IsoDate,
  minDate,
  termDays,
  termEndDate,
} from './dates';
import {
  applyBps,
  applyDiscount,
  BPS,
  discountBpsFrom,
  prorate,
  ratioBps,
  roundHalfUp,
} from './money';
import type { LineAction, PricedLine, RampYear } from './types';

/**
 * Pricing, proration and co-termination.
 *
 * The distinction this module exists to maintain: what a change is *worth per
 * year* is not the same number as what the customer is *billed now*. A seat
 * added four months before the term ends is billed for a third of a year but
 * renews at the full annual rate. Confusing the two is the classic way a
 * subscription business under-reports expansion ARR and then under-quotes its
 * own renewals.
 */

export type PriceBookEntryLike = {
  id: string;
  productId: string;
  listUnitCents: number;
  minQuantity: number;
  maxQuantity: number | null;
  termMonths: number;
  multiYearDiscountBps: number;
  includedVolume: number | null;
  overageUnitCents: number | null;
  active?: boolean;
};

/**
 * Picks the most specific applicable entry: exact term match beats a fallback
 * term, and a tighter quantity band beats a looser one.
 */
export function selectPriceBookEntry(
  entries: PriceBookEntryLike[],
  productId: string,
  quantity: number,
  termMonths: number,
): PriceBookEntryLike | null {
  const candidates = entries.filter(
    (e) =>
      e.productId === productId &&
      e.active !== false &&
      quantity >= e.minQuantity &&
      (e.maxQuantity === null || quantity <= e.maxQuantity),
  );
  if (candidates.length === 0) return null;

  const scored = candidates.map((e) => {
    const bandWidth = (e.maxQuantity ?? Number.MAX_SAFE_INTEGER) - e.minQuantity;
    return {
      e,
      exactTerm: e.termMonths === termMonths ? 0 : 1,
      termDistance: Math.abs(e.termMonths - termMonths),
      bandWidth,
    };
  });

  scored.sort(
    (a, b) =>
      a.exactTerm - b.exactTerm ||
      a.termDistance - b.termDistance ||
      a.bandWidth - b.bandWidth ||
      b.e.minQuantity - a.e.minQuantity,
  );

  return scored[0].e;
}

/**
 * Proration factor for a line, in basis points of a full year.
 *
 * A 12-month line is 10000. A line co-termed onto a subscription with 118 days
 * left is 118/365 of a year. Usage is measured in days, not months, because
 * that is how the invoice will actually be cut.
 */
export function prorationFactorBps(startDate: IsoDate, endDate: IsoDate): number {
  const days = termDays(startDate, endDate);
  const yearDays = 365;
  return ratioBps(days, yearDays);
}

/** Days remaining on a term, inclusive of the effective date. */
export function remainingDays(effectiveDate: IsoDate, endDate: IsoDate): number {
  return Math.max(0, daysBetween(effectiveDate, endDate) + 1);
}

/**
 * Co-termination.
 *
 * A mid-term addition never gets its own independent end date — it is snapped to
 * the parent subscription's end date so the account has exactly one renewal
 * event. The returned `prorationFactorBps` is what the stub period is billed at,
 * while the annual rate stays intact for the renewal.
 */
export function coTerm(
  effectiveDate: IsoDate,
  subscriptionEndDate: IsoDate,
): {
  startDate: IsoDate;
  endDate: IsoDate;
  remainingDays: number;
  prorationFactorBps: number;
  isCoTermed: boolean;
} {
  const startDate = effectiveDate;
  const endDate = subscriptionEndDate;
  const days = remainingDays(startDate, endDate);
  return {
    startDate,
    endDate,
    remainingDays: days,
    prorationFactorBps: days === 0 ? 0 : ratioBps(days, 365),
    isCoTermed: true,
  };
}

export type PriceLineInput = {
  productId: string;
  action?: LineAction;
  quantity: number;
  priorQuantity?: number;
  /** Overrides the price book when a negotiated unit price is entered directly. */
  netUnitCentsOverride?: number;
  /** Seller-applied discount, on top of any program discount from the book. */
  discountBps?: number;
  termMonths: number;
  startDate: IsoDate;
  /** Supply to co-term; otherwise derived from `termMonths`. */
  endDate?: IsoDate;
  isRecurring?: boolean;
  rampSchedule?: RampYear[] | null;
  minCommitVolume?: number | null;
  replacesSubscriptionItemId?: string | null;
};

/**
 * Prices a single line.
 *
 * `arrCents` is the annual run rate of the line as configured. `annualizedArrCents`
 * is the same figure with any ramp resolved to its final-year rate — that is the
 * number the renewal inherits. `proratedAmountCents` is the cash for the period
 * actually covered.
 */
export function priceLine(
  input: PriceLineInput,
  entry: PriceBookEntryLike | null,
): PricedLine {
  const isRecurring = input.isRecurring ?? true;
  const listUnitCents = entry?.listUnitCents ?? 0;
  const programDiscountBps = entry?.multiYearDiscountBps ?? 0;

  const endDate = input.endDate ?? termEndDate(input.startDate, input.termMonths);

  // A negotiated unit price implies its own discount; otherwise apply the
  // program discount from the book and then the seller's discount on top.
  let netUnitCents: number;
  let discountBps: number;

  if (input.netUnitCentsOverride !== undefined) {
    netUnitCents = input.netUnitCentsOverride;
    discountBps = discountBpsFrom(listUnitCents, netUnitCents);
  } else {
    const afterProgram = applyDiscount(listUnitCents, programDiscountBps);
    netUnitCents = applyDiscount(afterProgram, input.discountBps ?? 0);
    discountBps = discountBpsFrom(listUnitCents, netUnitCents);
  }

  const proration = prorationFactorBps(input.startDate, endDate);
  const action: LineAction = input.action ?? 'add';

  // Quantity that actually moves the run rate. A quantity increase on an
  // existing item only contributes the delta.
  const deltaQuantity =
    action === 'increase' || action === 'decrease'
      ? input.quantity - (input.priorQuantity ?? 0)
      : action === 'remove'
        ? -(input.priorQuantity ?? input.quantity)
        : input.quantity;

  const annualRate = isRecurring ? netUnitCents * deltaQuantity : 0;
  const rampedAnnual = input.rampSchedule?.length
    ? finalRampYearArr(input.rampSchedule)
    : annualRate;

  // Non-recurring lines (services, one-time fees) carry no ARR at all.
  const arrCents = isRecurring ? annualRate : 0;
  const annualizedArrCents = isRecurring ? rampedAnnual : 0;

  /**
   * A whole number of contractual years bills at exactly that many annual
   * amounts. Only genuine stub periods are prorated by day count — otherwise a
   * leap-year term would invoice 366/365 of the agreed price.
   */
  const spanDays = termDays(input.startDate, endDate);
  const isWholeYearTerm =
    input.termMonths % 12 === 0 && endDate === termEndDate(input.startDate, input.termMonths);
  const wholeYears = input.termMonths / 12;

  /**
   * What is invoiced for the first period, which is never more than a year's
   * worth. Co-terming onto a multi-year subscription can leave 900 days on the
   * term: the full value of those days is real, but it belongs in TCV, not in the
   * amount billed now. Conflating the two overstates immediate cash and makes
   * "billed now" larger than the annual price, which is nonsense on its face.
   */
  const firstPeriodDays = Math.min(spanDays, 365);

  const proratedAmountCents = isRecurring
    ? isWholeYearTerm
      ? annualRate
      : prorate(annualRate, firstPeriodDays, 365)
    : netUnitCents * deltaQuantity;

  const tcvCents = isRecurring
    ? input.rampSchedule?.length
      ? rampTcv(input.rampSchedule)
      : isWholeYearTerm
        ? annualRate * wholeYears
        : prorate(annualRate, spanDays, 365)
    : netUnitCents * deltaQuantity;

  return {
    productId: input.productId,
    action,
    quantity: input.quantity,
    priorQuantity: input.priorQuantity,
    listUnitCents,
    netUnitCents,
    discountBps,
    programDiscountBps,
    termMonths: input.termMonths,
    startDate: input.startDate,
    endDate,
    prorationFactorBps: proration,
    arrCents,
    annualizedArrCents,
    proratedAmountCents,
    tcvCents,
    rampSchedule: input.rampSchedule ?? null,
    minCommitVolume: input.minCommitVolume ?? null,
    overageUnitCents: entry?.overageUnitCents ?? null,
    replacesSubscriptionItemId: input.replacesSubscriptionItemId ?? null,
    isRecurring,
  };
}

/** Annual value of the last ramp year — the rate the renewal starts from. */
export function finalRampYearArr(ramp: RampYear[]): number {
  const last = [...ramp].sort((a, b) => a.year - b.year).at(-1);
  return last ? last.netUnitCents * last.quantity : 0;
}

/** Total contract value across every ramp year. */
export function rampTcv(ramp: RampYear[]): number {
  return ramp.reduce((sum, y) => sum + y.netUnitCents * y.quantity, 0);
}

/**
 * Builds a ramp schedule from a starting quantity and per-year growth, applying
 * a multi-year discount that increases with commitment length.
 */
export function buildRamp(
  years: number,
  startQuantity: number,
  netUnitCents: number,
  growthBpsPerYear: number,
  multiYearDiscountBps = 0,
): RampYear[] {
  const out: RampYear[] = [];
  let quantity = startQuantity;
  const discountedUnit = applyDiscount(netUnitCents, multiYearDiscountBps);
  for (let y = 1; y <= years; y++) {
    out.push({ year: y, quantity, netUnitCents: discountedUnit });
    quantity = quantity + applyBps(quantity, growthBpsPerYear);
  }
  return out;
}

export type QuoteTotals = {
  listTotalCents: number;
  discountTotalCents: number;
  netTotalCents: number;
  effectiveDiscountBps: number;
  arrCents: number;
  annualizedArrCents: number;
  proratedAmountCents: number;
  tcvCents: number;
  prorationFactorBps: number;
};

/**
 * Rolls a set of priced lines into quote totals.
 *
 * The blended `effectiveDiscountBps` is what the approval matrix evaluates —
 * deliberately measured against list across the whole quote, so a deal cannot
 * escape approval by concentrating the discount on one small line.
 */
export function totalQuote(lines: PricedLine[]): QuoteTotals {
  let listTotalCents = 0;
  let netTotalCents = 0;
  let arrCents = 0;
  let annualizedArrCents = 0;
  let proratedAmountCents = 0;
  let tcvCents = 0;

  for (const l of lines) {
    const gross = l.listUnitCents * Math.abs(effectiveQuantity(l));
    listTotalCents += gross;
    netTotalCents += l.netUnitCents * Math.abs(effectiveQuantity(l));
    arrCents += l.arrCents;
    annualizedArrCents += l.annualizedArrCents;
    proratedAmountCents += l.proratedAmountCents;
    tcvCents += l.tcvCents;
  }

  const discountTotalCents = listTotalCents - netTotalCents;
  const effectiveDiscountBps =
    listTotalCents > 0 ? ratioBps(discountTotalCents, listTotalCents) : 0;

  const prorationFactorBps =
    arrCents !== 0 ? ratioBps(proratedAmountCents, arrCents) : BPS;

  return {
    listTotalCents,
    discountTotalCents,
    netTotalCents,
    effectiveDiscountBps,
    arrCents,
    annualizedArrCents,
    proratedAmountCents,
    tcvCents,
    prorationFactorBps,
  };
}

function effectiveQuantity(l: PricedLine): number {
  if (l.action === 'increase' || l.action === 'decrease') {
    return l.quantity - (l.priorQuantity ?? 0);
  }
  if (l.action === 'remove') return -(l.priorQuantity ?? l.quantity);
  return l.quantity;
}

/** Monthly recurring revenue derived from an annual figure. */
export function mrrFromArr(arrCents: number): number {
  return roundHalfUp(arrCents / 12);
}

/** Usage overage charge for a period. */
export function overageCharge(
  usedVolume: number,
  includedVolume: number,
  overageUnitCents: number,
): number {
  const over = Math.max(0, usedVolume - includedVolume);
  return over * overageUnitCents;
}

/**
 * Renewal price with contractual uplift, honouring any negotiated cap.
 */
export function applyUplift(
  currentArrCents: number,
  upliftBps: number,
  capBps?: number | null,
): { newArrCents: number; upliftArrCents: number; appliedBps: number } {
  const appliedBps =
    capBps !== null && capBps !== undefined ? Math.min(upliftBps, capBps) : upliftBps;
  const upliftArrCents = applyBps(currentArrCents, appliedBps);
  return {
    newArrCents: currentArrCents + upliftArrCents,
    upliftArrCents,
    appliedBps,
  };
}

/**
 * Splits a term into billing periods, which the billing schedule and the
 * invoice reconciliation report both consume.
 */
export function billingSchedule(
  startDate: IsoDate,
  endDate: IsoDate,
  frequency: 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'upfront',
  totalCents: number,
): { periodStart: IsoDate; periodEnd: IsoDate; amountCents: number }[] {
  if (frequency === 'upfront') {
    return [{ periodStart: startDate, periodEnd: endDate, amountCents: totalCents }];
  }

  const monthsPer = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 }[frequency];
  const totalDays = termDays(startDate, endDate);
  const periods: { periodStart: IsoDate; periodEnd: IsoDate; days: number }[] = [];

  let cursor = startDate;
  while (cursor <= endDate) {
    const rawEnd = addDays(addMonthsSafe(cursor, monthsPer), -1);
    const periodEnd = minDate(rawEnd, endDate);
    periods.push({
      periodStart: cursor,
      periodEnd,
      days: termDays(cursor, periodEnd),
    });
    cursor = addDays(periodEnd, 1);
  }

  // Allocate by day count so the parts sum exactly to the total.
  const amounts = allocateByDays(totalCents, periods.map((p) => p.days), totalDays);
  return periods.map((p, i) => ({
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    amountCents: amounts[i],
  }));
}

function addMonthsSafe(d: IsoDate, months: number): IsoDate {
  // Local import avoidance: dates.addMonths already clamps end-of-month.
  const [y, m, day] = d.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function allocateByDays(total: number, days: number[], _totalDays: number): number[] {
  const sum = days.reduce((a, b) => a + b, 0);
  if (sum === 0) return days.map(() => 0);
  const exact = days.map((d) => (total * d) / sum);
  const floored = exact.map(Math.floor);
  let rem = total - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floored];
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) out[order[k].i]++;
  return out;
}
