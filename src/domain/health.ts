import { ratioBps } from './money';
import type { HealthBand } from './types';

/**
 * Customer health scoring.
 *
 * Three properties are non-negotiable here: the score is multidimensional (a
 * single number hides which lever to pull), explainable (every score ships with
 * the per-dimension detail and the ranked reasons it moved), and confidence-aware
 * (a 72 built from two of nine inputs is not the same fact as a 72 built from all
 * nine, and pretending otherwise gets renewals wrong).
 */

export const HEALTH_DIMENSIONS = [
  'usage',
  'adoption',
  'utilisation',
  'support',
  'payment',
  'sentiment',
  'engagement',
  'implementation',
  'contract',
] as const;

export type HealthDimension = (typeof HEALTH_DIMENSIONS)[number];

export type HealthWeights = Record<HealthDimension, number>;

export const DEFAULT_WEIGHTS: HealthWeights = {
  usage: 1800,
  adoption: 1500,
  utilisation: 1200,
  support: 1200,
  payment: 800,
  sentiment: 1000,
  engagement: 1000,
  implementation: 800,
  contract: 700,
};

export const DEFAULT_THRESHOLDS = {
  excellent: 85,
  good: 70,
  fair: 55,
  poor: 40,
};

/** Raw inputs. Any field may be absent — absence lowers confidence, not score. */
export type HealthInputs = {
  // usage
  activeUsers?: number | null;
  licensedUsers?: number | null;
  logins30d?: number | null;
  daysSinceLastActivity?: number | null;
  usageTrendBps?: number | null;
  // adoption
  featureAdoptionBps?: number | null;
  modulesAdopted?: number | null;
  modulesEntitled?: number | null;
  consumptionBps?: number | null;
  // support
  openCases?: number | null;
  severity1Cases?: number | null;
  slaBreaches90d?: number | null;
  openEscalations?: number | null;
  // payment
  pastDueCents?: number | null;
  arrCents?: number | null;
  // sentiment
  npsScore?: number | null;
  csatScore?: number | null;
  sentimentBand?: 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive' | null;
  // engagement
  executiveEngagedDays?: number | null;
  championPresent?: boolean | null;
  championTurnover?: boolean | null;
  lastBusinessReviewDays?: number | null;
  // implementation
  onboardingProgressBps?: number | null;
  timeToValueDays?: number | null;
  targetTimeToValueDays?: number | null;
  // contract
  daysToRenewal?: number | null;
  openRisks?: number | null;
  csmAssessment?: number | null;
  productGaps?: number | null;
};

export type DimensionScore = {
  dimension: HealthDimension;
  /** 0-100, or null when no input was available. */
  score: number | null;
  weightBps: number;
  /** Ranked drivers behind this dimension's score. */
  detail: string[];
};

