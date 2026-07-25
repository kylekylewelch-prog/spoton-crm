import { ratioBps } from './money';

/**
 * SaaS metric definitions.
 *
 * Kept in one place so the dashboard, the API, the MCP tools and the tests all
 * compute a metric exactly one way. Where a metric is commonly defined two
 * different ways, the choice made here is stated in the comment — that is usually
 * the difference between two teams' numbers disagreeing.
 */

/* -------------------------------------------------------------- acquisition */

export type FunnelStage = { name: string; count: number };

export type FunnelResult = {
  stages: (FunnelStage & {
    /** Conversion from the immediately preceding stage. */
    stepConversionBps: number;
    /** Conversion from the top of the funnel. */
    cumulativeConversionBps: number;
  })[];
};

export function funnel(stages: FunnelStage[]): FunnelResult {
  const top = stages[0]?.count ?? 0;
  return {
    stages: stages.map((s, i) => ({
      ...s,
      stepConversionBps: i === 0 ? 10_000 : ratioBps(s.count, stages[i - 1].count),
      cumulativeConversionBps: top > 0 ? ratioBps(s.count, top) : 0,
    })),
  };
}

/**
 * CAC payback in months.
 *
 * Uses gross-margin-adjusted new ARR, which is the conservative definition: a
 * payback figure computed on raw revenue understates how long the cash is out.
 */
export function cacPayback(input: {
  salesAndMarketingSpendCents: number;
  newArrCents: number;
  grossMarginBps: number;
}): { cacPaybackMonths: number; cacCents: number; magicNumberBps: number } {
  const grossProfitArr = Math.round(
    (input.newArrCents * input.grossMarginBps) / 10_000,
  );
  return {
    cacCents: input.salesAndMarketingSpendCents,
    cacPaybackMonths:
      grossProfitArr > 0
        ? Math.round((input.salesAndMarketingSpendCents / grossProfitArr) * 12 * 10) / 10
        : 0,
    magicNumberBps:
      input.salesAndMarketingSpendCents > 0
        ? ratioBps(input.newArrCents, input.salesAndMarketingSpendCents)
        : 0,
  };
}

/**
 * Customer lifetime value.
 *
 * Derived from gross revenue retention rather than a logo-churn guess, because in
 * a business with expansion the ARR-weighted figure is the one that matches the
 * revenue actually collected.
 */
export function lifetimeValue(input: {
  averageArrCents: number;
  grossMarginBps: number;
  grossRetentionBps: number;
}): { ltvCents: number; expectedLifetimeYears: number } {
  const churnBps = Math.max(1, 10_000 - input.grossRetentionBps);
  const lifetimeYears = 10_000 / churnBps;
  const grossProfit = Math.round((input.averageArrCents * input.grossMarginBps) / 10_000);
  return {
    ltvCents: Math.round(grossProfit * lifetimeYears),
    expectedLifetimeYears: Math.round(lifetimeYears * 10) / 10,
  };
}

export function ltvToCacBps(ltvCents: number, cacCents: number): number {
  return cacCents > 0 ? ratioBps(ltvCents, cacCents) : 0;
}

/* -------------------------------------------------- bookings / billings / revenue */

export type ReconciliationRow = {
  period: string;
  /** New and expansion contract value signed in the period. */
  bookingsCents: number;
  /** Invoiced in the period. */
  billingsCents: number;
  /** Recognised in the period. */
  revenueCents: number;
  /** Signed but not yet invoiced. */
  backlogCents: number;
  /** Invoiced but not yet recognised. */
  deferredRevenueCents: number;
};

/**
 * Reconciles the three figures that a finance and a sales team will otherwise
 * argue about. Bookings lead billings lead revenue; the gaps are backlog and
 * deferred revenue, and stating them explicitly is what makes the numbers tie.
 */
export function reconcile(rows: {
  period: string;
  bookingsCents: number;
  billingsCents: number;
  revenueCents: number;
}[]): { rows: ReconciliationRow[]; tiesOut: boolean } {
  let backlog = 0;
  let deferred = 0;
  const out: ReconciliationRow[] = [];

  for (const r of rows) {
    backlog += r.bookingsCents - r.billingsCents;
    deferred += r.billingsCents - r.revenueCents;
    out.push({
      ...r,
      backlogCents: backlog,
      deferredRevenueCents: deferred,
    });
  }

  const totalBookings = rows.reduce((s, r) => s + r.bookingsCents, 0);
  const totalBillings = rows.reduce((s, r) => s + r.billingsCents, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenueCents, 0);

  return {
    rows: out,
    tiesOut: totalBookings - totalBillings === backlog && totalBillings - totalRevenue === deferred,
  };
}

