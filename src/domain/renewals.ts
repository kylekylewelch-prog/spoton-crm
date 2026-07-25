import { addDays, daysBetween, type IsoDate } from './dates';
import { applyBps, ratioBps } from './money';
import type { ForecastCategory } from './types';

/**
 * Renewal operating logic.
 *
 * Two rules drive everything here, and they are the ones the specification calls
 * out explicitly:
 *
 *  1. Winning a deal creates its renewal immediately. The renewal is a real
 *     object with a date, an owner and a number from day one, not a report that
 *     someone runs ninety days out.
 *
 *  2. A mid-term upsell or cross-sell is co-termed onto the active subscription
 *     *and* its full annual value is added to the next open renewal. Doing only
 *     the first loses the expansion at renewal time; doing only the second leaves
 *     the customer with two renewal dates.
 */

export type RenewalRecord = {
  id: string;
  subscriptionId: string;
  accountId: string;
  opportunityId: string | null;
  renewalDate: IsoDate;
  noticeDate: IsoDate | null;
  status: string;
  currentArrCents: number;
  renewableArrCents: number;
  coTermedAdditionsArrCents: number;
  expectedArrCents: number;
  upliftBps: number;
  autoRenew: boolean;
  closedAt?: Date | null;
};

/**
 * Finds the renewal a mid-term change should roll into.
 *
 * "Next open renewal" means: on the same subscription, not yet closed, and dated
 * on or after the change's effective date. If a subscription has been renewed
 * several terms ahead, the *earliest* qualifying renewal wins — the change is
 * worth its annual value at the very next renewal event, not at some later one.
 */
export function findNextOpenRenewal(
  renewals: RenewalRecord[],
  subscriptionId: string,
  effectiveDate: IsoDate,
): RenewalRecord | null {
  const CLOSED = new Set(['renewed', 'churned', 'auto_renewed', 'contracted']);

  const candidates = renewals
    .filter(
      (r) =>
        r.subscriptionId === subscriptionId &&
        !CLOSED.has(r.status) &&
        !r.closedAt &&
        r.renewalDate >= effectiveDate,
    )
    .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));

  return candidates[0] ?? null;
}

/**
 * Applies a co-termed addition to a renewal.
 *
 * The renewable base grows by the annualised value of the change, and the uplift
 * is recalculated on the new base — a customer who adds 40 seats mid-term should
 * see the uplift applied to the larger footprint at renewal, not to the old one.
 */
export function rollIntoRenewal(
  renewal: RenewalRecord,
  annualizedArrCents: number,
): {
  coTermedAdditionsArrCents: number;
  renewableArrCents: number;
  upliftArrCents: number;
  expectedArrCents: number;
  delta: number;
} {
  const coTermedAdditionsArrCents = renewal.coTermedAdditionsArrCents + annualizedArrCents;
  const renewableArrCents = renewal.renewableArrCents + annualizedArrCents;
  const upliftArrCents = applyBps(renewableArrCents, renewal.upliftBps);

  return {
    coTermedAdditionsArrCents,
    renewableArrCents,
    upliftArrCents,
    expectedArrCents: renewableArrCents + upliftArrCents,
    delta: annualizedArrCents,
  };
}

/* -------------------------------------------------------------- risk and forecast */

export type RenewalRiskInput = {
  healthScore: number | null;
  renewalLikelihoodBps: number | null;
  daysToRenewal: number;
  openRisks: number;
  openSeverity1Cases: number;
  slaBreaches90d: number;
  utilisationBps: number | null;
  championPresent: boolean;
  championTurnover: boolean;
  executiveEngagedDays: number | null;
  pastDueCents: number;
  cancellationNoticeReceived: boolean;
  autoRenew: boolean;
  arrCents: number;
};

export type RenewalRisk = {
  level: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  drivers: string[];
  /** ARR the model treats as genuinely exposed. */
  churnRiskArrCents: number;
  requiresEscalation: boolean;
  recommendedPlaybook: 'renewal_standard' | 'renewal_risk' | 'save_play' | 'executive_escalation';
};

/**
 * Assesses renewal risk.
 *
 * Deliberately blends leading indicators (champion, engagement, utilisation) with
 * lagging ones (cases, breaches, arrears) — a renewal that only looks risky once
 * the support tickets pile up is being assessed too late to save.
 */
