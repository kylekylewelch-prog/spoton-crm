import { type IsoDate, fiscalQuarter, quarterBounds } from './dates';
import { ratioBps } from './money';
import { STAGES, type StageKey, weightedValue } from './stages';
import type { ForecastCategory } from './types';

/**
 * Forecasting and pipeline intelligence.
 *
 * Two numbers coexist deliberately: the computed roll-up (categories and
 * stage-weighting, which the system derives) and the judgement (what the rep and
 * their manager actually commit to). Keeping both, and snapshotting each
 * submission, is the only way to measure bias and accuracy later — a forecast you
 * overwrite each week can never be graded.
 */

export type ForecastDeal = {
  id: string;
  ownerId: string;
  accountId: string;
  stage: StageKey;
  forecastCategory: ForecastCategory;
  type: string;
  amountCents: number;
  arrCents: number;
  closeDate: IsoDate;
  isClosed: boolean;
  isWon: boolean;
  probabilityBps?: number;
};

export type ForecastRollup = {
  fiscalPeriod: string;
  closedWonCents: number;
  commitCents: number;
  bestCaseCents: number;
  pipelineCents: number;
  omittedCents: number;
  /** closedWon + commit — the defensible number. */
  callCents: number;
  /** callCents + bestCase — the stretch. */
  bestCaseTotalCents: number;
  weightedCents: number;
  openCents: number;
  dealCount: number;
  quotaCents: number;
  gapToQuotaCents: number;
  /** Open pipeline as a multiple of the remaining gap. */
  coverageBps: number;
  attainmentBps: number;
};

/**
 * Rolls deals into forecast categories for a period.
 *
 * Closed-won is separated from commit so attainment and the remaining call are
 * never conflated. Coverage is measured against the *gap*, not the quota, because
 * once a rep is past quota the coverage question stops being meaningful.
 */
export function rollupForecast(
  deals: ForecastDeal[],
  fiscalPeriod: string,
  quotaCents = 0,
  metric: 'arr' | 'amount' = 'arr',
): ForecastRollup {
  const value = (d: ForecastDeal) => (metric === 'arr' ? d.arrCents : d.amountCents);

  const inPeriod = deals.filter((d) => fiscalQuarter(d.closeDate) === fiscalPeriod
    || d.closeDate.slice(0, 7) === fiscalPeriod);

  const closedWonCents = inPeriod
    .filter((d) => d.isClosed && d.isWon)
    .reduce((s, d) => s + value(d), 0);

  const open = inPeriod.filter((d) => !d.isClosed && !STAGES[d.stage].isParked);

  const byCategory = (c: ForecastCategory) =>
    open.filter((d) => d.forecastCategory === c).reduce((s, d) => s + value(d), 0);

  const commitCents = byCategory('commit');
  const bestCaseCents = byCategory('best_case');
  const pipelineCents = byCategory('pipeline');
  const omittedCents = byCategory('omitted');

  const weightedCents = open.reduce(
    (s, d) =>
      s +
      (d.probabilityBps !== undefined
        ? Math.round((value(d) * d.probabilityBps) / 10_000)
        : weightedValue(value(d), d.stage)),
    0,
  );

  const callCents = closedWonCents + commitCents;
  const openCents = commitCents + bestCaseCents + pipelineCents;
  const gapToQuotaCents = Math.max(0, quotaCents - closedWonCents);

  return {
    fiscalPeriod,
    closedWonCents,
    commitCents,
    bestCaseCents,
    pipelineCents,
    omittedCents,
    callCents,
    bestCaseTotalCents: callCents + bestCaseCents,
    weightedCents,
    openCents,
    dealCount: open.length,
    quotaCents,
    gapToQuotaCents,
    coverageBps: gapToQuotaCents > 0 ? ratioBps(openCents, gapToQuotaCents) : 0,
    attainmentBps: quotaCents > 0 ? ratioBps(closedWonCents, quotaCents) : 0,
  };
}

/** Default category from stage, before any human judgement is applied. */
export function defaultForecastCategory(
  stage: StageKey,
  isClosed: boolean,
  isWon: boolean,
): ForecastCategory {
  if (isClosed) return 'closed';
  if (STAGES[stage].isParked) return 'omitted';
  switch (stage) {
    case 'contract':
      return 'commit';
    case 'negotiation':
      return 'best_case';
    case 'proposal':
    case 'solution_design':
      return 'pipeline';
    default:
      return 'pipeline';
  }
}

/* ------------------------------------------------------- movement and accuracy */

