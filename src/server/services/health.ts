import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  accounts,
  aiInsights,
  billingAccounts,
  contacts,
  healthModels,
  healthScores,
  opportunities,
  renewals,
  risks,
  subscriptions,
  successPlans,
  usageMetrics,
  usageSignals,
} from '@/db/schema';
import { daysBetween, today, type IsoDate } from '@/domain/dates';
import {
  bandFor,
  computeHealth,
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  renewalLikelihoodBps,
  type HealthInputs,
  type HealthWeights,
} from '@/domain/health';
import { assessRenewalRisk, renewalForecastCategory, renewalScenarios } from '@/domain/renewals';
import { detectUsageSignals } from '@/domain/insights';
import { noticeWindowState } from '@/domain/subscriptions';
import type { AuditContext } from '../audit';
import { recordAudit } from '../audit';
import { accountSupportSummary } from './cases';

/**
 * Health scoring and renewal risk.
 *
 * Runs as a job rather than on read, so a score has an as-of date, a prior value
 * and a recorded reason for changing. Health that recalculates silently on every
 * page load cannot answer "why did this drop last week", which is the only
 * question anyone actually asks of it.
 */

async function modelFor(account: typeof accounts.$inferSelect): Promise<{
  id: string;
  weights: HealthWeights;
  thresholds: typeof DEFAULT_THRESHOLDS;
}> {
  const db = await getDb();
  const models = await db.select().from(healthModels).where(eq(healthModels.active, true));

  // Most specific match wins: tier, then lifecycle stage, then the default.
  const byTier = models.find((m) => m.tier === account.tier);
  const byStage = models.find((m) => m.lifecycleStage === account.lifecycleStage);
  const fallback = models.find((m) => m.isDefault) ?? models[0];
  const chosen = byTier ?? byStage ?? fallback;

  return {
    id: chosen?.id ?? 'default',
    weights: { ...DEFAULT_WEIGHTS, ...((chosen?.weights ?? {}) as Partial<HealthWeights>) },
    thresholds: {
      ...DEFAULT_THRESHOLDS,
      ...((chosen?.thresholds ?? {}) as Partial<typeof DEFAULT_THRESHOLDS>),
    },
  };
}

/** Gathers every health input for one account from its actual records. */
export async function collectHealthInputs(accountId: string): Promise<HealthInputs> {
  const db = await getDb();

  const accountRows = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  const account = accountRows[0];
  if (!account) return {};

  const usage = await db
    .select()
    .from(usageMetrics)
    .where(eq(usageMetrics.accountId, accountId))
    .orderBy(desc(usageMetrics.periodStart))
    .limit(1);
  const latestUsage = usage[0];

  const support = await accountSupportSummary(accountId);

  const billing = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.accountId, accountId))
    .limit(1);

  const plans = await db
    .select()
    .from(successPlans)
    .where(eq(successPlans.accountId, accountId))
    .orderBy(desc(successPlans.createdAt))
    .limit(1);
  const plan = plans[0];

  const champions = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.accountId, accountId), eq(contacts.isChampion, true)));

  const departedChampion = champions.some((c) => c.hasLeftCompany);
  const activeChampion = champions.some((c) => !c.hasLeftCompany);

  const execContacts = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.accountId, accountId), eq(contacts.roleType, 'executive_sponsor')));

  const lastExecEngagement = execContacts
    .map((c) => c.lastEngagedAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const nextRenewal = await db
    .select()
    .from(renewals)
    .where(
      and(
        eq(renewals.accountId, accountId),
        inArray(renewals.status, ['not_started', 'in_progress', 'quoted', 'committed']),
      ),
    )
    .orderBy(asc(renewals.renewalDate))
    .limit(1);

  const openRisks = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(risks)
    .where(and(eq(risks.accountId, accountId), eq(risks.status, 'open')));

  return {
    activeUsers: latestUsage?.activeUsers ?? null,
    licensedUsers: latestUsage?.licensedUsers ?? null,
    logins30d: latestUsage?.logins ?? null,
    daysSinceLastActivity: latestUsage?.daysSinceLastActivity ?? null,
    usageTrendBps: latestUsage?.trendBps ?? null,
    featureAdoptionBps: latestUsage?.featureAdoptionBps ?? null,
    consumptionBps: latestUsage?.consumptionBps ?? null,

    openCases: support.openCases,
    severity1Cases: support.severity1Cases,
    slaBreaches90d: support.slaBreaches90d,
    openEscalations: support.openEscalations,

    pastDueCents: billing[0]?.pastDueCents ?? null,
    arrCents: account.currentArrCents,

    npsScore: account.npsScore,
    csatScore: account.csatScore ?? support.averageCsat,
    sentimentBand: account.sentiment,

    executiveEngagedDays: lastExecEngagement
      ? daysBetween(lastExecEngagement.toISOString().slice(0, 10), today())
      : null,
    championPresent: activeChampion,
    championTurnover: departedChampion && !activeChampion,
    lastBusinessReviewDays: plan?.lastReviewedAt
      ? daysBetween(plan.lastReviewedAt.toISOString().slice(0, 10), today())
      : null,

    onboardingProgressBps: plan?.onboardingProgressBps ?? null,
    timeToValueDays: plan?.timeToValueDays ?? null,
    targetTimeToValueDays: 90,

    daysToRenewal: nextRenewal[0]
      ? daysBetween(today(), nextRenewal[0].renewalDate)
      : null,
    openRisks: Number(openRisks[0]?.value ?? 0),
    csmAssessment: null,
    productGaps: support.openDefects,
  };
}

