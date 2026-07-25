import { addDays, type IsoDate, termDays, termEndDate } from './dates';
import { applyBps, prorate, ratioBps, roundHalfUp } from './money';
import { coTerm, mrrFromArr, prorationFactorBps } from './pricing';
import type { AmendmentType, PricedLine } from './types';

/**
 * Subscription state transitions.
 *
 * A subscription is a versioned aggregate: items are never edited in place, they
 * are added and retired by amendments, so the run rate at any past date is
 * reconstructable and the renewal always knows exactly what it inherits.
 */

export type SubscriptionItemState = {
  id: string;
  productId: string;
  status: 'active' | 'pending' | 'removed';
  quantity: number;
  listUnitCents: number;
  netUnitCents: number;
  discountBps: number;
  arrCents: number;
  annualizedArrCents: number;
  startDate: IsoDate;
  endDate: IsoDate;
  isCoTermed: boolean;
  prorationFactorBps: number;
  addedByAmendmentId?: string | null;
  removedByAmendmentId?: string | null;
};

export type SubscriptionState = {
  id: string;
  startDate: IsoDate;
  endDate: IsoDate;
  termMonths: number;
  autoRenew: boolean;
  noticeDays: number;
  upliftBps: number;
  currentArrCents: number;
  currentMrrCents: number;
  originalArrCents: number;
  coTermedAdditionsArrCents: number;
  version: number;
  items: SubscriptionItemState[];
};

/** Live run rate: the sum of active items' annual value. */
export function computeArr(items: SubscriptionItemState[]): number {
  return items.filter((i) => i.status === 'active').reduce((sum, i) => sum + i.arrCents, 0);
}

/**
 * Annualised run rate — what the subscription is worth over a full year once
 * every co-termed stub has been normalised. This is the figure the renewal is
 * quoted from, and it is deliberately *not* the same as `computeArr` when
 * mid-term additions exist.
 */
export function computeAnnualizedArr(items: SubscriptionItemState[]): number {
  return items
    .filter((i) => i.status === 'active')
    .reduce((sum, i) => sum + (i.annualizedArrCents || i.arrCents), 0);
}

/** Remaining contract value from a given date to term end. */
export function remainingContractValue(
  sub: Pick<SubscriptionState, 'endDate' | 'currentArrCents'>,
  asOf: IsoDate,
): number {
  if (asOf > sub.endDate) return 0;
  return prorate(sub.currentArrCents, termDays(asOf, sub.endDate), 365);
}

export function noticeDateFor(endDate: IsoDate, noticeDays: number): IsoDate {
  return addDays(endDate, -noticeDays);
}

/* ----------------------------------------------------------------- amendments */

export type AmendmentPlan = {
  type: AmendmentType;
  effectiveDate: IsoDate;
  /** Always the parent subscription's end date for a mid-term change. */
  coTermEndDate: IsoDate;
  isCoTermed: boolean;
  prorationFactorBps: number;
  remainingDays: number;
  /** Signed change to the live run rate. */
  deltaArrCents: number;
  /** Full-year value of the change — what the renewal picks up. */
  annualizedArrCents: number;
  /** Cash invoiced for the stub period. */
  proratedAmountCents: number;
  arrBeforeCents: number;
  arrAfterCents: number;
  itemsAdded: PricedLine[];
  itemIdsRemoved: string[];
  /** Whether this change should be rolled into the next open renewal. */
  rollsIntoRenewal: boolean;
};

export type PlanAmendmentInput = {
  subscription: SubscriptionState;
  type: AmendmentType;
  effectiveDate: IsoDate;
  /** Lines already priced against the co-termed dates. */
  lines: PricedLine[];
  /** Subscription item ids being retired by this amendment. */
  removeItemIds?: string[];
};

/**
 * Plans a mid-term change.
 *
 * The two headline numbers are computed separately and both retained:
 *
 *   deltaArrCents      — immediate movement in the live run rate
 *   annualizedArrCents — the same change valued over a full year
 *
 * A cross-sell added with 118 days left on the term bills 118/365 of its annual
 * price now, moves ARR by its full annual amount from the effective date, and
 * contributes its full annual amount to the renewal. Every mid-term upsell and
 * cross-sell is co-termed to the parent end date so the account keeps exactly
 * one renewal event.
 */