export type SnapshotDeal = {
  opportunityId: string;
  stage: StageKey;
  forecastCategory: ForecastCategory;
  amountCents: number;
  arrCents: number;
  closeDate: IsoDate;
  isClosed: boolean;
  isWon: boolean;
};

export type PipelineMovement = {
  /** Deals present now but not in the prior snapshot. */
  created: string[];
  /** Deals whose close date moved out of the period. */
  slipped: { opportunityId: string; fromCloseDate: IsoDate; toCloseDate: IsoDate }[];
  /** Deals that pulled into the period. */
  pulledIn: string[];
  advanced: { opportunityId: string; fromStage: StageKey; toStage: StageKey }[];
  regressed: { opportunityId: string; fromStage: StageKey; toStage: StageKey }[];
  won: string[];
  lost: string[];
  increased: { opportunityId: string; deltaCents: number }[];
  decreased: { opportunityId: string; deltaCents: number }[];
  netChangeArrCents: number;
};

/**
 * Diffs two snapshots. This is what answers "what changed since last week" —
 * impossible from current state alone, which is why the snapshot tables exist.
 */
export function diffSnapshots(
  prior: SnapshotDeal[],
  current: SnapshotDeal[],
  fiscalPeriod: string,
): PipelineMovement {
  const priorById = new Map(prior.map((d) => [d.opportunityId, d]));
  const currentById = new Map(current.map((d) => [d.opportunityId, d]));

  const inPeriod = (d: SnapshotDeal) =>
    fiscalQuarter(d.closeDate) === fiscalPeriod || d.closeDate.slice(0, 7) === fiscalPeriod;

  const movement: PipelineMovement = {
    created: [],
    slipped: [],
    pulledIn: [],
    advanced: [],
    regressed: [],
    won: [],
    lost: [],
    increased: [],
    decreased: [],
    netChangeArrCents: 0,
  };

  for (const cur of current) {
    const before = priorById.get(cur.opportunityId);

    if (!before) {
      if (inPeriod(cur)) movement.created.push(cur.opportunityId);
      continue;
    }

    if (before.closeDate !== cur.closeDate) {
      const wasIn = inPeriod(before);
      const isIn = inPeriod(cur);
      if (wasIn && !isIn) {
        movement.slipped.push({
          opportunityId: cur.opportunityId,
          fromCloseDate: before.closeDate,
          toCloseDate: cur.closeDate,
        });
      } else if (!wasIn && isIn) {
        movement.pulledIn.push(cur.opportunityId);
      }
    }

    if (before.stage !== cur.stage) {
      const from = STAGES[before.stage].ordinal;
      const to = STAGES[cur.stage].ordinal;
      if (cur.isClosed && cur.isWon) movement.won.push(cur.opportunityId);
      else if (cur.isClosed && !cur.isWon) movement.lost.push(cur.opportunityId);
      else if (to > from)
        movement.advanced.push({
          opportunityId: cur.opportunityId,
          fromStage: before.stage,
          toStage: cur.stage,
        });
      else
        movement.regressed.push({
          opportunityId: cur.opportunityId,
          fromStage: before.stage,
          toStage: cur.stage,
        });
    }

    const delta = cur.arrCents - before.arrCents;
    if (delta > 0) movement.increased.push({ opportunityId: cur.opportunityId, deltaCents: delta });
    if (delta < 0) movement.decreased.push({ opportunityId: cur.opportunityId, deltaCents: delta });
  }

  const priorTotal = prior.filter(inPeriod).reduce((s, d) => s + d.arrCents, 0);
  const currentTotal = current.filter(inPeriod).reduce((s, d) => s + d.arrCents, 0);
  movement.netChangeArrCents = currentTotal - priorTotal;

  // Deals that vanished from the snapshot entirely.
  for (const before of prior) {
    if (!currentById.has(before.opportunityId) && inPeriod(before)) {
      movement.slipped.push({
        opportunityId: before.opportunityId,
        fromCloseDate: before.closeDate,
        toCloseDate: before.closeDate,
      });
    }
  }

  return movement;
}

export type ForecastAccuracy = {
  fiscalPeriod: string;
  submittedCents: number;
  actualCents: number;
  varianceCents: number;
  /** Signed: positive means the forecast was above actual. */
  biasBps: number;
  /** Unsigned error as a share of actual. */
  accuracyBps: number;
  verdict: 'accurate' | 'sandbagged' | 'over_committed';
};

/**
 * Grades a submission against the outcome. Within 5% is treated as accurate; a
 * persistent low forecast is sandbagging and a persistent high one is
 * over-commitment, and both are coaching signals rather than arithmetic errors.
 */