/**
 * Scores one account and stores the result with its dimensions, reasons and
 * confidence. The account row keeps a denormalised copy for list views; the
 * `health_scores` table is the history.
 */
export async function scoreAccountHealth(
  accountId: string,
  ctx: AuditContext,
  asOf: IsoDate = today(),
): Promise<{
  overall: number;
  band: string;
  delta: number;
  confidenceBps: number;
  recommendedAction: string;
}> {
  const db = await getDb();
  const accountRows = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  const account = accountRows[0];
  if (!account) throw new Error(`Account ${accountId} not found`);

  const model = await modelFor(account);
  const inputs = await collectHealthInputs(accountId);

  const previous = await db
    .select()
    .from(healthScores)
    .where(eq(healthScores.accountId, accountId))
    .orderBy(desc(healthScores.asOfDate))
    .limit(1);

  const priorDimensions = previous[0]?.dimensions as
    | Record<string, number | null>
    | undefined;

  const result = computeHealth(inputs, {
    weights: model.weights,
    thresholds: model.thresholds,
    previousOverall: previous[0]?.overall ?? null,
    previousDimensions: priorDimensions
      ? (Object.fromEntries(
          Object.entries(priorDimensions).filter(([, v]) => typeof v === 'number'),
        ) as never)
      : undefined,
  });

  // One score per account per day; recomputing the same day overwrites.
  await db
    .delete(healthScores)
    .where(and(eq(healthScores.accountId, accountId), eq(healthScores.asOfDate, asOf)));

  await db.insert(healthScores).values({
    accountId,
    modelId: model.id,
    asOfDate: asOf,
    overall: result.overall,
    band: result.band,
    confidenceBps: result.confidenceBps,
    previousOverall: result.previousOverall,
    delta: result.delta,
    dimensions: Object.fromEntries(result.dimensions.map((d) => [d.dimension, d.score])),
    reasons: result.reasons,
    recommendedAction: result.recommendedAction,
  });

  await db
    .update(accounts)
    .set({
      healthScore: result.overall,
      healthBand: result.band,
      healthTrend: result.delta,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, accountId));

  if (Math.abs(result.delta) >= 10 && result.previousOverall != null) {
    await recordAudit(ctx, {
      objectType: 'accounts',
      recordId: accountId,
      action: 'update',
      field: 'healthScore',
      oldValue: String(result.previousOverall),
      newValue: String(result.overall),
      metadata: { reasons: result.reasons, confidenceBps: result.confidenceBps },
    });
  }

  return {
    overall: result.overall,
    band: result.band,
    delta: result.delta,
    confidenceBps: result.confidenceBps,
    recommendedAction: result.recommendedAction,
  };
}

/** Scores every customer. The nightly health job. */
export async function scoreAllAccounts(
  ctx: AuditContext,
  asOf: IsoDate = today(),
): Promise<{ scored: number; critical: number; improved: number; declined: number }> {
  const db = await getDb();
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.isCustomer, true));

  let critical = 0;
  let improved = 0;
  let declined = 0;

  for (const row of rows) {
    const result = await scoreAccountHealth(row.id, ctx, asOf);
    if (result.band === 'critical' || result.band === 'poor') critical++;
    if (result.delta > 0) improved++;
    if (result.delta < 0) declined++;
  }

  return { scored: rows.length, critical, improved, declined };
}

/* --------------------------------------------------------------- renewal risk */

/**
 * Re-assesses every open renewal: risk level, likelihood, scenarios and forecast
 * category. This is what keeps the renewal forecast honest without anyone
 * hand-editing it.
 */
