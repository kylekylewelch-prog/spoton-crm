import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  accounts,
  arrMovements,
  arrSnapshots,
  attributionTouches,
  campaigns,
  cases,
  healthScores,
  leads,
  opportunities,
  pipelineSnapshots,
  products,
  quotas,
  renewals,
  risks,
  slaTimers,
  stageHistory,
  subscriptionItems,
  subscriptions,
  usageMetrics,
  users,
} from '@/db/schema';
import {
  addDays,
  fiscalQuarter,
  monthsBetween,
  quarterBounds,
  today,
  type IsoDate,
} from '@/domain/dates';
import { buildWaterfallSeries, dealAverages, retention, type ArrMovement } from '@/domain/arr';
import { funnel, whitespace } from '@/domain/metrics';
import { pipelineAging, rollupForecast, stageConversion, winRate, type ForecastDeal } from '@/domain/forecast';
import { ratioBps } from '@/domain/money';
import { OPEN_STAGES, type StageKey } from '@/domain/stages';

/**
 * The reporting layer.
 *
 * Every figure here is derived from the same ledgers the operational screens write
 * to, which is the whole point: leadership answers come out of the system of
 * record rather than out of a spreadsheet reconciling three exports.
 */

/* ------------------------------------------------------------ ARR & retention */

export async function arrWaterfall(
  from: IsoDate,
  to: IsoDate,
): Promise<{
  periods: ReturnType<typeof buildWaterfallSeries>;
  openingArrCents: number;
  closingArrCents: number;
}> {
  const db = await getDb();

  const movements = await db
    .select()
    .from(arrMovements)
    .orderBy(asc(arrMovements.effectiveDate));

  const opening = movements
    .filter((m) => m.effectiveDate < from)
    .reduce((s, m) => s + m.arrDeltaCents, 0);

  const periods = monthsBetween(from, to);
  const series = buildWaterfallSeries(
    periods,
    opening,
    movements.map<ArrMovement>((m) => ({
      type: m.type,
      arrDeltaCents: m.arrDeltaCents,
      effectiveDate: m.effectiveDate,
      accountId: m.accountId,
      subscriptionId: m.subscriptionId,
      productId: m.productId,
    })),
  );

  return {
    periods: series,
    openingArrCents: opening,
    closingArrCents: series.at(-1)?.endingArrCents ?? opening,
  };
}

export async function retentionMetrics(
  from: IsoDate,
  to: IsoDate,
): Promise<ReturnType<typeof retention> & { periodLabel: string }> {
  const db = await getDb();

  const all = await db.select().from(arrMovements);
  const opening = all
    .filter((m) => m.effectiveDate < from)
    .reduce((s, m) => s + m.arrDeltaCents, 0);

  const inPeriod = all.filter((m) => m.effectiveDate >= from && m.effectiveDate <= to);
  const sum = (t: string) =>
    inPeriod.filter((m) => m.type === t).reduce((s, m) => s + m.arrDeltaCents, 0);

  const closedRenewals = await db
    .select()
    .from(renewals)
    .where(and(gte(renewals.renewalDate, from), lte(renewals.renewalDate, to)));

  const renewableArrCents = closedRenewals.reduce((s, r) => s + r.renewableArrCents, 0);
  const renewedArrCents = closedRenewals
    .filter((r) => r.status === 'renewed' || r.status === 'auto_renewed')
    .reduce((s, r) => s + (r.closedArrCents ?? r.expectedArrCents), 0);

  const churnedLogos = new Set(
    inPeriod.filter((m) => m.type === 'churn').map((m) => m.accountId),
  ).size;

  const beginningLogos = await db
    .select({ value: sql<number>`count(distinct ${subscriptions.accountId})::int` })
    .from(subscriptions)
    .where(lte(subscriptions.startDate, from));

  return {
    ...retention({
      beginningArrCents: opening,
      expansionArrCents: sum('expansion'),
      upliftArrCents: sum('uplift'),
      contractionArrCents: sum('contraction'),
      churnArrCents: sum('churn'),
      renewableArrCents,
      renewedArrCents,
      beginningLogos: Number(beginningLogos[0]?.value ?? 0),
      churnedLogos,
    }),
    periodLabel: `${from} to ${to}`,
  };
}