export function scoreAccuracy(
  fiscalPeriod: string,
  submittedCents: number,
  actualCents: number,
): ForecastAccuracy {
  const varianceCents = submittedCents - actualCents;
  const biasBps = actualCents > 0 ? ratioBps(varianceCents, actualCents) : 0;
  const accuracyBps =
    actualCents > 0 ? Math.max(0, 10_000 - Math.abs(ratioBps(varianceCents, actualCents))) : 0;

  return {
    fiscalPeriod,
    submittedCents,
    actualCents,
    varianceCents,
    biasBps,
    accuracyBps,
    verdict: Math.abs(biasBps) <= 500 ? 'accurate' : biasBps < 0 ? 'sandbagged' : 'over_committed',
  };
}

/* ------------------------------------------------------------- pipeline health */

export type StageConversion = {
  stage: StageKey;
  entered: number;
  advanced: number;
  conversionBps: number;
  averageDaysInStage: number;
};

export function stageConversion(
  history: { opportunityId: string; toStage: StageKey; durationDays: number | null }[],
): StageConversion[] {
  const stages: StageKey[] = ['srl', 'discovery', 'solution_design', 'proposal', 'negotiation', 'contract'];

  return stages.map((s, i) => {
    const entered = history.filter((h) => h.toStage === s).length;
    const nextStage = stages[i + 1] ?? 'closed_won';
    const advanced = history.filter((h) => h.toStage === nextStage).length;
    const durations = history
      .filter((h) => h.toStage === s && h.durationDays != null)
      .map((h) => h.durationDays as number);

    return {
      stage: s,
      entered,
      advanced,
      conversionBps: entered > 0 ? ratioBps(advanced, entered) : 0,
      averageDaysInStage:
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0,
    };
  });
}

/**
 * Sales velocity: how much qualified pipeline converts to revenue per day.
 * opportunities x average value x win rate / cycle length.
 */
export function salesVelocity(input: {
  opportunityCount: number;
  averageDealCents: number;
  winRateBps: number;
  averageCycleDays: number;
}): { velocityCentsPerDay: number } {
  if (input.averageCycleDays <= 0) return { velocityCentsPerDay: 0 };
  return {
    velocityCentsPerDay: Math.round(
      (input.opportunityCount * input.averageDealCents * (input.winRateBps / 10_000)) /
        input.averageCycleDays,
    ),
  };
}

export function winRate(deals: { isClosed: boolean; isWon: boolean }[]): {
  won: number;
  lost: number;
  winRateBps: number;
} {
  const closed = deals.filter((d) => d.isClosed);
  const won = closed.filter((d) => d.isWon).length;
  const lost = closed.length - won;
  return { won, lost, winRateBps: closed.length > 0 ? ratioBps(won, closed.length) : 0 };
}

/** Ageing buckets for deals sitting too long in stage. */
export function pipelineAging(
  deals: { id: string; stage: StageKey; daysInStage: number }[],
): { bucket: string; count: number; opportunityIds: string[] }[] {
  const buckets = [
    { bucket: '0-30 days', min: 0, max: 30 },
    { bucket: '31-60 days', min: 31, max: 60 },
    { bucket: '61-90 days', min: 61, max: 90 },
    { bucket: '90+ days', min: 91, max: Number.MAX_SAFE_INTEGER },
  ];

  return buckets.map((b) => {
    const matched = deals.filter((d) => d.daysInStage >= b.min && d.daysInStage <= b.max);
    return { bucket: b.bucket, count: matched.length, opportunityIds: matched.map((d) => d.id) };
  });
}

/** Whether a deal can still realistically close in its period. */
export function isAtRiskOfSlipping(
  deal: { stage: StageKey; closeDate: IsoDate; nextMeetingAt?: Date | null; daysInStage: number },
  asOf: IsoDate,
): { atRisk: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { start, end } = quarterBounds(fiscalQuarter(deal.closeDate));
  const daysLeft = Math.round(
    (new Date(end).getTime() - new Date(asOf).getTime()) / 86_400_000,
  );

  const ordinal = STAGES[deal.stage].ordinal;
  if (daysLeft <= 30 && ordinal < STAGES.negotiation.ordinal) {
    reasons.push(`Only ${daysLeft} days left in the quarter and still in ${STAGES[deal.stage].label}`);
  }
  if (deal.closeDate < asOf) reasons.push('Close date is in the past');
  if (!deal.nextMeetingAt) reasons.push('No next meeting scheduled');
  if (deal.daysInStage > 45) reasons.push(`${deal.daysInStage} days in current stage`);
  void start;

  return { atRisk: reasons.length > 0, reasons };
}