export function assessRenewalRisk(i: RenewalRiskInput): RenewalRisk {
  const drivers: string[] = [];
  let score = 0;

  if (i.cancellationNoticeReceived) {
    return {
      level: 'critical',
      score: 100,
      drivers: ['Cancellation notice received'],
      churnRiskArrCents: i.arrCents,
      requiresEscalation: true,
      recommendedPlaybook: 'save_play',
    };
  }

  const health = i.healthScore ?? 60;
  if (health < 40) {
    score += 35;
    drivers.push(`Health score of ${health} is critical`);
  } else if (health < 55) {
    score += 22;
    drivers.push(`Health score of ${health} is below par`);
  } else if (health < 70) {
    score += 10;
    drivers.push(`Health score of ${health} is only fair`);
  }

  if (i.championTurnover) {
    score += 20;
    drivers.push('Champion has left the account');
  } else if (!i.championPresent) {
    score += 12;
    drivers.push('No active champion identified');
  }

  if (i.utilisationBps != null && i.utilisationBps < 4000) {
    score += 15;
    drivers.push(`Only ${(i.utilisationBps / 100).toFixed(0)}% of licences are in use`);
  }

  if (i.openSeverity1Cases > 0) {
    score += 14;
    drivers.push(`${i.openSeverity1Cases} open severity-1 case(s)`);
  }
  if (i.slaBreaches90d > 0) {
    score += Math.min(10, i.slaBreaches90d * 4);
    drivers.push(`${i.slaBreaches90d} SLA breach(es) in the last 90 days`);
  }
  if (i.openRisks > 0) {
    score += Math.min(12, i.openRisks * 5);
    drivers.push(`${i.openRisks} open risk(s) on the account`);
  }
  if (i.pastDueCents > 0) {
    score += 8;
    drivers.push('Past-due balance outstanding');
  }
  if (i.executiveEngagedDays != null && i.executiveEngagedDays > 120) {
    score += 8;
    drivers.push(`No executive contact for ${i.executiveEngagedDays} days`);
  }
  if (!i.autoRenew) {
    score += 6;
    drivers.push('Auto-renew is switched off');
  }
  if (i.daysToRenewal <= 60 && drivers.length > 0) {
    score += 8;
    drivers.push(`Only ${i.daysToRenewal} days to renewal with issues unresolved`);
  }

  score = Math.min(100, score);

  const level: RenewalRisk['level'] =
    score >= 60 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';

  // Exposed ARR scales with risk rather than being all-or-nothing.
  const exposureBps = { low: 0, medium: 1500, high: 4000, critical: 7500 }[level];

  return {
    level,
    score,
    drivers,
    churnRiskArrCents: applyBps(i.arrCents, exposureBps),
    requiresEscalation: level === 'critical' || (level === 'high' && i.arrCents >= 10_000_000),
    recommendedPlaybook:
      level === 'critical'
        ? 'executive_escalation'
        : level === 'high'
          ? 'save_play'
          : level === 'medium'
            ? 'renewal_risk'
            : 'renewal_standard',
  };
}

/**
 * Forecast category for a renewal.
 *
 * An auto-renewing subscription past its notice date is a commit: the customer
 * has, contractually, already renewed. That single rule removes most of the
 * guesswork from a renewal forecast, and it is why notice dates are tracked as
 * first-class data rather than buried in contract PDFs.
 */
export function renewalForecastCategory(input: {
  autoRenew: boolean;
  noticePassed: boolean;
  cancellationNoticeReceived: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  renewalLikelihoodBps: number | null;
  isQuoted: boolean;
  isCommitted: boolean;
}): ForecastCategory {
  if (input.cancellationNoticeReceived) return 'omitted';
  if (input.isCommitted) return 'commit';
  if (input.autoRenew && input.noticePassed) return 'commit';

  const likelihood = input.renewalLikelihoodBps ?? 5000;
  if (input.riskLevel === 'critical') return 'omitted';
  if (input.riskLevel === 'high') return likelihood >= 5000 ? 'pipeline' : 'omitted';
  if (input.isQuoted && likelihood >= 7000) return 'commit';
  if (likelihood >= 7000) return 'best_case';
  if (likelihood >= 4000) return 'pipeline';
  return 'omitted';
}