/* ------------------------------------------------------------------- pipeline */

export async function pipelineByStage(): Promise<
  { stage: StageKey; count: number; arrCents: number; amountCents: number }[]
> {
  const db = await getDb();
  const rows = await db
    .select({
      stage: opportunities.stage,
      count: sql<number>`count(*)::int`,
      arrCents: sql<number>`coalesce(sum(${opportunities.arrCents}), 0)::bigint`,
      amountCents: sql<number>`coalesce(sum(${opportunities.amountCents}), 0)::bigint`,
    })
    .from(opportunities)
    .where(eq(opportunities.isClosed, false))
    .groupBy(opportunities.stage);

  return OPEN_STAGES.concat(['re_nurture']).map((stage) => {
    const row = rows.find((r) => r.stage === stage);
    return {
      stage,
      count: Number(row?.count ?? 0),
      arrCents: Number(row?.arrCents ?? 0),
      amountCents: Number(row?.amountCents ?? 0),
    };
  });
}

export async function pipelineBySource(): Promise<
  { source: string; count: number; arrCents: number }[]
> {
  const db = await getDb();
  const rows = await db
    .select({
      source: sql<string>`coalesce(${opportunities.originalSource}, 'unattributed')`,
      count: sql<number>`count(*)::int`,
      arrCents: sql<number>`coalesce(sum(${opportunities.arrCents}), 0)::bigint`,
    })
    .from(opportunities)
    .groupBy(sql`coalesce(${opportunities.originalSource}, 'unattributed')`)
    .orderBy(desc(sql`coalesce(sum(${opportunities.arrCents}), 0)`));

  return rows.map((r) => ({
    source: r.source,
    count: Number(r.count),
    arrCents: Number(r.arrCents),
  }));
}

export async function forecastForPeriod(
  fiscalPeriod: string,
  ownerId?: string | null,
): Promise<ReturnType<typeof rollupForecast>> {
  const db = await getDb();
  const { start, end } = quarterBounds(fiscalPeriod);

  const rows = await db
    .select()
    .from(opportunities)
    .where(
      and(
        gte(opportunities.closeDate, start),
        lte(opportunities.closeDate, end),
        ownerId ? eq(opportunities.ownerId, ownerId) : sql`true`,
      ),
    );

  const quotaRows = await db
    .select()
    .from(quotas)
    .where(
      and(
        eq(quotas.fiscalPeriod, fiscalPeriod),
        ownerId ? eq(quotas.userId, ownerId) : sql`true`,
      ),
    );
  const quotaCents = quotaRows.reduce((s, q) => s + q.targetCents, 0);

  const deals = rows.map<ForecastDeal>((o) => ({
    id: o.id,
    ownerId: o.ownerId,
    accountId: o.accountId,
    stage: o.stage as StageKey,
    forecastCategory: o.forecastCategory,
    type: o.type,
    amountCents: o.amountCents,
    arrCents: o.arrCents,
    closeDate: o.closeDate,
    isClosed: o.isClosed,
    isWon: o.isWon,
    probabilityBps: o.probabilityBps,
  }));

  return rollupForecast(deals, fiscalPeriod, quotaCents, 'arr');
}

