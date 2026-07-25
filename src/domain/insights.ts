import { daysBetween, type IsoDate } from './dates';
import { formatMoney } from './money';
import { STAGES, type StageKey } from './stages';

/**
 * Practical AI layer.
 *
 * These are transparent, deterministic heuristics rather than an opaque model, and
 * that is the point: every insight ships with the evidence that produced it and a
 * confidence figure, and nothing here writes to a record on its own. Material
 * changes to pricing, forecast, risk or ownership stay human decisions with an
 * audit row behind them — the system proposes, a person disposes.
 *
 * The same interface would accept a genuine model's output; the contract is the
 * evidence and the confidence, not the mechanism.
 */

export type Insight = {
  kind:
    | 'opportunity_risk'
    | 'forecast_risk'
    | 'renewal_likelihood'
    | 'churn_signal'
    | 'expansion_signal'
    | 'next_best_action'
    | 'missing_data'
    | 'duplicate'
    | 'relationship_gap'
    | 'meeting_prep'
    | 'summary';
  objectType: string;
  recordId: string;
  accountId?: string | null;
  title: string;
  detail: string;
  confidenceBps: number;
  severity: 'low' | 'medium' | 'high' | 'urgent';
  evidence: string[];
  recommendedAction: string | null;
  proposedChange?: Record<string, unknown> | null;
};

/* -------------------------------------------------------- opportunity inspection */

export type OpportunityInspectionInput = {
  id: string;
  accountId: string;
  name: string;
  stage: StageKey;
  amountCents: number;
  closeDate: IsoDate;
  daysInStage: number;
  pushCount: number;
  nextStep: string | null;
  nextMeetingAt: Date | null;
  lastCustomerResponseAt: Date | null;
  contactRoleCount: number;
  hasEconomicBuyer: boolean;
  hasMutualActionPlan: boolean;
  competitorMentions: number;
  openObjections: number;
  singleThreaded: boolean;
  asOf: IsoDate;
};

/**
 * Deal inspection.
 *
 * The signals chosen here are the ones that actually predict a slip: no scheduled
 * next meeting, a single thread into the account, no economic buyer, and silence
 * from the customer. Deal size and stage are context, not evidence.
 */
export function inspectOpportunity(i: OpportunityInspectionInput): Insight[] {
  const out: Insight[] = [];
  const evidence: string[] = [];
  let riskPoints = 0;

  if (!i.nextMeetingAt) {
    riskPoints += 25;
    evidence.push('No next meeting is scheduled');
  }
  if (!i.nextStep) {
    riskPoints += 10;
    evidence.push('Next step field is empty');
  }
  if (i.lastCustomerResponseAt) {
    const silent = daysBetween(i.lastCustomerResponseAt.toISOString().slice(0, 10), i.asOf);
    if (silent > 14) {
      riskPoints += Math.min(25, silent);
      evidence.push(`No customer response for ${silent} days`);
    }
  } else {
    riskPoints += 15;
    evidence.push('No inbound customer response recorded');
  }
  if (i.singleThreaded || i.contactRoleCount <= 1) {
    riskPoints += 20;
    evidence.push('Single-threaded — only one contact engaged');
  }
  if (!i.hasEconomicBuyer && STAGES[i.stage].ordinal >= STAGES.proposal.ordinal) {
    riskPoints += 20;
    evidence.push('At proposal stage with no economic buyer identified');
  }
  if (!i.hasMutualActionPlan && STAGES[i.stage].ordinal >= STAGES.solution_design.ordinal) {
    riskPoints += 10;
    evidence.push('No mutual action plan in place');
  }
  if (i.pushCount >= 2) {
    riskPoints += 15;
    evidence.push(`Close date has moved ${i.pushCount} times`);
  }
  if (i.daysInStage > 45) {
    riskPoints += 10;
    evidence.push(`${i.daysInStage} days in ${STAGES[i.stage].label}`);
  }
  if (i.closeDate < i.asOf) {
    riskPoints += 20;
    evidence.push('Close date has already passed');
  }
  if (i.openObjections > 0) {
    riskPoints += 8;
    evidence.push(`${i.openObjections} unresolved objection(s) from call notes`);
  }
  if (i.competitorMentions >= 3) {
    riskPoints += 8;
    evidence.push(`Competitor mentioned ${i.competitorMentions} times in recent calls`);
  }

  if (riskPoints >= 30) {
    out.push({
      kind: 'opportunity_risk',
      objectType: 'opportunities',
      recordId: i.id,
      accountId: i.accountId,
      title: `${i.name} shows ${riskPoints >= 60 ? 'severe' : 'material'} execution risk`,
      detail: `${evidence.length} risk signals across engagement, stakeholder coverage and process discipline. Deal value ${formatMoney(
        i.amountCents,
      )}.`,
      confidenceBps: Math.min(9000, 4000 + riskPoints * 50),
      severity: riskPoints >= 70 ? 'urgent' : riskPoints >= 50 ? 'high' : 'medium',
      evidence,
      recommendedAction: nextBestActionForDeal(i),
      proposedChange:
        i.closeDate < i.asOf ? { field: 'closeDate', suggestion: 'review_and_reset' } : null,
    });
  }

  if (i.singleThreaded || i.contactRoleCount <= 1) {
    out.push({
      kind: 'relationship_gap',
      objectType: 'opportunities',
      recordId: i.id,
      accountId: i.accountId,
      title: 'Buying committee is not covered',
      detail:
        'Only one stakeholder is engaged. Committee purchases with a single thread lose disproportionately when that person changes role or priority.',
      confidenceBps: 8000,
      severity: 'high',
      evidence: [`${i.contactRoleCount} contact role(s) on the opportunity`],
      recommendedAction:
        'Map the procurement, technical and executive roles and secure a second active thread before the next stage gate.',
    });
  }

  return out;
}