export function planAmendment(input: PlanAmendmentInput): AmendmentPlan {
  const { subscription: sub, type, effectiveDate } = input;
  const removeIds = input.removeItemIds ?? [];

  const isMidTerm = effectiveDate > sub.startDate && effectiveDate <= sub.endDate;
  const ct = coTerm(effectiveDate, sub.endDate);

  const arrBeforeCents = computeArr(sub.items);

  const addedArr = input.lines.reduce((s, l) => s + l.arrCents, 0);
  const addedAnnualized = input.lines.reduce(
    (s, l) => s + (l.annualizedArrCents || l.arrCents),
    0,
  );
  const addedProrated = input.lines.reduce((s, l) => s + l.proratedAmountCents, 0);

  const removedArr = sub.items
    .filter((i) => removeIds.includes(i.id) && i.status === 'active')
    .reduce((s, i) => s + i.arrCents, 0);
  const removedAnnualized = sub.items
    .filter((i) => removeIds.includes(i.id) && i.status === 'active')
    .reduce((s, i) => s + (i.annualizedArrCents || i.arrCents), 0);

  const deltaArrCents = addedArr - removedArr;
  const annualizedArrCents = addedAnnualized - removedAnnualized;

  // A cancellation retires everything still active.
  const effectiveRemoveIds =
    type === 'cancellation'
      ? sub.items.filter((i) => i.status === 'active').map((i) => i.id)
      : removeIds;

  const cancellationArr =
    type === 'cancellation' ? -computeArr(sub.items) : deltaArrCents;
  const cancellationAnnualized =
    type === 'cancellation' ? -computeAnnualizedArr(sub.items) : annualizedArrCents;

  const finalDelta = type === 'cancellation' ? cancellationArr : deltaArrCents;
  const finalAnnualized =
    type === 'cancellation' ? cancellationAnnualized : annualizedArrCents;

  return {
    type,
    effectiveDate,
    coTermEndDate: sub.endDate,
    isCoTermed: isMidTerm && type !== 'renewal',
    prorationFactorBps: isMidTerm ? ct.prorationFactorBps : 10_000,
    remainingDays: ct.remainingDays,
    deltaArrCents: finalDelta,
    annualizedArrCents: finalAnnualized,
    proratedAmountCents:
      type === 'cancellation'
        ? -prorate(computeArr(sub.items), ct.remainingDays, 365)
        : addedProrated,
    arrBeforeCents,
    arrAfterCents: arrBeforeCents + finalDelta,
    itemsAdded: input.lines,
    itemIdsRemoved: effectiveRemoveIds,
    /**
     * Expansions and contractions taken mid-term must reach the renewal at their
     * annual value; a renewal amendment is itself the renewal, and a cancellation
     * removes the renewal rather than feeding it.
     */
    rollsIntoRenewal:
      isMidTerm &&
      ['upsell', 'cross_sell', 'co_term_add', 'contraction', 'price_change', 'true_up'].includes(
        type,
      ),
  };
}

/**
 * Applies a planned amendment, returning the new subscription state.
 *
 * `coTermedAdditionsArrCents` accumulates the annualised value of every mid-term
 * change, which the renewal engine reads to compute renewable ARR.
 */
export function applyAmendment(
  sub: SubscriptionState,
  plan: AmendmentPlan,
  amendmentId: string,
  newItemIds: string[],
): SubscriptionState {
  const items: SubscriptionItemState[] = sub.items.map((i) =>
    plan.itemIdsRemoved.includes(i.id) && i.status === 'active'
      ? { ...i, status: 'removed' as const, removedByAmendmentId: amendmentId }
      : { ...i },
  );

  plan.itemsAdded.forEach((line, idx) => {
    items.push({
      id: newItemIds[idx],
      productId: line.productId,
      status: 'active',
      quantity: line.quantity,
      listUnitCents: line.listUnitCents,
      netUnitCents: line.netUnitCents,
      discountBps: line.discountBps,
      arrCents: line.arrCents,
      annualizedArrCents: line.annualizedArrCents || line.arrCents,
      startDate: line.startDate,
      endDate: line.endDate,
      isCoTermed: plan.isCoTermed,
      prorationFactorBps: line.prorationFactorBps,
      addedByAmendmentId: amendmentId,
    });
  });

  const currentArrCents = computeArr(items);

  return {
    ...sub,
    version: sub.version + 1,
    items,
    currentArrCents,
    currentMrrCents: mrrFromArr(currentArrCents),
    coTermedAdditionsArrCents: plan.rollsIntoRenewal
      ? sub.coTermedAdditionsArrCents + plan.annualizedArrCents
      : sub.coTermedAdditionsArrCents,
  };
}

/* -------------------------------------------------------------------- renewal */