export async function pipelineHealth(): Promise<{
  aging: ReturnType<typeof pipelineAging>;
  conversion: ReturnType<typeof stageConversion>;
  winRate: ReturnType<typeof winRate>;
  averages: ReturnType<typeof dealAverages>;
}> {
  const db = await getDb();

  const open = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.isClosed, false));

  const closed = await db
    .select({ isClosed: opportunities.isClosed, isWon: opportunities.isWon })
    .from(opportunities)
    .where(eq(opportunities.isClosed, true));

  const won = await db
    .select({ arrCents: opportunities.arrCents, tcvCents: opportunities.tcvCents })
    .from(opportunities)
    .where(and(eq(opportunities.isClosed, true), eq(opportunities.isWon, true)));

  const history = await db
    .select({
      opportunityId: stageHistory.opportunityId,
      toStage: stageHistory.toStage,
      durationDays: stageHistory.durationDays,
    })
    .from(stageHistory);

  return {
    aging: pipelineAging(
      open.map((o) => ({
        id: o.id,
        stage: o.stage as StageKey,
        daysInStage: o.stageEnteredAt
          ? Math.max(0, Math.round((Date.now() - o.stageEnteredAt.getTime()) / 86_400_000))
          : 0,
      })),
    ),
    conversion: stageConversion(
      history.map((h) => ({
        opportunityId: h.opportunityId,
        toStage: h.toStage as StageKey,
        durationDays: h.durationDays,
      })),
    ),
    winRate: winRate(closed),
    averages: dealAverages(won),
  };
}

/* -------------------------------------------------------------------- renewals */

export async function renewalBook(
  horizonDays = 180,
): Promise<{
  rows: {
    id: string;
    accountId: string;
    accountName: string;
    renewalDate: string;
    noticeDate: string | null;
    renewableArrCents: number;
    expectedArrCents: number;
    coTermedAdditionsArrCents: number;
    riskLevel: string;
    status: string;
    forecastCategory: string;
    healthScore: number | null;
    autoRenew: boolean;
    daysToRenewal: number;
  }[];
  totals: {
    renewableArrCents: number;
    expectedArrCents: number;
    atRiskArrCents: number;
    committedArrCents: number;
    count: number;
  };
}> {
  const db = await getDb();
  const horizon = addDays(today(), horizonDays);

  const rows = await db
    .select({
      renewal: renewals,
      accountName: accounts.name,
      healthScore: accounts.healthScore,
    })
    .from(renewals)
    .innerJoin(accounts, eq(renewals.accountId, accounts.id))
    .where(
      and(
        lte(renewals.renewalDate, horizon),
        inArray(renewals.status, ['not_started', 'in_progress', 'quoted', 'committed']),
      ),
    )
    .orderBy(asc(renewals.renewalDate));

  const mapped = rows.map((r) => ({
    id: r.renewal.id,
    accountId: r.renewal.accountId,
    accountName: r.accountName,
    renewalDate: r.renewal.renewalDate,
    noticeDate: r.renewal.noticeDate,
    renewableArrCents: r.renewal.renewableArrCents,
    expectedArrCents: r.renewal.expectedArrCents,
    coTermedAdditionsArrCents: r.renewal.coTermedAdditionsArrCents,
    riskLevel: r.renewal.riskLevel,
    status: r.renewal.status,
    forecastCategory: r.renewal.forecastCategory,
    healthScore: r.healthScore,
    autoRenew: r.renewal.autoRenew,
    daysToRenewal: Math.round(
      (new Date(r.renewal.renewalDate).getTime() - Date.now()) / 86_400_000,
    ),
  }));

  return {
    rows: mapped,
    totals: {
      renewableArrCents: mapped.reduce((s, r) => s + r.renewableArrCents, 0),
      expectedArrCents: mapped.reduce((s, r) => s + r.expectedArrCents, 0),
      atRiskArrCents: mapped
        .filter((r) => r.riskLevel === 'high' || r.riskLevel === 'critical')
        .reduce((s, r) => s + r.renewableArrCents, 0),
      committedArrCents: mapped
        .filter((r) => r.forecastCategory === 'commit')
        .reduce((s, r) => s + r.expectedArrCents, 0),
      count: mapped.length,
    },
  };
}