export async function refreshRenewalRisk(
  ctx: AuditContext,
): Promise<{ assessed: number; escalated: number; atRiskArrCents: number }> {
  const db = await getDb();

  const rows = await db
    .select({ renewal: renewals, account: accounts, subscription: subscriptions })
    .from(renewals)
    .innerJoin(accounts, eq(renewals.accountId, accounts.id))
    .innerJoin(subscriptions, eq(renewals.subscriptionId, subscriptions.id))
    .where(inArray(renewals.status, ['not_started', 'in_progress', 'quoted', 'committed']));

  let escalated = 0;
  let atRiskArrCents = 0;

  for (const row of rows) {
    const support = await accountSupportSummary(row.account.id);
    const usage = await db
      .select()
      .from(usageMetrics)
      .where(eq(usageMetrics.accountId, row.account.id))
      .orderBy(desc(usageMetrics.periodStart))
      .limit(1);

    const champions = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.accountId, row.account.id), eq(contacts.isChampion, true)));

    const billing = await db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.accountId, row.account.id))
      .limit(1);

    const openRisks = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(risks)
      .where(and(eq(risks.accountId, row.account.id), eq(risks.status, 'open')));

    const daysToRenewal = daysBetween(today(), row.renewal.renewalDate);
    const notice = noticeWindowState(
      {
        endDate: row.subscription.endDate,
        noticeDays: row.subscription.noticeDays,
        autoRenew: row.subscription.autoRenew,
      },
      today(),
    );

    const risk = assessRenewalRisk({
      healthScore: row.account.healthScore,
      renewalLikelihoodBps: row.renewal.renewalLikelihoodBps,
      daysToRenewal,
      openRisks: Number(openRisks[0]?.value ?? 0),
      openSeverity1Cases: support.severity1Cases,
      slaBreaches90d: support.slaBreaches90d,
      utilisationBps: usage[0]?.utilisationBps ?? null,
      championPresent: champions.some((c) => !c.hasLeftCompany),
      championTurnover: champions.some((c) => c.hasLeftCompany),
      executiveEngagedDays: null,
      pastDueCents: billing[0]?.pastDueCents ?? 0,
      cancellationNoticeReceived: Boolean(row.renewal.cancellationNoticeReceivedAt),
      autoRenew: row.renewal.autoRenew,
      arrCents: row.renewal.renewableArrCents,
    });

    const likelihood = renewalLikelihoodBps({
      healthScore: row.account.healthScore ?? 60,
      autoRenew: row.renewal.autoRenew,
      noticePassed: notice.noticePassed,
      cancellationNoticeReceived: Boolean(row.renewal.cancellationNoticeReceivedAt),
      championPresent: champions.some((c) => !c.hasLeftCompany),
      openRisks: Number(openRisks[0]?.value ?? 0),
      daysToRenewal,
      utilisationBps: usage[0]?.utilisationBps ?? null,
    });

    const scenarios = renewalScenarios({
      renewableArrCents: row.renewal.renewableArrCents,
      upliftBps: row.renewal.upliftBps,
      riskLevel: risk.level,
    });

    const category = renewalForecastCategory({
      autoRenew: row.renewal.autoRenew,
      noticePassed: notice.noticePassed,
      cancellationNoticeReceived: Boolean(row.renewal.cancellationNoticeReceivedAt),
      riskLevel: risk.level,
      renewalLikelihoodBps: likelihood,
      isQuoted: row.renewal.status === 'quoted',
      isCommitted: row.renewal.status === 'committed',
    });

    await db
      .update(renewals)
      .set({
        riskLevel: risk.level,
        renewalLikelihoodBps: likelihood,
        churnRiskArrCents: risk.churnRiskArrCents,
        upsideArrCents: scenarios.upsideArrCents,
        downsideArrCents: scenarios.downsideArrCents,
        expectedArrCents: scenarios.expectedArrCents,
        forecastCategory: category,
        requiresApproval: risk.requiresEscalation,
        escalatedAt: risk.requiresEscalation ? new Date() : row.renewal.escalatedAt,
        updatedAt: new Date(),
      })
      .where(eq(renewals.id, row.renewal.id));

    if (row.renewal.opportunityId) {
      await db
        .update(opportunities)
        .set({
          forecastCategory: category,
          renewalRiskLevel: risk.level,
          expectedRenewalArrCents: scenarios.expectedArrCents,
          updatedAt: new Date(),
        })
        .where(eq(opportunities.id, row.renewal.opportunityId));
    }

    if (risk.requiresEscalation) escalated++;
    atRiskArrCents += risk.churnRiskArrCents;
  }

  return { assessed: rows.length, escalated, atRiskArrCents };
}

