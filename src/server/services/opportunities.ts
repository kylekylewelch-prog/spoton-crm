import { and, count, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  mutualActionPlans,
  opportunities,
  opportunityContactRoles,
  opportunityProducts,
  opportunityTeam,
  quoteLines,
  quotes,
  stageHistory,
} from '@/db/schema';
import { daysBetween, today } from '@/domain/dates';
import { defaultForecastCategory } from '@/domain/forecast';
import { evaluateStageGate, STAGES, stageLabel, type StageGateInput, type StageKey } from '@/domain/stages';
import type { OpportunityType } from '@/domain/types';
import type { AuthenticatedUser } from '../auth';
import { recordAudit, recordOverride, type AuditContext } from '../audit';
import { assertCan, assertCanAccessRecord, NotFoundError, ValidationError } from '../rbac';
import { provisionFromWonOpportunity } from './subscriptions';
import { emitEvent } from './integrations';

/**
 * Opportunity process control.
 *
 * Stage changes are the only path by which a deal advances, and they are gated on
 * objective exit criteria. An admin may override a gate, but the override is
 * recorded with a mandatory reason and shows up on the stage history — visible
 * exceptions are far better than gates people learn to route around.
 */

/** Assembles the record plus related-row counts the gate needs. */
export async function buildGateInput(opportunityId: string): Promise<StageGateInput> {
  const db = await getDb();

  const oppRows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  const opp = oppRows[0];
  if (!opp) throw new NotFoundError('Opportunity not found');

  const roleRows = await db
    .select()
    .from(opportunityContactRoles)
    .where(eq(opportunityContactRoles.opportunityId, opportunityId));

  const productRows = await db
    .select({ value: count() })
    .from(opportunityProducts)
    .where(eq(opportunityProducts.opportunityId, opportunityId));

  const quoteRows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.opportunityId, opportunityId));

  const mapRows = await db
    .select({ value: count() })
    .from(mutualActionPlans)
    .where(eq(mutualActionPlans.opportunityId, opportunityId));

  const economicBuyerRoles = new Set(['decision_maker', 'executive_sponsor', 'finance']);

  const acceptedQuote = quoteRows.find((q) => q.status === 'accepted');
  const approvedQuote = quoteRows.find(
    (q) => q.status === 'approved' || q.status === 'presented' || q.status === 'accepted',
  );

  /**
   * Lines and ARR may live on the opportunity or on the quote. Once a quote is
   * approved it *is* the authoritative commercial record — it is what gets booked —
   * so the gate accepts it rather than demanding the same products be keyed twice.
   * Insisting on duplicate entry is how stage gates get worked around.
   */
  const quoteLineCount = approvedQuote
    ? (
        await db
          .select({ value: count() })
          .from(quoteLines)
          .where(eq(quoteLines.quoteId, approvedQuote.id))
      )[0]?.value ?? 0
    : 0;

  const effectiveProductCount = Math.max(
    Number(productRows[0]?.value ?? 0),
    Number(quoteLineCount),
  );
  const effectiveArrCents = Math.max(opp.arrCents, acceptedQuote?.arrCents ?? 0, approvedQuote?.arrCents ?? 0);

  return {
    ...opp,
    arrCents: effectiveArrCents,
    contactRoleCount: roleRows.length,
    productCount: effectiveProductCount,
    hasDecisionMaker: roleRows.some((r) => r.role === 'decision_maker'),
    hasEconomicBuyer: roleRows.some((r) => economicBuyerRoles.has(r.role)),
    hasApprovedQuote: quoteRows.some(
      (q) => q.status === 'approved' || q.status === 'presented' || q.status === 'accepted',
    ),
    hasAcceptedQuote: quoteRows.some((q) => q.status === 'accepted'),
    hasMutualActionPlan: Number(mapRows[0]?.value ?? 0) > 0,
    competitors:
      Array.isArray(opp.competitors) && opp.competitors.length > 0 ? opp.competitors : null,
  };
}

export type StageChangeResult = {
  ok: boolean;
  stage: StageKey;
  failures: { field: string; label: string }[];
  illegalTransition: boolean;
  overridden: boolean;
  /** Populated when entering Closed Won triggers provisioning. */
  provisioned?: {
    subscriptionId: string;
    renewalId: string;
    renewalOpportunityId: string;
    arrCents: number;
  };
};

/**
 * Moves an opportunity to a new stage.
 *
 * Entering Closed Won is what triggers the booking chain: order, contract,
 * subscription and the renewal for the end of that term, all in one transaction of
 * work so a won deal can never exist without its renewal.
 */