/* -------------------------------------------------------------- demand funnel */

export async function acquisitionFunnel(): Promise<ReturnType<typeof funnel>> {
  const db = await getDb();

  const total = await db.select({ value: sql<number>`count(*)::int` }).from(leads);
  const mql = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(leads)
    .where(inArray(leads.status, ['mql', 'accepted', 'converted']));
  const accepted = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(leads)
    .where(inArray(leads.status, ['accepted', 'converted']));
  const converted = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.status, 'converted'));
  const wonFromLeads = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(and(eq(opportunities.isWon, true), ne(opportunities.type, 'renewal')));

  return funnel([
    { name: 'Inquiries', count: Number(total[0]?.value ?? 0) },
    { name: 'MQL', count: Number(mql[0]?.value ?? 0) },
    { name: 'Sales Accepted', count: Number(accepted[0]?.value ?? 0) },
    { name: 'Opportunity', count: Number(converted[0]?.value ?? 0) },
    { name: 'Closed Won', count: Number(wonFromLeads[0]?.value ?? 0) },
  ]);
}

export async function campaignRoi(): Promise<
  {
    campaignId: string;
    name: string;
    type: string;
    costCents: number;
    sourcedArrCents: number;
    influencedArrCents: number;
    roiBps: number;
  }[]
> {
  const db = await getDb();
  const campaignRows = await db.select().from(campaigns);

  const out = [];
  for (const c of campaignRows) {
    const sourced = await db
      .select({ value: sql<number>`coalesce(sum(${attributionTouches.creditedArrCents}), 0)::bigint` })
      .from(attributionTouches)
      .where(
        and(
          eq(attributionTouches.campaignId, c.id),
          eq(attributionTouches.model, 'opportunity_creation'),
        ),
      );

    const influenced = await db
      .select({ value: sql<number>`coalesce(sum(${attributionTouches.creditedArrCents}), 0)::bigint` })
      .from(attributionTouches)
      .where(and(eq(attributionTouches.campaignId, c.id), eq(attributionTouches.model, 'linear')));

    const sourcedArrCents = Number(sourced[0]?.value ?? 0);
    out.push({
      campaignId: c.id,
      name: c.name,
      type: c.type,
      costCents: c.actualCostCents,
      sourcedArrCents,
      influencedArrCents: Number(influenced[0]?.value ?? 0),
      roiBps: c.actualCostCents > 0 ? ratioBps(sourcedArrCents, c.actualCostCents) : 0,
    });
  }

  return out.sort((a, b) => b.sourcedArrCents - a.sourcedArrCents);
}

/* ------------------------------------------------------------ customer health */

export async function healthDistribution(): Promise<
  { band: string; count: number; arrCents: number }[]
> {
  const db = await getDb();
  const rows = await db
    .select({
      band: sql<string>`coalesce(${accounts.healthBand}::text, 'unscored')`,
      count: sql<number>`count(*)::int`,
      arrCents: sql<number>`coalesce(sum(${accounts.currentArrCents}), 0)::bigint`,
    })
    .from(accounts)
    .where(eq(accounts.isCustomer, true))
    .groupBy(sql`coalesce(${accounts.healthBand}::text, 'unscored')`);

  const order = ['excellent', 'good', 'fair', 'poor', 'critical', 'unscored'];
  return rows
    .map((r) => ({ band: r.band, count: Number(r.count), arrCents: Number(r.arrCents) }))
    .sort((a, b) => order.indexOf(a.band) - order.indexOf(b.band));
}

export async function atRiskAccounts(limit = 20): Promise<
  {
    accountId: string;
    name: string;
    currentArrCents: number;
    healthScore: number | null;
    healthBand: string | null;
    openCases: number;
    daysToRenewal: number | null;
    csmName: string | null;
  }[]