/* --------------------------------------------------------------- usage signals */

/**
 * Turns the latest telemetry into commercial signals and stores them as insights.
 * Nothing is auto-applied — an expansion signal creates a recommendation, not an
 * opportunity, because the seller has context the model does not.
 */
export async function detectSignals(
  ctx: AuditContext,
): Promise<{ signals: number; insights: number; expansion: number; churnRisk: number }> {
  const db = await getDb();

  const rows = await db
    .select({ usage: usageMetrics, account: accounts })
    .from(usageMetrics)
    .innerJoin(accounts, eq(usageMetrics.accountId, accounts.id))
    .orderBy(desc(usageMetrics.periodStart))
    .limit(500);

  const seen = new Set<string>();
  let signalCount = 0;
  let insightCount = 0;
  let expansion = 0;
  let churnRisk = 0;

  for (const row of rows) {
    if (seen.has(row.account.id)) continue;
    seen.add(row.account.id);

    const nextRenewal = await db
      .select({ renewalDate: renewals.renewalDate })
      .from(renewals)
      .where(
        and(
          eq(renewals.accountId, row.account.id),
          inArray(renewals.status, ['not_started', 'in_progress', 'quoted', 'committed']),
        ),
      )
      .orderBy(asc(renewals.renewalDate))
      .limit(1);

    const activeSub = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.accountId, row.account.id), eq(subscriptions.status, 'active')))
      .limit(1);

    const perSeat =
      row.usage.licensedUsers > 0
        ? Math.round(row.account.currentArrCents / row.usage.licensedUsers)
        : 0;

    const insights = detectUsageSignals({
      accountId: row.account.id,
      subscriptionId: activeSub[0]?.id ?? null,
      licensedUsers: row.usage.licensedUsers,
      activeUsers: row.usage.activeUsers,
      utilisationBps: row.usage.utilisationBps,
      trendBps: row.usage.trendBps ?? 0,
      daysSinceLastActivity: row.usage.daysSinceLastActivity ?? 0,
      featureAdoptionBps: row.usage.featureAdoptionBps,
      consumptionBps: row.usage.consumptionBps,
      currentArrCents: row.account.currentArrCents,
      netUnitCents: perSeat,
      daysToRenewal: nextRenewal[0]
        ? daysBetween(today(), nextRenewal[0].renewalDate)
        : null,
    });

    for (const insight of insights) {
      const signalType =
        insight.kind === 'expansion_signal'
          ? 'expansion_signal'
          : insight.kind === 'churn_signal'
            ? 'churn_risk'
            : 'adoption_stall';

      const existing = await db
        .select({ id: usageSignals.id })
        .from(usageSignals)
        .where(
          and(
            eq(usageSignals.accountId, row.account.id),
            eq(usageSignals.type, signalType),
            eq(usageSignals.status, 'open'),
          ),
        )
        .limit(1);

      if (!existing[0]) {
        await db.insert(usageSignals).values({
          accountId: row.account.id,
          subscriptionId: activeSub[0]?.id ?? null,
          type: signalType,
          strength: Math.round(insight.confidenceBps / 100),
          detail: insight.title,
          evidence: { signals: insight.evidence },
          status: 'open',
        });
        signalCount++;
        if (signalType === 'expansion_signal') expansion++;
        if (signalType === 'churn_risk') churnRisk++;
      }

      const existingInsight = await db
        .select({ id: aiInsights.id })
        .from(aiInsights)
        .where(
          and(
            eq(aiInsights.objectType, insight.objectType),
            eq(aiInsights.recordId, insight.recordId),
            eq(aiInsights.kind, insight.kind),
            eq(aiInsights.status, 'open'),
          ),
        )
        .limit(1);

      if (!existingInsight[0]) {
        await db.insert(aiInsights).values({
          kind: insight.kind,
          objectType: insight.objectType,
          recordId: insight.recordId,
          accountId: insight.accountId ?? null,
          title: insight.title,
          detail: insight.detail,
          confidenceBps: insight.confidenceBps,
          severity: insight.severity,
          evidence: insight.evidence,
          recommendedAction: insight.recommendedAction,
          proposedChange: insight.proposedChange ?? null,
          status: 'open',
        });
        insightCount++;
      }
    }
  }

  await recordAudit(ctx, {
    objectType: 'accounts',
    recordId: 'batch',
    action: 'ai_action',
    metadata: { signals: signalCount, insights: insightCount, accounts: seen.size },
  });

  return { signals: signalCount, insights: insightCount, expansion, churnRisk };
}

export { bandFor, isNull };