export type RenewalTermPlan = {
  startDate: IsoDate;
  endDate: IsoDate;
  termMonths: number;
  noticeDate: IsoDate;
  /** Live ARR on the expiring subscription. */
  currentArrCents: number;
  /** Annualised value of mid-term additions carried forward. */
  coTermedAdditionsArrCents: number;
  /** currentArr normalised to a full year, plus co-termed additions. */
  renewableArrCents: number;
  upliftBps: number;
  upliftArrCents: number;
  /** renewableArr + uplift — the opening ask. */
  expectedArrCents: number;
};

/**
 * Builds the renewal term for an expiring subscription.
 *
 * Renewable ARR is the annualised run rate, not the co-termed one. If a customer
 * added 40 seats with a third of the year left, the current run rate already
 * includes them at full annual value, but any *stub-priced* item is normalised
 * here so the renewal quote opens at twelve months of everything.
 */
export function planRenewalTerm(
  sub: SubscriptionState,
  opts: { termMonths?: number; upliftBps?: number; upliftCapBps?: number | null } = {},
): RenewalTermPlan {
  const termMonths = opts.termMonths ?? sub.termMonths;
  const startDate = addDays(sub.endDate, 1);
  const endDate = termEndDate(startDate, termMonths);

  const currentArrCents = computeArr(sub.items);
  const annualized = computeAnnualizedArr(sub.items);

  // The renewable base is the annualised figure; co-termed additions are already
  // inside it once their annual value was recorded on the item.
  const renewableArrCents = annualized;

  const requestedUplift = opts.upliftBps ?? sub.upliftBps;
  const upliftBps =
    opts.upliftCapBps != null ? Math.min(requestedUplift, opts.upliftCapBps) : requestedUplift;
  const upliftArrCents = applyBps(renewableArrCents, upliftBps);

  return {
    startDate,
    endDate,
    termMonths,
    noticeDate: noticeDateFor(sub.endDate, sub.noticeDays),
    currentArrCents,
    coTermedAdditionsArrCents: sub.coTermedAdditionsArrCents,
    renewableArrCents,
    upliftBps,
    upliftArrCents,
    expectedArrCents: renewableArrCents + upliftArrCents,
  };
}

/**
 * Creates the successor subscription from a renewal. Items are carried forward
 * at their annualised rate over the full new term, which is what turns a
 * part-year upsell into full-year recurring revenue.
 */
export function buildRenewalItems(
  sub: SubscriptionState,
  term: RenewalTermPlan,
  upliftBps: number,
): Omit<SubscriptionItemState, 'id'>[] {
  return sub.items
    .filter((i) => i.status === 'active')
    .map((i) => {
      const baseAnnual = i.annualizedArrCents || i.arrCents;
      const uplifted = baseAnnual + applyBps(baseAnnual, upliftBps);
      const unit = i.quantity > 0 ? roundHalfUp(uplifted / i.quantity) : uplifted;
      return {
        productId: i.productId,
        status: 'active' as const,
        quantity: i.quantity,
        listUnitCents: i.listUnitCents,
        netUnitCents: unit,
        discountBps: i.listUnitCents > 0 ? ratioBps(i.listUnitCents - unit, i.listUnitCents) : 0,
        arrCents: unit * i.quantity,
        annualizedArrCents: unit * i.quantity,
        startDate: term.startDate,
        endDate: term.endDate,
        // Everything is on the same term again, so nothing is co-termed.
        isCoTermed: false,
        prorationFactorBps: prorationFactorBps(term.startDate, term.endDate),
      };
    });
}

/** Whether the customer can still walk away without penalty. */
export function noticeWindowState(
  sub: Pick<SubscriptionState, 'endDate' | 'noticeDays' | 'autoRenew'>,
  asOf: IsoDate,
): {
  noticeDate: IsoDate;
  daysToNotice: number;
  noticePassed: boolean;
  /** Auto-renew has effectively locked in once notice has passed. */
  lockedIn: boolean;
} {
  const noticeDate = noticeDateFor(sub.endDate, sub.noticeDays);
  const daysToNotice = termDays(asOf, noticeDate) - 1;
  const noticePassed = asOf > noticeDate;
  return {
    noticeDate,
    daysToNotice,
    noticePassed,
    lockedIn: noticePassed && sub.autoRenew,
  };
}

/** Proration credit owed when a subscription is cancelled mid-term. */
export function cancellationCredit(
  sub: Pick<SubscriptionState, 'currentArrCents' | 'endDate'>,
  effectiveDate: IsoDate,
): number {
  const days = termDays(effectiveDate, sub.endDate);
  if (days <= 0) return 0;
  return prorate(sub.currentArrCents, days, 365);
}

/** Full proration factor helper re-exported for callers that only need dates. */
export { prorationFactorBps };