> {
  const db = await getDb();

  const rows = await db
    .select({
      account: accounts,
      csmName: users.name,
    })
    .from(accounts)
    .leftJoin(users, eq(accounts.csmId, users.id))
    .where(and(eq(accounts.isCustomer, true), lte(accounts.healthScore, 60)))
    .orderBy(desc(accounts.currentArrCents))
    .limit(limit);

  const out = [];
  for (const r of rows) {
    const openCases = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(cases)
      .where(
        and(
          eq(cases.accountId, r.account.id),
          inArray(cases.status, ['new', 'open', 'pending_customer', 'escalated']),
        ),
      );

    const nextRenewal = await db
      .select({ renewalDate: renewals.renewalDate })
      .from(renewals)
      .where(
        and(
          eq(renewals.accountId, r.account.id),
          inArray(renewals.status, ['not_started', 'in_progress', 'quoted', 'committed']),
        ),
      )
      .orderBy(asc(renewals.renewalDate))
      .limit(1);

    out.push({
      accountId: r.account.id,
      name: r.account.name,
      currentArrCents: r.account.currentArrCents,
      healthScore: r.account.healthScore,
      healthBand: r.account.healthBand,
      openCases: Number(openCases[0]?.value ?? 0),
      daysToRenewal: nextRenewal[0]
        ? Math.round((new Date(nextRenewal[0].renewalDate).getTime() - Date.now()) / 86_400_000)
        : null,
      csmName: r.csmName,
    });
  }

  return out;
}

/* -------------------------------------------------------- expansion whitespace */

export async function expansionWhitespace(limit = 20): Promise<
  {
    accountId: string;
    name: string;
    currentArrCents: number;
    potentialArrCents: number;
    whitespaceArrCents: number;
    penetrationBps: number;
    missingFamilies: string[];
    healthScore: number | null;
  }[]
> {
  const db = await getDb();

  const allFamilies = [
    ...new Set(
      (await db.select({ family: products.family }).from(products).where(eq(products.active, true))).map(
        (r) => r.family,
      ),
    ),
  ];

  const customerAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.isCustomer, true))
    .orderBy(desc(accounts.currentArrCents))
    .limit(100);

  const out = [];
  for (const account of customerAccounts) {
    const owned = await db
      .select({ family: products.family })
      .from(subscriptionItems)
      .innerJoin(subscriptions, eq(subscriptionItems.subscriptionId, subscriptions.id))
      .innerJoin(products, eq(subscriptionItems.productId, products.id))
      .where(
        and(
          eq(subscriptions.accountId, account.id),
          eq(subscriptions.status, 'active'),
          eq(subscriptionItems.status, 'active'),
        ),
      );

    const result = whitespace({
      ownedProductFamilies: [...new Set(owned.map((o) => o.family))],
      allProductFamilies: allFamilies,
      currentArrCents: account.currentArrCents,
      potentialArrCents: account.potentialArrCents ?? account.currentArrCents,
    });

    if (result.whitespaceArrCents <= 0 && result.missingFamilies.length === 0) continue;

    out.push({
      accountId: account.id,
      name: account.name,
      currentArrCents: account.currentArrCents,
      potentialArrCents: account.potentialArrCents ?? account.currentArrCents,
      whitespaceArrCents: result.whitespaceArrCents,
      penetrationBps: result.penetrationBps,
      missingFamilies: result.missingFamilies,
      healthScore: account.healthScore,
    });
  }

  return out.sort((a, b) => b.whitespaceArrCents - a.whitespaceArrCents).slice(0, limit);
}

/* ------------------------------------------------------------------ adoption */