function nextBestActionForDeal(i: OpportunityInspectionInput): string {
  if (!i.nextMeetingAt) return 'Book the next meeting — no forward calendar commitment exists.';
  if (!i.hasEconomicBuyer) return 'Secure a meeting with the economic buyer before quoting again.';
  if (i.singleThreaded) return 'Multi-thread: get introduced to a second stakeholder this week.';
  if (i.pushCount >= 2) return 'Re-baseline the close plan with the customer and reset the date once.';
  return 'Confirm the close plan and remove the stated blocker.';
}

/* ---------------------------------------------------------------- usage signals */

export type UsageSignalInput = {
  accountId: string;
  subscriptionId: string | null;
  licensedUsers: number;
  activeUsers: number;
  utilisationBps: number;
  trendBps: number;
  daysSinceLastActivity: number;
  featureAdoptionBps: number;
  consumptionBps: number | null;
  currentArrCents: number;
  netUnitCents: number;
  daysToRenewal: number | null;
};

/**
 * Turns telemetry into commercial signals.
 *
 * Utilisation is read in both directions: an account at its licence ceiling is an
 * expansion opportunity, and one below 40% is a renewal risk. The same number
 * means opposite things, which is why a single "usage" score is not enough.
 */
export function detectUsageSignals(i: UsageSignalInput): Insight[] {
  const out: Insight[] = [];

  if (i.utilisationBps >= 9500 && i.licensedUsers > 0) {
    const suggestedSeats = Math.max(5, Math.ceil(i.licensedUsers * 0.2));
    out.push({
      kind: 'expansion_signal',
      objectType: 'accounts',
      recordId: i.accountId,
      accountId: i.accountId,
      title: `At licence ceiling — ${i.activeUsers} of ${i.licensedUsers} seats active`,
      detail: `Utilisation is ${(i.utilisationBps / 100).toFixed(0)}% and trending ${
        i.trendBps >= 0 ? 'up' : 'down'
      } ${Math.abs(i.trendBps / 100).toFixed(0)}%. A seat expansion of roughly ${suggestedSeats} is indicated.`,
      confidenceBps: 7500,
      severity: 'medium',
      evidence: [
        `${i.activeUsers}/${i.licensedUsers} licences active`,
        `usage trend ${(i.trendBps / 100).toFixed(1)}%`,
      ],
      recommendedAction: `Open an upsell for ~${suggestedSeats} seats. Co-term to the existing subscription so the account keeps one renewal date.`,
      proposedChange: {
        object: 'opportunities',
        type: 'upsell',
        suggestedQuantity: suggestedSeats,
        estimatedArrCents: suggestedSeats * i.netUnitCents,
      },
    });
  }

  if (i.utilisationBps < 4000 && i.licensedUsers >= 10) {
    out.push({
      kind: 'churn_signal',
      objectType: 'accounts',
      recordId: i.accountId,
      accountId: i.accountId,
      title: `Shelfware risk — only ${(i.utilisationBps / 100).toFixed(0)}% of licences in use`,
      detail: `${i.licensedUsers - i.activeUsers} licences are unused. Expect a contraction request at renewal unless adoption moves.`,
      confidenceBps: 7000,
      severity: i.daysToRenewal != null && i.daysToRenewal <= 120 ? 'high' : 'medium',
      evidence: [
        `${i.activeUsers}/${i.licensedUsers} licences active`,
        i.daysToRenewal != null ? `${i.daysToRenewal} days to renewal` : 'no renewal date set',
      ],
      recommendedAction:
        'Run an adoption review with the administrator and agree an activation plan before renewal quoting begins.',
    });
  }

  if (i.daysSinceLastActivity > 21) {
    out.push({
      kind: 'churn_signal',
      objectType: 'accounts',
      recordId: i.accountId,
      accountId: i.accountId,
      title: `No product activity for ${i.daysSinceLastActivity} days`,
      detail: 'Sustained inactivity is the single strongest leading indicator of non-renewal.',
      confidenceBps: 8000,
      severity: 'high',
      evidence: [`last activity ${i.daysSinceLastActivity} days ago`],
      recommendedAction: 'Contact the administrator today and establish whether the deployment has stalled.',
    });
  }

  if (i.consumptionBps != null && i.consumptionBps >= 11_000) {
    out.push({
      kind: 'expansion_signal',
      objectType: 'accounts',
      recordId: i.accountId,
      accountId: i.accountId,
      title: `Consuming ${(i.consumptionBps / 100).toFixed(0)}% of committed volume`,
      detail: 'The account is in overage. A higher commitment tier is usually cheaper for them and better revenue for us.',
      confidenceBps: 8500,
      severity: 'medium',
      evidence: [`consumption ${(i.consumptionBps / 100).toFixed(0)}% of commit`],
      recommendedAction: 'Propose a commitment true-up co-termed to the current subscription.',
    });
  }

  if (i.featureAdoptionBps < 3000 && i.currentArrCents > 0) {
    out.push({
      kind: 'next_best_action',
      objectType: 'accounts',
      recordId: i.accountId,
      accountId: i.accountId,
      title: 'Feature adoption is shallow',
      detail: `Only ${(i.featureAdoptionBps / 100).toFixed(0)}% of key features are in use, which limits realised value and weakens the renewal case.`,
      confidenceBps: 6500,
      severity: 'low',
      evidence: [`feature adoption ${(i.featureAdoptionBps / 100).toFixed(0)}%`],
      recommendedAction: 'Schedule enablement on the two highest-value unused features.',
    });
  }

  return out;
}

