import { fiscalPeriod, fiscalQuarter, type IsoDate } from './dates';
import { ratioBps } from './money';
import type { ArrMovementType } from './types';

/**
 * ARR movement classification and the retention waterfall.
 *
 * The ledger is the source of truth: each movement is a signed, immutable row, so
 * the waterfall is a sum rather than a reconciliation, and gross/net retention
 * fall out of the same rows that the bookings report reads. Nothing here derives
 * revenue from a current-state snapshot, which is what usually makes ARR reports
 * disagree with each other.
 */

export type ArrMovement = {
  type: ArrMovementType;
  arrDeltaCents: number;
  effectiveDate: IsoDate;
  accountId: string;
  subscriptionId?: string | null;
  productId?: string | null;
};

/**
 * Classifies a change into a movement type.
 *
 * The rules that matter: a first sale to an account is `new` even if the account
 * previously churned and came back (that is a win-back, still new ARR); a price
 * increase with no quantity change is `uplift`, not expansion, so pricing power
 * is measurable separately from volume growth; and a renewal at an unchanged rate
 * produces no movement at all rather than a churn-plus-new pair.
 */
export function classifyMovement(input: {
  isFirstSubscriptionForAccount: boolean;
  isRenewal: boolean;
  deltaArrCents: number;
  quantityChanged: boolean;
  priceChanged: boolean;
  isCancellation: boolean;
}): ArrMovementType | null {
  if (input.isCancellation) return 'churn';
  if (input.isFirstSubscriptionForAccount && input.deltaArrCents > 0) return 'new';

  if (input.isRenewal) {
    if (input.deltaArrCents === 0) return null;
    if (input.deltaArrCents > 0) {
      return input.priceChanged && !input.quantityChanged ? 'uplift' : 'expansion';
    }
    return 'contraction';
  }

  if (input.deltaArrCents === 0) return null;
  if (input.deltaArrCents > 0) {
    return input.priceChanged && !input.quantityChanged ? 'uplift' : 'expansion';
  }
  return 'contraction';
}

export type Waterfall = {
  period: string;
  beginningArrCents: number;
  newArrCents: number;
  expansionArrCents: number;
  upliftArrCents: number;
  contractionArrCents: number;
  churnArrCents: number;
  endingArrCents: number;
  /** Expansion + uplift, the figure net retention credits. */
  grossExpansionArrCents: number;
  /** Contraction + churn, always reported as a negative. */
  grossLossArrCents: number;
  netChangeArrCents: number;
};

/**
 * Builds the waterfall for one period.
 *
 * `beginningArrCents` must be supplied — it is the ending balance of the prior
 * period, not something derivable from this period's movements alone.
 */
export function buildWaterfall(
  period: string,
  beginningArrCents: number,
  movements: ArrMovement[],
): Waterfall {
  const inPeriod = movements.filter((m) => fiscalPeriod(m.effectiveDate) === period);
  const sum = (t: ArrMovementType) =>
    inPeriod.filter((m) => m.type === t).reduce((s, m) => s + m.arrDeltaCents, 0);

  const newArrCents = sum('new');
  const expansionArrCents = sum('expansion');
  const upliftArrCents = sum('uplift');
  const contractionArrCents = sum('contraction');
  const churnArrCents = sum('churn');

  const netChangeArrCents =
    newArrCents + expansionArrCents + upliftArrCents + contractionArrCents + churnArrCents;

  return {
    period,
    beginningArrCents,
    newArrCents,
    expansionArrCents,
    upliftArrCents,
    contractionArrCents,
    churnArrCents,
    endingArrCents: beginningArrCents + netChangeArrCents,
    grossExpansionArrCents: expansionArrCents + upliftArrCents,
    grossLossArrCents: contractionArrCents + churnArrCents,
    netChangeArrCents,
  };
}

/** Chains waterfalls across periods so each opens where the last closed. */
export function buildWaterfallSeries(
  periods: string[],
  openingArrCents: number,
  movements: ArrMovement[],
): Waterfall[] {
  const out: Waterfall[] = [];
  let opening = openingArrCents;
  for (const p of periods) {
    const w = buildWaterfall(p, opening, movements);
    out.push(w);
    opening = w.endingArrCents;
  }
  return out;
}

export type RetentionMetrics = {
  /** ARR of the cohort at period start. */
  beginningArrCents: number;
  contractionArrCents: number;
  churnArrCents: number;
  expansionArrCents: number;
  upliftArrCents: number;
  /** (beginning - contraction - churn) / beginning. Never exceeds 100%. */
  grossRetentionBps: number;
  /** (beginning - contraction - churn + expansion + uplift) / beginning. */
  netRetentionBps: number;
  /** Share of renewable ARR that actually renewed. */
  renewalRateBps: number;
  /** Share of customer count retained. */
  logoRetentionBps: number;
};

/**
 * Gross and net retention.
 *
 * Both are measured against the opening balance of the *existing* base, so new
 * ARR won in the period is deliberately excluded — including it would flatter net
 * retention and hide a leaky base. Gross retention is capped at 100% by
 * construction because expansion cannot offset churn in that measure.
 */