export async function adoptionSummary(): Promise<{
  licensedUsers: number;
  activeUsers: number;
  utilisationBps: number;
  accountsBelowHalfUtilisation: number;
  accountsAtCeiling: number;
  averageFeatureAdoptionBps: number;
}> {
  const db = await getDb();
  const latest = await db
    .select()
    .from(usageMetrics)
    .orderBy(desc(usageMetrics.periodStart))
    .limit(500);

  // Most recent period per account.
  const byAccount = new Map<string, (typeof latest)[number]>();
  for (const row of latest) {
    if (!byAccount.has(row.accountId)) byAccount.set(row.accountId, row);
  }
  const rows = [...byAccount.values()];

  const licensedUsers = rows.reduce((s, r) => s + r.licensedUsers, 0);
  const activeUsers = rows.reduce((s, r) => s + r.activeUsers, 0);

  return {
    licensedUsers,
    activeUsers,
    utilisationBps: licensedUsers > 0 ? ratioBps(activeUsers, licensedUsers) : 0,
    accountsBelowHalfUtilisation: rows.filter((r) => r.utilisationBps < 5000).length,
    accountsAtCeiling: rows.filter((r) => r.utilisationBps >= 9500).length,
    averageFeatureAdoptionBps:
      rows.length > 0
        ? Math.round(rows.reduce((s, r) => s + r.featureAdoptionBps, 0) / rows.length)
        : 0,
  };
}

/* ------------------------------------------------------------------- SLA view */

export async function slaAttainment(): Promise<{
  timers: { name: string; met: number; breached: number; running: number; attainmentBps: number }[];
  overall: { met: number; breached: number; attainmentBps: number };
}> {
  const db = await getDb();
  const rows = await db
    .select({
      name: slaTimers.name,
      status: slaTimers.status,
      value: sql<number>`count(*)::int`,
    })
    .from(slaTimers)
    .groupBy(slaTimers.name, slaTimers.status);

  const names = [...new Set(rows.map((r) => r.name))];
  const timers = names.map((name) => {
    const forName = rows.filter((r) => r.name === name);
    const met = Number(forName.find((r) => r.status === 'met')?.value ?? 0);
    const breached = Number(forName.find((r) => r.status === 'breached')?.value ?? 0);
    const running = Number(forName.find((r) => r.status === 'running')?.value ?? 0);
    return {
      name,
      met,
      breached,
      running,
      attainmentBps: met + breached > 0 ? ratioBps(met, met + breached) : 0,
    };
  });

  const met = timers.reduce((s, t) => s + t.met, 0);
  const breached = timers.reduce((s, t) => s + t.breached, 0);

  return {
    timers,
    overall: {
      met,
      breached,
      attainmentBps: met + breached > 0 ? ratioBps(met, met + breached) : 0,
    },
  };
}

/* -------------------------------------------------------------- the dashboard */

/**
 * The executive summary. Deliberately shaped around the ten questions a revenue
 * leader has to answer, each drawn from the operational tables rather than a
 * parallel reporting store.
 */