/* -------------------------------------------------------------- data hygiene */

export type MissingDataCheck = {
  objectType: string;
  recordId: string;
  accountId?: string | null;
  label: string;
  missing: string[];
  severity: 'low' | 'medium' | 'high';
};

export function missingDataInsight(check: MissingDataCheck): Insight | null {
  if (check.missing.length === 0) return null;
  return {
    kind: 'missing_data',
    objectType: check.objectType,
    recordId: check.recordId,
    accountId: check.accountId ?? null,
    title: `${check.missing.length} required field(s) incomplete on ${check.label}`,
    detail: `Missing: ${check.missing.join(', ')}. Incomplete records distort forecasting and break downstream automation.`,
    confidenceBps: 10_000,
    severity: check.severity,
    evidence: check.missing,
    recommendedAction: 'Complete the fields, or record why they cannot be filled.',
  };
}

/**
 * Duplicate detection.
 *
 * Email match is treated as near-certain, domain plus name as probable, and name
 * alone as weak. Cross-object matches (a lead that is really an existing contact)
 * are flagged separately because the resolution differs: those should be merged
 * into the contact rather than converted into a second one.
 */
export function scoreDuplicate(
  a: { email?: string | null; firstName?: string | null; lastName?: string | null; company?: string | null; domain?: string | null },
  b: { email?: string | null; firstName?: string | null; lastName?: string | null; company?: string | null; domain?: string | null },
): { scoreBps: number; matchedOn: string[] } {
  const matchedOn: string[] = [];
  let score = 0;

  const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

  if (norm(a.email) && norm(a.email) === norm(b.email)) {
    score += 9000;
    matchedOn.push('email');
  }

  const sameLast = norm(a.lastName) && norm(a.lastName) === norm(b.lastName);
  const sameFirst = norm(a.firstName) && norm(a.firstName) === norm(b.firstName);
  if (sameLast && sameFirst) {
    score += 3500;
    matchedOn.push('full name');
  } else if (sameLast) {
    score += 1000;
    matchedOn.push('surname');
  }

  const domainA = norm(a.domain) || norm(a.email).split('@')[1] || '';
  const domainB = norm(b.domain) || norm(b.email).split('@')[1] || '';
  if (domainA && domainA === domainB) {
    score += 2500;
    matchedOn.push('email domain');
  }

  if (norm(a.company) && norm(a.company) === norm(b.company)) {
    score += 1500;
    matchedOn.push('company');
  }

  return { scoreBps: Math.min(10_000, score), matchedOn };
}

/* ------------------------------------------------------------- meeting prep */

export type MeetingPrepInput = {
  accountId: string;
  accountName: string;
  currentArrCents: number;
  healthScore: number | null;
  openCases: number;
  severity1Cases: number;
  openOpportunities: { name: string; stage: StageKey; amountCents: number }[];
  daysToRenewal: number | null;
  lastMeetingSummary: string | null;
  openCommitments: string[];
  attendees: { name: string; title: string | null; role: string; sentiment: string }[];
};