/**
 * Expected renewal amount under three scenarios, which is what a renewal forecast
 * actually needs — a single number cannot express "we will keep them but lose the
 * add-on module".
 */
export function renewalScenarios(input: {
  renewableArrCents: number;
  upliftBps: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  expansionOpportunityArrCents?: number;
  knownContractionArrCents?: number;
}): {
  downsideArrCents: number;
  expectedArrCents: number;
  upsideArrCents: number;
  churnRiskArrCents: number;
} {
  const base = input.renewableArrCents;
  const uplift = applyBps(base, input.upliftBps);
  const contraction = input.knownContractionArrCents ?? 0;

  const downsideBps = { low: 9500, medium: 8500, high: 6000, critical: 2500 }[input.riskLevel];

  return {
    downsideArrCents: Math.max(0, applyBps(base, downsideBps) - contraction),
    expectedArrCents: Math.max(0, base + uplift - contraction),
    upsideArrCents: base + uplift + (input.expansionOpportunityArrCents ?? 0) - contraction,
    churnRiskArrCents: base - applyBps(base, downsideBps),
  };
}

/**
 * When to start working a renewal. Larger and riskier renewals start earlier,
 * because a strategic account cannot be renegotiated in three weeks.
 */
export function renewalStartDate(
  renewalDate: IsoDate,
  arrCents: number,
  riskLevel: 'low' | 'medium' | 'high' | 'critical',
): { startDate: IsoDate; leadDays: number } {
  let leadDays = 90;
  if (arrCents >= 50_000_000) leadDays = 210;
  else if (arrCents >= 10_000_000) leadDays = 150;
  else if (arrCents >= 2_500_000) leadDays = 120;

  if (riskLevel === 'high') leadDays += 30;
  if (riskLevel === 'critical') leadDays += 60;

  return { startDate: addDays(renewalDate, -leadDays), leadDays };
}

/** Renewal desk buckets, driven by proximity to the notice date. */
export function renewalUrgency(
  renewal: Pick<RenewalRecord, 'renewalDate' | 'noticeDate' | 'autoRenew'>,
  asOf: IsoDate,
): {
  bucket: 'overdue' | 'notice_window' | 'this_quarter' | 'next_quarter' | 'future';
  daysToRenewal: number;
  daysToNotice: number | null;
  noticePassed: boolean;
} {
  const daysToRenewal = daysBetween(asOf, renewal.renewalDate);
  const daysToNotice = renewal.noticeDate ? daysBetween(asOf, renewal.noticeDate) : null;
  const noticePassed = daysToNotice != null && daysToNotice < 0;

  let bucket: 'overdue' | 'notice_window' | 'this_quarter' | 'next_quarter' | 'future';
  if (daysToRenewal < 0) bucket = 'overdue';
  else if (daysToNotice != null && daysToNotice <= 30) bucket = 'notice_window';
  else if (daysToRenewal <= 90) bucket = 'this_quarter';
  else if (daysToRenewal <= 180) bucket = 'next_quarter';
  else bucket = 'future';

  return { bucket, daysToRenewal, daysToNotice, noticePassed };
}

/** Whether a renewal's terms need approval before it can be quoted. */
export function renewalNeedsApproval(input: {
  contractualUpliftBps: number;
  proposedUpliftBps: number;
  renewableArrCents: number;
  proposedArrCents: number;
  termMonths: number;
  contractualTermMonths: number;
}): { required: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (input.proposedUpliftBps < input.contractualUpliftBps) {
    reasons.push(
      `Uplift reduced from ${(input.contractualUpliftBps / 100).toFixed(1)}% to ${(
        input.proposedUpliftBps / 100
      ).toFixed(1)}%`,
    );
  }
  if (input.proposedArrCents < input.renewableArrCents) {
    const downBps = ratioBps(
      input.renewableArrCents - input.proposedArrCents,
      input.renewableArrCents,
    );
    reasons.push(`Renewal is a ${(downBps / 100).toFixed(1)}% contraction`);
  }
  if (input.termMonths < input.contractualTermMonths) {
    reasons.push(`Term shortened from ${input.contractualTermMonths} to ${input.termMonths} months`);
  }

  return { required: reasons.length > 0, reasons };
}