export function retention(input: {
  beginningArrCents: number;
  expansionArrCents: number;
  upliftArrCents: number;
  /** Pass as negative or positive; sign is normalised. */
  contractionArrCents: number;
  churnArrCents: number;
  renewableArrCents?: number;
  renewedArrCents?: number;
  beginningLogos?: number;
  churnedLogos?: number;
}): RetentionMetrics {
  const beginning = input.beginningArrCents;
  const contraction = Math.abs(input.contractionArrCents);
  const churn = Math.abs(input.churnArrCents);
  const expansion = input.expansionArrCents;
  const uplift = input.upliftArrCents;

  const grossRetainedCents = beginning - contraction - churn;
  const netRetainedCents = grossRetainedCents + expansion + uplift;

  return {
    beginningArrCents: beginning,
    contractionArrCents: contraction,
    churnArrCents: churn,
    expansionArrCents: expansion,
    upliftArrCents: uplift,
    grossRetentionBps: beginning > 0 ? ratioBps(grossRetainedCents, beginning) : 0,
    netRetentionBps: beginning > 0 ? ratioBps(netRetainedCents, beginning) : 0,
    renewalRateBps:
      input.renewableArrCents && input.renewableArrCents > 0
        ? ratioBps(input.renewedArrCents ?? 0, input.renewableArrCents)
        : 0,
    logoRetentionBps:
      input.beginningLogos && input.beginningLogos > 0
        ? ratioBps(input.beginningLogos - (input.churnedLogos ?? 0), input.beginningLogos)
        : 0,
  };
}

/**
 * Splits an opportunity's revenue movement into its components.
 *
 * A single expansion transaction routinely contains new ARR for a cross-sold
 * product, a price uplift on the existing one, added seats, and a removed
 * module. Reporting only the net figure destroys that information, so each
 * component is stored on the opportunity.
 */
export function decomposeOpportunityMovement(
  lines: {
    action: string;
    arrCents: number;
    annualizedArrCents: number;
    isNewProductForAccount: boolean;
    priceChangedOnly: boolean;
  }[],
): {
  newArrCents: number;
  expansionArrCents: number;
  upliftArrCents: number;
  contractionArrCents: number;
  churnArrCents: number;
  netArrCents: number;
} {
  let newArrCents = 0;
  let expansionArrCents = 0;
  let upliftArrCents = 0;
  let contractionArrCents = 0;
  let churnArrCents = 0;

  for (const l of lines) {
    const arr = l.arrCents;
    if (l.action === 'remove') {
      churnArrCents += arr < 0 ? arr : -Math.abs(arr);
      continue;
    }
    if (l.action === 'decrease') {
      contractionArrCents += arr < 0 ? arr : -Math.abs(arr);
      continue;
    }
    if (l.action === 'price_change' || l.priceChangedOnly) {
      upliftArrCents += arr;
      continue;
    }
    if (l.isNewProductForAccount) {
      newArrCents += arr;
      continue;
    }
    expansionArrCents += arr;
  }

  return {
    newArrCents,
    expansionArrCents,
    upliftArrCents,
    contractionArrCents,
    churnArrCents,
    netArrCents:
      newArrCents + expansionArrCents + upliftArrCents + contractionArrCents + churnArrCents,
  };
}

/** Movement rows for the ledger, one per non-zero component. */
export function movementRowsFor(input: {
  accountId: string;
  subscriptionId?: string | null;
  opportunityId?: string | null;
  amendmentId?: string | null;
  effectiveDate: IsoDate;
  components: {
    newArrCents: number;
    expansionArrCents: number;
    upliftArrCents: number;
    contractionArrCents: number;
    churnArrCents: number;
  };
}): {
  type: ArrMovementType;
  arrDeltaCents: number;
  effectiveDate: IsoDate;
  fiscalPeriod: string;
  fiscalQuarter: string;
  accountId: string;
  subscriptionId?: string | null;
  opportunityId?: string | null;
  amendmentId?: string | null;
}[] {
  const pairs: [ArrMovementType, number][] = [
    ['new', input.components.newArrCents],
    ['expansion', input.components.expansionArrCents],
    ['uplift', input.components.upliftArrCents],
    ['contraction', input.components.contractionArrCents],
    ['churn', input.components.churnArrCents],
  ];

  return pairs
    .filter(([, v]) => v !== 0)
    .map(([type, arrDeltaCents]) => ({
      type,
      arrDeltaCents,
      effectiveDate: input.effectiveDate,
      fiscalPeriod: fiscalPeriod(input.effectiveDate),
      fiscalQuarter: fiscalQuarter(input.effectiveDate),
      accountId: input.accountId,
      subscriptionId: input.subscriptionId ?? null,
      opportunityId: input.opportunityId ?? null,
      amendmentId: input.amendmentId ?? null,
    }));
}

/** Average contract value and average selling price across won deals. */
export function dealAverages(deals: { arrCents: number; tcvCents: number }[]): {
  averageContractValueCents: number;
  averageSellingPriceCents: number;
  count: number;
} {
  if (deals.length === 0) {
    return { averageContractValueCents: 0, averageSellingPriceCents: 0, count: 0 };
  }
  const tcv = deals.reduce((s, d) => s + d.tcvCents, 0);
  const arr = deals.reduce((s, d) => s + d.arrCents, 0);
  return {
    averageContractValueCents: Math.round(tcv / deals.length),
    averageSellingPriceCents: Math.round(arr / deals.length),
    count: deals.length,
  };
}