/** A briefing assembled from records that already exist, not generated prose. */
export function meetingPrep(i: MeetingPrepInput): Insight {
  const evidence: string[] = [];
  if (i.healthScore != null) evidence.push(`Health ${i.healthScore}/100`);
  evidence.push(`ARR ${formatMoney(i.currentArrCents)}`);
  if (i.severity1Cases > 0) evidence.push(`${i.severity1Cases} open severity-1 case(s)`);
  else if (i.openCases > 0) evidence.push(`${i.openCases} open case(s)`);
  if (i.daysToRenewal != null) evidence.push(`Renewal in ${i.daysToRenewal} days`);
  for (const o of i.openOpportunities.slice(0, 3)) {
    evidence.push(`${o.name} — ${STAGES[o.stage].label}, ${formatMoney(o.amountCents)}`);
  }
  for (const c of i.openCommitments.slice(0, 3)) evidence.push(`Outstanding commitment: ${c}`);

  const watchOut = i.attendees.filter(
    (a) => a.sentiment === 'negative' || a.sentiment === 'very_negative',
  );

  const lines: string[] = [];
  if (i.lastMeetingSummary) lines.push(`Last conversation: ${i.lastMeetingSummary}`);
  if (i.severity1Cases > 0)
    lines.push('Open a severity-1 acknowledgement first — do not lead with commercials.');
  if (watchOut.length > 0)
    lines.push(
      `Handle with care: ${watchOut.map((a) => `${a.name} (${a.role})`).join(', ')} recorded negative sentiment.`,
    );
  if (i.openCommitments.length > 0)
    lines.push('Close out the outstanding commitments before asking for anything new.');

  return {
    kind: 'meeting_prep',
    objectType: 'accounts',
    recordId: i.accountId,
    accountId: i.accountId,
    title: `Briefing: ${i.accountName}`,
    detail: lines.join(' ') || 'No open issues. Straightforward conversation.',
    confidenceBps: 10_000,
    severity: i.severity1Cases > 0 ? 'high' : 'low',
    evidence,
    recommendedAction:
      i.openCommitments.length > 0
        ? 'Lead with the outstanding commitments, then move to the agenda.'
        : 'Confirm value realised to date, then explore the next objective.',
  };
}

/* ------------------------------------------------------- forecast risk analysis */

export function forecastRisk(input: {
  ownerId: string;
  fiscalPeriod: string;
  submittedCents: number;
  commitCents: number;
  coverageBps: number;
  historicalBiasBps: number;
  commitDealsAtRisk: { id: string; name: string; amountCents: number; reasons: string[] }[];
}): Insight | null {
  const evidence: string[] = [];
  let severity: Insight['severity'] = 'low';

  const atRiskCents = input.commitDealsAtRisk.reduce((s, d) => s + d.amountCents, 0);
  const atRiskShare =
    input.commitCents > 0 ? Math.round((atRiskCents / input.commitCents) * 100) : 0;

  if (input.commitDealsAtRisk.length > 0) {
    evidence.push(
      `${input.commitDealsAtRisk.length} commit deal(s) worth ${formatMoney(
        atRiskCents,
      )} show risk signals (${atRiskShare}% of commit)`,
    );
    severity = atRiskShare >= 30 ? 'urgent' : atRiskShare >= 15 ? 'high' : 'medium';
  }
  if (input.coverageBps > 0 && input.coverageBps < 25_000) {
    evidence.push(`Pipeline coverage is only ${(input.coverageBps / 10_000).toFixed(1)}x the gap`);
    if (severity === 'low') severity = 'medium';
  }
  if (Math.abs(input.historicalBiasBps) > 1000) {
    evidence.push(
      `Historical bias of ${(input.historicalBiasBps / 100).toFixed(1)}% — this forecast has ${
        input.historicalBiasBps > 0 ? 'run high' : 'run low'
      }`,
    );
  }

  if (evidence.length === 0) return null;

  return {
    kind: 'forecast_risk',
    objectType: 'forecasts',
    recordId: `${input.ownerId}:${input.fiscalPeriod}`,
    title: `Forecast risk for ${input.fiscalPeriod}`,
    detail: `Submitted ${formatMoney(input.submittedCents)} with ${formatMoney(
      atRiskCents,
    )} of the commit carrying execution risk.`,
    confidenceBps: 7000,
    severity,
    evidence,
    recommendedAction:
      input.commitDealsAtRisk.length > 0
        ? `Inspect ${input.commitDealsAtRisk
            .slice(0, 3)
            .map((d) => d.name)
            .join(', ')} in the next pipeline review, or move them out of commit.`
        : 'Build coverage — current pipeline is thin against the remaining gap.',
  };
}