/* ------------------------------------------------------------------- cohorts */

export type CohortCell = {
  cohortMonth: string;
  periodIndex: number;
  accounts: number;
  arrCents: number;
  /** ARR retained versus the cohort's month-0 ARR. */
  retentionBps: number;
};

/**
 * Builds a cohort retention matrix from ARR snapshots. Each row is a signing
 * cohort and each column is months since acquisition, expressed against the
 * cohort's own starting ARR — which is what makes expansion visible as retention
 * above 100%.
 */
export function cohortMatrix(
  snapshots: { cohortMonth: string; asOfDate: string; accountId: string; arrCents: number }[],
): CohortCell[] {
  const byCohortPeriod = new Map<string, { accounts: Set<string>; arr: number }>();

  for (const s of snapshots) {
    const idx = monthIndex(s.cohortMonth, s.asOfDate.slice(0, 7));
    if (idx < 0) continue;
    const key = `${s.cohortMonth}|${idx}`;
    const cell = byCohortPeriod.get(key) ?? { accounts: new Set<string>(), arr: 0 };
    cell.accounts.add(s.accountId);
    cell.arr += s.arrCents;
    byCohortPeriod.set(key, cell);
  }

  const baseline = new Map<string, number>();
  for (const [key, cell] of byCohortPeriod) {
    const [cohort, idxStr] = key.split('|');
    if (Number(idxStr) === 0) baseline.set(cohort, cell.arr);
  }

  return [...byCohortPeriod.entries()]
    .map(([key, cell]) => {
      const [cohortMonth, idxStr] = key.split('|');
      const base = baseline.get(cohortMonth) ?? 0;
      return {
        cohortMonth,
        periodIndex: Number(idxStr),
        accounts: cell.accounts.size,
        arrCents: cell.arr,
        retentionBps: base > 0 ? ratioBps(cell.arr, base) : 0,
      };
    })
    .sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth) || a.periodIndex - b.periodIndex);
}

function monthIndex(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/* -------------------------------------------------------- customer performance */

/**
 * Product penetration and expansion whitespace: which of an account's entitled
 * families it actually bought, and what is left to sell.
 */
export function whitespace(input: {
  ownedProductFamilies: string[];
  allProductFamilies: string[];
  currentArrCents: number;
  potentialArrCents: number;
}): {
  penetrationBps: number;
  missingFamilies: string[];
  whitespaceArrCents: number;
  whitespaceBps: number;
} {
  const owned = new Set(input.ownedProductFamilies);
  const missing = input.allProductFamilies.filter((f) => !owned.has(f));
  const whitespaceArr = Math.max(0, input.potentialArrCents - input.currentArrCents);

  return {
    penetrationBps:
      input.allProductFamilies.length > 0
        ? ratioBps(owned.size, input.allProductFamilies.length)
        : 0,
    missingFamilies: missing,
    whitespaceArrCents: whitespaceArr,
    whitespaceBps:
      input.potentialArrCents > 0 ? ratioBps(whitespaceArr, input.potentialArrCents) : 0,
  };
}

/** Time-to-value against target, in days, with a verdict. */
export function timeToValue(
  actualDays: number | null,
  targetDays: number,
): { actualDays: number | null; targetDays: number; verdict: 'ahead' | 'on_track' | 'late' | 'unknown' } {
  if (actualDays == null) return { actualDays, targetDays, verdict: 'unknown' };
  if (actualDays <= targetDays * 0.9) return { actualDays, targetDays, verdict: 'ahead' };
  if (actualDays <= targetDays * 1.1) return { actualDays, targetDays, verdict: 'on_track' };
  return { actualDays, targetDays, verdict: 'late' };
}

/** Capacity and load, for territory and coverage planning. */
export function coverageLoad(input: {
  accountsOwned: number;
  targetAccounts: number;
  arrOwnedCents: number;
  targetArrCents: number;
}): { accountLoadBps: number; arrLoadBps: number; verdict: 'under' | 'balanced' | 'over' } {
  const accountLoadBps =
    input.targetAccounts > 0 ? ratioBps(input.accountsOwned, input.targetAccounts) : 0;
  const arrLoadBps =
    input.targetArrCents > 0 ? ratioBps(input.arrOwnedCents, input.targetArrCents) : 0;
  const worst = Math.max(accountLoadBps, arrLoadBps);
  return {
    accountLoadBps,
    arrLoadBps,
    verdict: worst > 12_000 ? 'over' : worst < 7000 ? 'under' : 'balanced',
  };
}