export async function changeStage(
  user: AuthenticatedUser,
  opportunityId: string,
  toStage: StageKey,
  ctx: AuditContext,
  opts: { overrideReason?: string | null; patch?: Record<string, unknown> } = {},
): Promise<StageChangeResult> {
  assertCan(user, 'opportunities', 'update');
  const db = await getDb();

  const oppRows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  const opp = oppRows[0];
  if (!opp) throw new NotFoundError('Opportunity not found');

  assertCanAccessRecord(user, 'opportunities', 'update', opp);

  const fromStage = opp.stage as StageKey;

  // Any field changes accompanying the transition are applied first, so a rep can
  // supply the missing loss reason in the same action that closes the deal.
  if (opts.patch && Object.keys(opts.patch).length > 0) {
    await db
      .update(opportunities)
      .set({ ...opts.patch, updatedAt: new Date(), updatedById: user.id })
      .where(eq(opportunities.id, opportunityId));
  }

  const gateInput = await buildGateInput(opportunityId);
  const gate = evaluateStageGate(fromStage, toStage, opp.type as OpportunityType, gateInput);

  const wantsOverride = Boolean(opts.overrideReason?.trim());

  if (!gate.allowed) {
    // An illegal transition is a modelling error, not a discretionary one.
    if (gate.illegalTransition) {
      return {
        ok: false,
        stage: fromStage,
        failures: gate.failures,
        illegalTransition: true,
        overridden: false,
      };
    }
    if (!wantsOverride || !user.isAdmin) {
      return {
        ok: false,
        stage: fromStage,
        failures: gate.failures,
        illegalTransition: false,
        overridden: false,
      };
    }
  }

  const overridden = !gate.allowed && wantsOverride && user.isAdmin;
  const def = STAGES[toStage];
  const now = new Date();
  const daysInPriorStage = opp.stageEnteredAt
    ? Math.max(0, Math.round((now.getTime() - opp.stageEnteredAt.getTime()) / 86_400_000))
    : null;

  const patch: Record<string, unknown> = {
    stage: toStage,
    stageEnteredAt: now,
    probabilityBps: def.defaultProbabilityBps,
    forecastCategory: defaultForecastCategory(toStage, def.isClosed, def.isWon),
    isClosed: def.isClosed,
    isWon: def.isWon,
    closedAt: def.isClosed ? now : null,
    stageOverrideReason: overridden ? opts.overrideReason : null,
    updatedAt: now,
    updatedById: user.id,
  };

  await db.update(opportunities).set(patch).where(eq(opportunities.id, opportunityId));

  await db
    .update(stageHistory)
    .set({ exitedAt: now, durationDays: daysInPriorStage })
    .where(
      and(eq(stageHistory.opportunityId, opportunityId), eq(stageHistory.toStage, fromStage)),
    );

  await db.insert(stageHistory).values({
    opportunityId,
    fromStage,
    toStage,
    enteredAt: now,
    durationDays: null,
    amountAtTransitionCents: opp.amountCents,
    closeDateAtTransition: opp.closeDate,
    userId: user.id,
    wasOverridden: overridden,
    overrideReason: overridden ? opts.overrideReason : null,
  });

  await recordAudit(ctx, {
    objectType: 'opportunities',
    recordId: opportunityId,
    action: 'update',
    field: 'stage',
    oldValue: fromStage,
    newValue: toStage,
    metadata: { daysInPriorStage, overridden },
  });

  if (overridden) {
    await recordOverride(
      ctx,
      'opportunities',
      opportunityId,
      `stage:${fromStage}->${toStage}`,
      opts.overrideReason!,
    );
  }

  const result: StageChangeResult = {
    ok: true,
    stage: toStage,
    failures: [],
    illegalTransition: false,
    overridden,
  };

  // --- the booking chain ---------------------------------------------------
  if (toStage === 'closed_won' && !opp.isRenewal) {
    const provisioned = await provisionFromWonOpportunity(opportunityId, ctx);
    result.provisioned = {
      subscriptionId: provisioned.subscriptionId,
      renewalId: provisioned.renewalId,
      renewalOpportunityId: provisioned.renewalOpportunityId,
      arrCents: provisioned.arrCents,
    };
  }

  if (def.isClosed) {
    await emitEvent('chat', def.isWon ? 'deal.won' : 'deal.lost', {
      name: opp.name,
      amountCents: opp.amountCents,
      arrCents: opp.arrCents,
      owner: user.name,
      lossReason: def.isWon ? null : (opts.patch?.lossReason ?? opp.lossReason),
    }, { objectType: 'opportunities', recordId: opportunityId });
  }

  return result;
}

/** Preview used by the pipeline board to show what a move would require. */
export async function previewStageChange(
  opportunityId: string,
  toStage: StageKey,
): Promise<{
  allowed: boolean;
  failures: { field: string; label: string }[];
  illegalTransition: boolean;
  fromStage: StageKey;
  criteria: { label: string; met: boolean }[];
}> {
  const db = await getDb();
  const oppRows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  const opp = oppRows[0];
  if (!opp) throw new NotFoundError('Opportunity not found');

  const input = await buildGateInput(opportunityId);
  const gate = evaluateStageGate(
    opp.stage as StageKey,
    toStage,
    opp.type as OpportunityType,
    input,
  );

  const failedLabels = new Set(gate.failures.map((x) => x.label));
  const relevant = STAGES[opp.stage as StageKey].exitCriteria.concat(
    STAGES[toStage].isClosed || STAGES[toStage].isParked ? STAGES[toStage].exitCriteria : [],
  );

  return {
    allowed: gate.allowed,
    failures: gate.failures,
    illegalTransition: gate.illegalTransition,
    fromStage: opp.stage as StageKey,
    criteria: relevant.map((c) => ({ label: c.label, met: !failedLabels.has(c.label) })),
  };
}