export async function executiveDashboard(): Promise<{
  arr: { currentCents: number; movementThisQuarter: Awaited<ReturnType<typeof arrWaterfall>> };
  retention: Awaited<ReturnType<typeof retentionMetrics>>;
  pipeline: { byStage: Awaited<ReturnType<typeof pipelineByStage>>; totalOpenArrCents: number };
  forecast: Awaited<ReturnType<typeof forecastForPeriod>>;
  renewals: Awaited<ReturnType<typeof renewalBook>>['totals'];
  health: Awaited<ReturnType<typeof healthDistribution>>;
  sla: Awaited<ReturnType<typeof slaAttainment>>['overall'];
  counts: {
    customers: number;
    openOpportunities: number;
    openCases: number;
    escalatedCases: number;
    openRisks: number;
    unassignedLeads: number;
  };
}> {
  const db = await getDb();
  const quarter = fiscalQuarter(today());
  const { start, end } = quarterBounds(quarter);

  const arrRows = await db
    .select({ value: sql<number>`coalesce(sum(${accounts.currentArrCents}), 0)::bigint` })
    .from(accounts)
    .where(eq(accounts.isCustomer, true));

  const [movement, ret, byStage, fc, renewalTotals, health, sla] = await Promise.all([
    arrWaterfall(start, end),
    retentionMetrics(start, end),
    pipelineByStage(),
    forecastForPeriod(quarter),
    renewalBook(180).then((r) => r.totals),
    healthDistribution(),
    slaAttainment(),
  ]);

  const customers = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.isCustomer, true));
  const openOpps = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(eq(opportunities.isClosed, false));
  const openCases = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(cases)
    .where(inArray(cases.status, ['new', 'open', 'pending_customer', 'escalated']));
  const escalated = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(cases)
    .where(eq(cases.isEscalated, true));
  const openRisks = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(risks)
    .where(eq(risks.status, 'open'));
  const unassigned = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(leads)
    .where(sql`${leads.ownerId} is null`);

  return {
    arr: { currentCents: Number(arrRows[0]?.value ?? 0), movementThisQuarter: movement },
    retention: ret,
    pipeline: {
      byStage,
      totalOpenArrCents: byStage
        .filter((s) => s.stage !== 're_nurture')
        .reduce((s, r) => s + r.arrCents, 0),
    },
    forecast: fc,
    renewals: renewalTotals,
    health,
    sla: sla.overall,
    counts: {
      customers: Number(customers[0]?.value ?? 0),
      openOpportunities: Number(openOpps[0]?.value ?? 0),
      openCases: Number(openCases[0]?.value ?? 0),
      escalatedCases: Number(escalated[0]?.value ?? 0),
      openRisks: Number(openRisks[0]?.value ?? 0),
      unassignedLeads: Number(unassigned[0]?.value ?? 0),
    },
  };
}

/* ------------------------------------------------------------------ snapshots */

/**
 * Nightly snapshot job. Without this, "what changed since last week" and every
 * cohort question are unanswerable — current-state tables cannot reconstruct
 * their own history.
 */
export async function takeSnapshots(asOf: IsoDate = today()): Promise<{
  pipelineRows: number;
  arrRows: number;
}> {
  const db = await getDb();

  const open = await db.select().from(opportunities);
  if (open.length > 0) {
    await db.delete(pipelineSnapshots).where(eq(pipelineSnapshots.asOfDate, asOf));
    await db.insert(pipelineSnapshots).values(
      open.map((o) => ({
        asOfDate: asOf,
        opportunityId: o.id,
        accountId: o.accountId,
        ownerId: o.ownerId,
        stage: o.stage,
        forecastCategory: o.forecastCategory,
        type: o.type,
        amountCents: o.amountCents,
        arrCents: o.arrCents,
        closeDate: o.closeDate,
        probabilityBps: o.probabilityBps,
        daysInStage: o.stageEnteredAt
          ? Math.max(0, Math.round((Date.now() - o.stageEnteredAt.getTime()) / 86_400_000))
          : 0,
        fiscalPeriod: fiscalQuarter(o.closeDate),
        isClosed: o.isClosed,
        isWon: o.isWon,
      })),
    );
  }

  const activeSubs = await db
    .select({ sub: subscriptions, account: accounts })
    .from(subscriptions)
    .innerJoin(accounts, eq(subscriptions.accountId, accounts.id))
    .where(eq(subscriptions.status, 'active'));

  if (activeSubs.length > 0) {
    await db.delete(arrSnapshots).where(eq(arrSnapshots.asOfDate, asOf));
    await db.insert(arrSnapshots).values(
      activeSubs.map((r) => ({
        asOfDate: asOf,
        accountId: r.account.id,
        subscriptionId: r.sub.id,
        arrCents: r.sub.currentArrCents,
        cohortMonth: r.account.customerSince?.slice(0, 7) ?? r.sub.startDate.slice(0, 7),
        tier: r.account.tier,
        region: r.account.region,
        industry: r.account.industry,
      })),
    );
  }

  return { pipelineRows: open.length, arrRows: activeSubs.length };
}

export { healthScores };