export type HealthResult = {
  overall: number;
  band: HealthBand;
  /** Share of total weight backed by real data, in bps. */
  confidenceBps: number;
  dimensions: DimensionScore[];
  reasons: { dimension: HealthDimension; delta: number; detail: string }[];
  recommendedAction: string;
  delta: number;
  previousOverall: number | null;
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Maps a value onto 0-100 where higher input is better. */
function scaleUp(value: number, worst: number, best: number): number {
  if (best === worst) return 50;
  return clamp(((value - worst) / (best - worst)) * 100);
}

/** Maps a value onto 0-100 where higher input is worse. */
function scaleDown(value: number, best: number, worst: number): number {
  if (best === worst) return 50;
  return clamp(100 - ((value - best) / (worst - best)) * 100);
}

function avg(parts: number[]): number | null {
  if (parts.length === 0) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

function scoreUsage(i: HealthInputs): DimensionScore {
  const parts: number[] = [];
  const detail: string[] = [];

  if (i.logins30d != null && i.activeUsers != null && i.activeUsers > 0) {
    const perUser = i.logins30d / i.activeUsers;
    parts.push(scaleUp(perUser, 0, 20));
    detail.push(`${perUser.toFixed(1)} logins per active user in 30 days`);
  }
  if (i.daysSinceLastActivity != null) {
    parts.push(scaleDown(i.daysSinceLastActivity, 0, 30));
    detail.push(`${i.daysSinceLastActivity} days since last activity`);
  }
  if (i.usageTrendBps != null) {
    parts.push(scaleUp(i.usageTrendBps, -3000, 3000));
    detail.push(`usage trend ${(i.usageTrendBps / 100).toFixed(1)}%`);
  }
  return { dimension: 'usage', score: avg(parts), weightBps: 0, detail };
}

function scoreAdoption(i: HealthInputs): DimensionScore {
  const parts: number[] = [];
  const detail: string[] = [];
  if (i.featureAdoptionBps != null) {
    parts.push(clamp(i.featureAdoptionBps / 100));
    detail.push(`${(i.featureAdoptionBps / 100).toFixed(0)}% of key features in use`);
  }
  if (i.modulesAdopted != null && i.modulesEntitled != null && i.modulesEntitled > 0) {
    const pct = (i.modulesAdopted / i.modulesEntitled) * 100;
    parts.push(clamp(pct));
    detail.push(`${i.modulesAdopted} of ${i.modulesEntitled} entitled modules adopted`);
  }
  if (i.consumptionBps != null) {
    // Both under- and over-consumption are signals; 80-100% of commit is ideal.
    const pct = i.consumptionBps / 100;
    parts.push(pct >= 80 && pct <= 110 ? 100 : pct < 80 ? scaleUp(pct, 0, 80) : scaleDown(pct, 110, 200));
    detail.push(`${pct.toFixed(0)}% of committed volume consumed`);
  }
  return { dimension: 'adoption', score: avg(parts), weightBps: 0, detail };
}

function scoreUtilisation(i: HealthInputs): DimensionScore {
  const parts: number[] = [];
  const detail: string[] = [];
  if (i.activeUsers != null && i.licensedUsers != null && i.licensedUsers > 0) {
    const pct = (i.activeUsers / i.licensedUsers) * 100;
    parts.push(clamp(pct));
    detail.push(`${i.activeUsers} of ${i.licensedUsers} licences active (${pct.toFixed(0)}%)`);
    if (pct < 50) detail.push('shelfware risk — licences materially under-used');
    if (pct > 95) detail.push('at licence ceiling — expansion opportunity');
  }
  return { dimension: 'utilisation', score: avg(parts), weightBps: 0, detail };
}

function scoreSupport(i: HealthInputs): DimensionScore {
  const parts: number[] = [];
  const detail: string[] = [];
  if (i.openCases != null) {
    parts.push(scaleDown(i.openCases, 0, 15));
    detail.push(`${i.openCases} open cases`);
  }
  if (i.severity1Cases != null) {
    parts.push(scaleDown(i.severity1Cases, 0, 3));
    if (i.severity1Cases > 0) detail.push(`${i.severity1Cases} severity-1 case(s) open`);
  }
  if (i.slaBreaches90d != null) {
    parts.push(scaleDown(i.slaBreaches90d, 0, 5));
    if (i.slaBreaches90d > 0) detail.push(`${i.slaBreaches90d} SLA breach(es) in 90 days`);
  }
  if (i.openEscalations != null) {
    parts.push(scaleDown(i.openEscalations, 0, 2));
    if (i.openEscalations > 0) detail.push(`${i.openEscalations} open escalation(s)`);
  }
  return { dimension: 'support', score: avg(parts), weightBps: 0, detail };
}

function scorePayment(i: HealthInputs): DimensionScore {
  const parts: number[] = [];
  const detail: string[] = [];
  if (i.pastDueCents != null) {
    if (i.pastDueCents === 0) {
      parts.push(100);
      detail.push('no past-due balance');
    } else {
      const ratio = i.arrCents && i.arrCents > 0 ? i.pastDueCents / i.arrCents : 1;
      parts.push(scaleDown(ratio * 100, 0, 25));
      detail.push(`past-due balance is ${(ratio * 100).toFixed(1)}% of ARR`);
    }
  }
  return { dimension: 'payment', score: avg(parts), weightBps: 0, detail };
}

function scoreSentiment(i: HealthInputs): DimensionScore {
  const parts: number[] = [];
  const detail: string[] = [];
  if (i.npsScore != null) {
    parts.push(scaleUp(i.npsScore, -100, 100));
    detail.push(`NPS ${i.npsScore}`);
  }
  if (i.csatScore != null) {
    parts.push(scaleUp(i.csatScore, 1, 5));
    detail.push(`CSAT ${i.csatScore}/5`);
  }
  if (i.sentimentBand) {
    const map = {
      very_negative: 5,
      negative: 28,
      neutral: 55,
      positive: 80,
      very_positive: 95,
    } as const;
    parts.push(map[i.sentimentBand]);
    detail.push(`recorded sentiment: ${i.sentimentBand.replace('_', ' ')}`);
  }
  return { dimension: 'sentiment', score: avg(parts), weightBps: 0, detail };
}

function scoreEngagement(i: HealthInputs): DimensionScore {
  const parts: number[] = [];
  const detail: string[] = [];
  if (i.executiveEngagedDays != null) {
    parts.push(scaleDown(i.executiveEngagedDays, 0, 180));
    detail.push(`${i.executiveEngagedDays} days since executive contact`);
  }
  if (i.championPresent != null) {
    parts.push(i.championPresent ? 90 : 20);
    detail.push(i.championPresent ? 'champion identified and active' : 'no active champion');
  }
  if (i.championTurnover) {
    parts.push(10);
    detail.push('champion has left the account');
  }
  if (i.lastBusinessReviewDays != null) {
    parts.push(scaleDown(i.lastBusinessReviewDays, 0, 270));
    detail.push(`${i.lastBusinessReviewDays} days since last business review`);
  }
  return { dimension: 'engagement', score: avg(parts), weightBps: 0, detail };
}

function scoreImplementation(i: HealthInputs): DimensionScore {
  const parts: number[] = [];
  const detail: string[] = [];
  if (i.onboardingProgressBps != null) {
    parts.push(clamp(i.onboardingProgressBps / 100));
    detail.push(`onboarding ${(i.onboardingProgressBps / 100).toFixed(0)}% complete`);
  }
  if (i.timeToValueDays != null && i.targetTimeToValueDays != null) {
    const ratio = i.timeToValueDays / Math.max(1, i.targetTimeToValueDays);
    parts.push(scaleDown(ratio * 100, 100, 250));
    detail.push(
      `time to value ${i.timeToValueDays}d against a ${i.targetTimeToValueDays}d target`,
    );
  }
  return { dimension: 'implementation', score: avg(parts), weightBps: 0, detail };
}

function scoreContract(i: HealthInputs): DimensionScore {
  const parts: number[] = [];
  const detail: string[] = [];
  if (i.openRisks != null) {
    parts.push(scaleDown(i.openRisks, 0, 4));
    if (i.openRisks > 0) detail.push(`${i.openRisks} open risk(s)`);
  }
  if (i.csmAssessment != null) {
    parts.push(clamp(i.csmAssessment));
    detail.push(`CSM assessment ${i.csmAssessment}/100`);
  }
  if (i.productGaps != null) {
    parts.push(scaleDown(i.productGaps, 0, 5));
    if (i.productGaps > 0) detail.push(`${i.productGaps} unmet product requirement(s)`);
  }
  if (i.daysToRenewal != null && i.daysToRenewal <= 120) {
    detail.push(`renewal in ${i.daysToRenewal} days — proximity raises the stakes`);
  }
  return { dimension: 'contract', score: avg(parts), weightBps: 0, detail };
}

export function bandFor(
  overall: number,
  thresholds = DEFAULT_THRESHOLDS,
): HealthBand {
  if (overall >= thresholds.excellent) return 'excellent';
  if (overall >= thresholds.good) return 'good';
  if (overall >= thresholds.fair) return 'fair';
  if (overall >= thresholds.poor) return 'poor';
  return 'critical';
}

/**
 * Computes health.
 *
 * Missing dimensions are dropped and the remaining weights renormalised, rather
 * than being scored as zero — an account with no usage feed is unmeasured, not
 * unhealthy. The share of weight actually backed by data becomes the confidence
 * figure, and a low-confidence score is flagged for a human read.
 */
export function computeHealth(
  inputs: HealthInputs,
  opts: {
    weights?: Partial<HealthWeights>;
    thresholds?: typeof DEFAULT_THRESHOLDS;
    previousOverall?: number | null;
    previousDimensions?: Partial<Record<HealthDimension, number>>;
  } = {},
): HealthResult {
  const weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;

  const scored: DimensionScore[] = [
    scoreUsage(inputs),
    scoreAdoption(inputs),
    scoreUtilisation(inputs),
    scoreSupport(inputs),
    scorePayment(inputs),
    scoreSentiment(inputs),
    scoreEngagement(inputs),
    scoreImplementation(inputs),
    scoreContract(inputs),
  ].map((d) => ({ ...d, weightBps: weights[d.dimension] }));

  const available = scored.filter((d) => d.score !== null);
  const availableWeight = available.reduce((s, d) => s + d.weightBps, 0);
  const totalWeight = scored.reduce((s, d) => s + d.weightBps, 0);

  const overall =
    availableWeight > 0
      ? Math.round(
          available.reduce((s, d) => s + (d.score as number) * d.weightBps, 0) /
            availableWeight,
        )
      : 0;

  const confidenceBps = totalWeight > 0 ? ratioBps(availableWeight, totalWeight) : 0;

  // Ranked reasons: biggest movers first, then the weakest dimensions.
  const reasons: { dimension: HealthDimension; delta: number; detail: string }[] = [];
  for (const d of available) {
    const prev = opts.previousDimensions?.[d.dimension];
    const delta = prev != null ? (d.score as number) - prev : 0;
    reasons.push({
      dimension: d.dimension,
      delta,
      detail: d.detail[0] ?? `${d.dimension} scored ${d.score}`,
    });
  }
  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const weakest = [...available].sort(
    (a, b) => (a.score as number) - (b.score as number),
  )[0];

  const delta = opts.previousOverall != null ? overall - opts.previousOverall : 0;

  return {
    overall,
    band: bandFor(overall, thresholds),
    confidenceBps,
    dimensions: scored,
    reasons: reasons.slice(0, 5),
    recommendedAction: recommendAction(overall, weakest, inputs, confidenceBps),
    delta,
    previousOverall: opts.previousOverall ?? null,
  };
}

function recommendAction(
  overall: number,
  weakest: DimensionScore | undefined,
  inputs: HealthInputs,
  confidenceBps: number,
): string {
  if (confidenceBps < 4000) {
    return 'Confidence is low — connect product telemetry and log a CSM assessment before acting on this score.';
  }
  if (inputs.championTurnover) {
    return 'Champion has left. Run the champion-loss play: map a new sponsor within 14 days and brief the executive sponsor.';
  }
  if ((inputs.severity1Cases ?? 0) > 0 || (inputs.openEscalations ?? 0) > 0) {
    return 'Live escalation is driving health down. Resolve the severity-1 path before any commercial conversation.';
  }
  if (!weakest) return 'Maintain current cadence.';

  switch (weakest.dimension) {
    case 'utilisation':
      return 'Licences are under-used. Run an adoption review and re-baseline seat count ahead of renewal.';
    case 'adoption':
      return 'Adoption is the weak point. Schedule enablement on the unused modules and set a 60-day adoption target.';
    case 'usage':
      return 'Usage is falling. Open a usage review with the administrator and identify the blocked workflow.';
    case 'support':
      return 'Support experience is the drag. Review open cases with the support owner and agree a resolution plan.';
    case 'payment':
      return 'Billing is in arrears. Loop in the billing contact before the renewal conversation starts.';
    case 'sentiment':
      return 'Sentiment is negative. Book an executive check-in and capture the specific dissatisfaction.';
    case 'engagement':
      return 'Relationship coverage is thin. Re-engage the executive sponsor and schedule a business review.';
    case 'implementation':
      return 'Onboarding is behind plan. Escalate the implementation milestones and reset the go-live date.';
    case 'contract':
      return 'Contract risk is elevated. Work the open risks and confirm renewal readiness with the renewal manager.';
    default:
      return overall >= 70
        ? 'Healthy. Look for expansion whitespace.'
        : 'Assign a save play and review weekly.';
  }
}

/**
 * Renewal likelihood, in basis points.
 *
 * Health carries most of the weight but not all of it: notice-window state,
 * auto-renew and champion presence move the number independently, because a
 * healthy account that has already served notice is not likely to renew.
 */
export function renewalLikelihoodBps(input: {
  healthScore: number;
  autoRenew: boolean;
  noticePassed: boolean;
  cancellationNoticeReceived: boolean;
  championPresent: boolean;
  openRisks: number;
  daysToRenewal: number;
  utilisationBps?: number | null;
  priorRenewals?: number;
}): number {
  if (input.cancellationNoticeReceived) return 0;

  let score = clamp(input.healthScore) * 80; // 0-8000 bps base
  if (input.autoRenew) score += 800;
  if (input.noticePassed && input.autoRenew) score += 700;
  if (input.championPresent) score += 400;
  else score -= 600;
  score -= input.openRisks * 350;
  if (input.utilisationBps != null && input.utilisationBps < 4000) score -= 600;
  if ((input.priorRenewals ?? 0) > 0) score += Math.min(600, input.priorRenewals! * 200);
  if (input.daysToRenewal > 180) score -= 200;

  return Math.max(0, Math.min(10_000, Math.round(score)));
}