/**
 * Close-date changes are tracked rather than silently applied: pushing a date out
 * increments the slippage counter, which is the input to push analysis.
 */
export async function changeCloseDate(
  user: AuthenticatedUser,
  opportunityId: string,
  newCloseDate: string,
  ctx: AuditContext,
): Promise<{ pushCount: number; pushed: boolean; daysMoved: number }> {
  assertCan(user, 'opportunities', 'update');
  const db = await getDb();

  const rows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  const opp = rows[0];
  if (!opp) throw new NotFoundError('Opportunity not found');
  assertCanAccessRecord(user, 'opportunities', 'update', opp);

  const daysMoved = daysBetween(opp.closeDate, newCloseDate);
  const pushed = daysMoved > 0;
  const pushCount = pushed ? opp.pushCount + 1 : opp.pushCount;

  await db
    .update(opportunities)
    .set({
      closeDate: newCloseDate,
      originalCloseDate: opp.originalCloseDate ?? opp.closeDate,
      pushCount,
      updatedAt: new Date(),
      updatedById: user.id,
    })
    .where(eq(opportunities.id, opportunityId));

  await recordAudit(ctx, {
    objectType: 'opportunities',
    recordId: opportunityId,
    action: 'update',
    field: 'closeDate',
    oldValue: opp.closeDate,
    newValue: newCloseDate,
    metadata: { daysMoved, pushed, pushCount },
  });

  return { pushCount, pushed, daysMoved };
}

/** Revenue splits must total exactly 100% across the opportunity team. */
export async function setRevenueSplits(
  user: AuthenticatedUser,
  opportunityId: string,
  splits: { userId: string; role: string; splitBps: number; creditType?: string }[],
  ctx: AuditContext,
): Promise<{ ok: true }> {
  assertCan(user, 'opportunities', 'update');
  const total = splits.reduce((s, x) => s + x.splitBps, 0);
  if (splits.length > 0 && total !== 10_000) {
    throw new ValidationError(
      `Revenue splits must total 100%. They currently total ${(total / 100).toFixed(1)}%.`,
      [{ field: 'splitBps', message: 'Splits must sum to 10000 basis points' }],
    );
  }

  const db = await getDb();
  await db.delete(opportunityTeam).where(eq(opportunityTeam.opportunityId, opportunityId));
  if (splits.length > 0) {
    await db.insert(opportunityTeam).values(
      splits.map((s) => ({
        opportunityId,
        userId: s.userId,
        role: s.role as never,
        splitBps: s.splitBps,
        creditType: s.creditType ?? 'primary',
        createdById: user.id,
      })),
    );
  }

  await recordAudit(ctx, {
    objectType: 'opportunities',
    recordId: opportunityId,
    action: 'update',
    field: 'revenueSplits',
    newValue: JSON.stringify(splits),
  });

  return { ok: true };
}

/** Recomputes header amounts from the product lines. */
export async function recalculateAmounts(
  opportunityId: string,
  ctx: AuditContext,
): Promise<{ arrCents: number; tcvCents: number; amountCents: number }> {
  const db = await getDb();
  const lines = await db
    .select()
    .from(opportunityProducts)
    .where(eq(opportunityProducts.opportunityId, opportunityId));

  const arrCents = lines.reduce((s, l) => s + l.arrCents, 0);
  const tcvCents = lines.reduce((s, l) => s + l.tcvCents, 0);
  const amountCents = tcvCents > 0 ? tcvCents : arrCents;

  await db
    .update(opportunities)
    .set({ arrCents, tcvCents, amountCents, updatedAt: new Date() })
    .where(eq(opportunities.id, opportunityId));

  await recordAudit(ctx, {
    objectType: 'opportunities',
    recordId: opportunityId,
    action: 'update',
    field: 'amounts',
    newValue: JSON.stringify({ arrCents, tcvCents }),
  });

  return { arrCents, tcvCents, amountCents };
}

/** Days in the current stage, for ageing and inspection views. */
export async function daysInStage(opportunityId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ stageEnteredAt: opportunities.stageEnteredAt })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  const enteredAt = rows[0]?.stageEnteredAt;
  if (!enteredAt) return 0;
  return Math.max(0, Math.round((Date.now() - enteredAt.getTime()) / 86_400_000));
}

export async function stageHistoryFor(
  opportunityId: string,
): Promise<(typeof stageHistory.$inferSelect)[]> {
  const db = await getDb();
  return db
    .select()
    .from(stageHistory)
    .where(eq(stageHistory.opportunityId, opportunityId))
    .orderBy(desc(stageHistory.enteredAt));
}

export { stageLabel, today };
