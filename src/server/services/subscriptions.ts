import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  accounts,
  arrMovements,
  contracts,
  entitlements,
  opportunities,
  orders,
  products,
  quoteLines,
  quotes,
  renewals,
  subscriptionAmendments,
  subscriptionItems,
  subscriptions,
} from '@/db/schema';
import { addDays, fiscalPeriod, fiscalQuarter, termEndDate, today, type IsoDate } from '@/domain/dates';
import { mrrFromArr, priceLine, selectPriceBookEntry } from '@/domain/pricing';
import {
  applyAmendment,
  buildRenewalItems,
  computeAnnualizedArr,
  computeArr,
  noticeDateFor,
  planAmendment,
  planRenewalTerm,
  remainingContractValue,
  type SubscriptionState,
} from '@/domain/subscriptions';
import { classifyMovement, decomposeOpportunityMovement, movementRowsFor } from '@/domain/arr';
import {
  findNextOpenRenewal,
  renewalStartDate,
  rollIntoRenewal,
  type RenewalRecord,
} from '@/domain/renewals';
import type { AmendmentType } from '@/domain/types';
import type { AuthenticatedUser } from '../auth';
import { recordAudit, type AuditContext } from '../audit';
import { NotFoundError, ValidationError } from '../rbac';
import { nextNumber } from './numbering';
import { emitEvent } from './integrations';

/**
 * The subscription and renewal engine.
 *
 * This is where the two headline rules of the specification are implemented:
 *
 *   - Closing a deal won provisions the order, contract and subscription, and
 *     immediately creates the renewal for the end of that term.
 *   - A mid-term upsell or cross-sell is co-termed onto the active subscription and
 *     its full annual value is added to the next open renewal.
 *
 * Every ARR change also writes to the movement ledger, so the retention waterfall is
 * a sum of recorded facts rather than a reconstruction.
 */

/* ------------------------------------------------------------------- loading */

export async function loadSubscriptionState(subscriptionId: string): Promise<SubscriptionState> {
  const db = await getDb();
  const subRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  const sub = subRows[0];
  if (!sub) throw new NotFoundError('Subscription not found');

  const items = await db
    .select()
    .from(subscriptionItems)
    .where(eq(subscriptionItems.subscriptionId, subscriptionId))
    .orderBy(asc(subscriptionItems.createdAt));

  return {
    id: sub.id,
    startDate: sub.startDate,
    endDate: sub.endDate,
    termMonths: sub.termMonths,
    autoRenew: sub.autoRenew,
    noticeDays: sub.noticeDays,
    upliftBps: sub.upliftBps,
    currentArrCents: sub.currentArrCents,
    currentMrrCents: sub.currentMrrCents,
    originalArrCents: sub.originalArrCents,
    coTermedAdditionsArrCents: sub.coTermedAdditionsArrCents,
    version: sub.version,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      status: i.status as 'active' | 'pending' | 'removed',
      quantity: i.quantity,
      listUnitCents: i.listUnitCents,
      netUnitCents: i.netUnitCents,
      discountBps: i.discountBps,
      arrCents: i.arrCents,
      annualizedArrCents: i.annualizedArrCents,
      startDate: i.startDate,
      endDate: i.endDate,
      isCoTermed: i.isCoTermed,
      prorationFactorBps: i.prorationFactorBps,
      addedByAmendmentId: i.addedByAmendmentId,
      removedByAmendmentId: i.removedByAmendmentId,
    })),
  };
}

async function refreshAccountArr(accountId: string): Promise<number> {
  const db = await getDb();
  const subs = await db
    .select({ arr: subscriptions.currentArrCents })
    .from(subscriptions)
    .where(and(eq(subscriptions.accountId, accountId), eq(subscriptions.status, 'active')));

  const total = subs.reduce((s, r) => s + r.arr, 0);
  await db
    .update(accounts)
    .set({ currentArrCents: total, updatedAt: new Date() })
    .where(eq(accounts.id, accountId));
  return total;
}

async function writeMovements(
  rows: ReturnType<typeof movementRowsFor>,
  ctx: AuditContext,
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  await db.insert(arrMovements).values(
    rows.map((r) => ({
      accountId: r.accountId,
      subscriptionId: r.subscriptionId ?? null,
      amendmentId: r.amendmentId ?? null,
      opportunityId: r.opportunityId ?? null,
      type: r.type,
      arrDeltaCents: r.arrDeltaCents,
      arrDeltaBaseCents: r.arrDeltaCents,
      effectiveDate: r.effectiveDate,
      fiscalPeriod: r.fiscalPeriod,
      fiscalQuarter: r.fiscalQuarter,
      createdById: ctx.user?.id ?? null,
    })),
  );
}

/* -------------------------------------------------------- renewal generation */

/**
 * Creates the renewal record and its paired renewal opportunity.
 *
 * Both are created the moment the originating deal is won, dated at the end of the
 * term. A renewal that exists only as a report row ninety days out is a renewal
 * nobody owns.
 */
export async function createRenewalForSubscription(
  subscriptionId: string,
  ctx: AuditContext,
  opts: { ownerId?: string | null } = {},
): Promise<{ renewalId: string; opportunityId: string }> {
  const db = await getDb();
  const state = await loadSubscriptionState(subscriptionId);

  const subRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  const sub = subRows[0];

  const accountRows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, sub.accountId))
    .limit(1);
  const account = accountRows[0];

  const term = planRenewalTerm(state);
  const ownerId =
    opts.ownerId ?? sub.renewalOwnerId ?? account?.renewalManagerId ?? account?.ownerId ?? null;

  // The renewal opportunity carries the commercial motion; the renewal record
  // carries the operating detail. They are paired one-to-one.
  const oppRows = await db
    .insert(opportunities)
    .values({
      name: `${account?.name ?? 'Account'} — Renewal ${term.startDate.slice(0, 4)}`,
      accountId: sub.accountId,
      type: 'renewal',
      stage: 'srl',
      forecastCategory: 'pipeline',
      probabilityBps: 5000,
      currency: sub.currency,
      amountCents: term.expectedArrCents,
      arrCents: term.expectedArrCents,
      tcvCents: term.expectedArrCents,
      expectedRenewalArrCents: term.expectedArrCents,
      termMonths: term.termMonths,
      closeDate: sub.endDate,
      originalCloseDate: sub.endDate,
      subscriptionId,
      isRenewal: true,
      isAutoCreated: true,
      ownerId: ownerId ?? sub.createdById ?? '',
      createdSource: 'auto_renewal',
      originalSource: account?.originalSource ?? null,
      description:
        'Automatically created when the originating subscription was booked. Renewable ARR includes the annualised value of any mid-term additions.',
      createdById: ctx.user?.id ?? null,
    })
    .returning();

  const opportunity = oppRows[0];

  const renewalRows = await db
    .insert(renewals)
    .values({
      subscriptionId,
      accountId: sub.accountId,
      opportunityId: opportunity.id,
      status: 'not_started',
      renewalDate: sub.endDate,
      noticeDate: noticeDateFor(sub.endDate, sub.noticeDays),
      term: term.termMonths,
      currentArrCents: term.currentArrCents,
      renewableArrCents: term.renewableArrCents,
      coTermedAdditionsArrCents: term.coTermedAdditionsArrCents,
      upliftBps: term.upliftBps,
      upliftArrCents: term.upliftArrCents,
      expectedArrCents: term.expectedArrCents,
      forecastCategory: 'pipeline',
      autoRenew: sub.autoRenew,
      riskLevel: 'low',
      ownerId,
      createdById: ctx.user?.id ?? null,
    })
    .returning();

  const renewal = renewalRows[0];

  await db
    .update(opportunities)
    .set({ renewalId: renewal.id })
    .where(eq(opportunities.id, opportunity.id));

  await recordAudit(ctx, {
    objectType: 'renewals',
    recordId: renewal.id,
    action: 'create',
    metadata: {
      autoCreated: true,
      subscriptionId,
      renewalDate: sub.endDate,
      renewableArrCents: term.renewableArrCents,
      opportunityId: opportunity.id,
      startWorkingOn: renewalStartDate(sub.endDate, term.renewableArrCents, 'low').startDate,
    },
  });

  return { renewalId: renewal.id, opportunityId: opportunity.id };
}

/* ------------------------------------------------- provisioning from a won deal */

/**
 * Books a won opportunity: order, contract, subscription, items, entitlements, ARR
 * movements and the next renewal. Idempotent on the opportunity, so a double-click
 * or a retried workflow cannot produce two subscriptions.
 */
export async function provisionFromWonOpportunity(
  opportunityId: string,
  ctx: AuditContext,
): Promise<{
  subscriptionId: string;
  orderId: string;
  contractId: string;
  renewalId: string;
  renewalOpportunityId: string;
  arrCents: number;
  created: boolean;
}> {
  const db = await getDb();

  const oppRows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  const opp = oppRows[0];
  if (!opp) throw new NotFoundError('Opportunity not found');

  // Idempotency guard.
  const existingOrder = await db
    .select()
    .from(orders)
    .where(eq(orders.opportunityId, opportunityId))
    .limit(1);
  if (existingOrder[0]?.subscriptionId) {
    const existingRenewal = await db
      .select()
      .from(renewals)
      .where(eq(renewals.subscriptionId, existingOrder[0].subscriptionId))
      .limit(1);
    return {
      subscriptionId: existingOrder[0].subscriptionId,
      orderId: existingOrder[0].id,
      contractId: existingOrder[0].contractId ?? '',
      renewalId: existingRenewal[0]?.id ?? '',
      renewalOpportunityId: existingRenewal[0]?.opportunityId ?? '',
      arrCents: existingOrder[0].arrCents,
      created: false,
    };
  }

  const quoteRows = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.opportunityId, opportunityId), eq(quotes.status, 'accepted')))
    .limit(1);
  const quote = quoteRows[0];
  if (!quote) {
    throw new ValidationError(
      'A deal cannot be booked without an accepted quote. Approve and accept the quote first.',
    );
  }

  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id));
  if (lines.length === 0) throw new ValidationError('The accepted quote has no lines');

  /**
   * A mid-term change against an existing subscription amends it rather than
   * creating a second contract — that is what keeps one renewal date per account.
   */
  if (quote.coTermSubscriptionId) {
    const amendmentType: AmendmentType =
      opp.type === 'cross_sell' ? 'cross_sell' : opp.type === 'contraction' ? 'contraction' : 'upsell';

    const result = await amendSubscription(
      quote.coTermSubscriptionId,
      {
        type: amendmentType,
        effectiveDate: quote.startDate,
        opportunityId,
        quoteId: quote.id,
      },
      ctx,
    );

    const orderRows = await db
      .insert(orders)
      .values({
        number: await nextNumber('orders'),
        quoteId: quote.id,
        opportunityId,
        accountId: quote.accountId,
        status: 'booked',
        currency: quote.currency,
        arrCents: quote.annualizedArrCents,
        tcvCents: quote.proratedAmountCents,
        bookedById: ctx.user?.id ?? null,
        autoBooked: ctx.source === 'workflow',
        subscriptionId: quote.coTermSubscriptionId,
        createdById: ctx.user?.id ?? null,
      })
      .returning();

    return {
      subscriptionId: quote.coTermSubscriptionId,
      orderId: orderRows[0].id,
      contractId: '',
      renewalId: result.appliedToRenewalId ?? '',
      renewalOpportunityId: result.appliedToRenewalOpportunityId ?? '',
      arrCents: result.annualizedArrCents,
      created: true,
    };
  }

  // --- new term: contract, subscription, items -----------------------------
  const startDate = quote.startDate;
  const endDate = quote.endDate;

  const contractRows = await db
    .insert(contracts)
    .values({
      number: await nextNumber('contracts'),
      accountId: quote.accountId,
      quoteId: quote.id,
      status: 'active',
      startDate,
      endDate,
      termMonths: quote.termMonths,
      autoRenew: true,
      noticeDays: 60,
      noticeDate: noticeDateFor(endDate, 60),
      upliftBps: 500,
      signedAt: quote.acceptedAt ?? new Date(),
      createdById: ctx.user?.id ?? null,
    })
    .returning();
  const contract = contractRows[0];

  const arrCents = lines.reduce((s, l) => s + l.arrCents, 0);

  const subRows = await db
    .insert(subscriptions)
    .values({
      number: await nextNumber('subscriptions'),
      accountId: quote.accountId,
      contractId: contract.id,
      version: 1,
      status: 'active',
      startDate,
      endDate,
      termMonths: quote.termMonths,
      billingFrequency: quote.billingFrequency,
      autoRenew: true,
      noticeDays: 60,
      noticeDate: noticeDateFor(endDate, 60),
      upliftBps: 500,
      currency: quote.currency,
      originalArrCents: arrCents,
      originalTcvCents: quote.tcvCents,
      currentArrCents: arrCents,
      currentMrrCents: mrrFromArr(arrCents),
      currentTcvCents: quote.tcvCents,
      remainingContractValueCents: quote.tcvCents,
      coTermedAdditionsArrCents: 0,
      renewalOwnerId: null,
      originatingOpportunityId: opportunityId,
      createdById: ctx.user?.id ?? null,
    })
    .returning();
  const subscription = subRows[0];

  await db.insert(subscriptionItems).values(
    lines.map((l) => ({
      subscriptionId: subscription.id,
      productId: l.productId,
      status: 'active',
      quantity: l.quantity,
      listUnitCents: l.listUnitCents,
      netUnitCents: l.netUnitCents,
      discountBps: l.discountBps,
      arrCents: l.arrCents,
      mrrCents: mrrFromArr(l.arrCents),
      startDate: l.startDate,
      endDate: l.endDate,
      isCoTermed: false,
      prorationFactorBps: l.prorationFactorBps,
      annualizedArrCents: l.annualizedArrCents,
      minCommitVolume: l.minCommitVolume,
      overageUnitCents: l.overageUnitCents,
      rampSchedule: l.rampSchedule,
      sourceQuoteLineId: l.id,
      createdById: ctx.user?.id ?? null,
    })),
  );

  // Entitlements from each product's template.
  const productRows = await db
    .select()
    .from(products)
    .where(inArray(products.id, lines.map((l) => l.productId)));

  const entitlementValues = [];
  for (const line of lines) {
    const product = productRows.find((p) => p.id === line.productId);
    const template = (product?.entitlementTemplate ?? null) as
      | { featureKey: string; limitValue?: number | null; supportLevel?: string }[]
      | null;
    if (!template) continue;
    for (const t of template) {
      entitlementValues.push({
        subscriptionId: subscription.id,
        accountId: quote.accountId,
        productId: line.productId,
        featureKey: t.featureKey,
        limitValue: t.limitValue ?? line.quantity,
        unitOfMeasure: product?.unitOfMeasure ?? 'seat',
        supportLevel: t.supportLevel ?? null,
        startDate,
        endDate,
        status: 'active',
        createdById: ctx.user?.id ?? null,
      });
    }
  }
  if (entitlementValues.length > 0) await db.insert(entitlements).values(entitlementValues);

  const orderRows = await db
    .insert(orders)
    .values({
      number: await nextNumber('orders'),
      quoteId: quote.id,
      opportunityId,
      accountId: quote.accountId,
      status: 'booked',
      currency: quote.currency,
      arrCents,
      tcvCents: quote.tcvCents,
      bookedById: ctx.user?.id ?? null,
      autoBooked: ctx.source === 'workflow',
      contractId: contract.id,
      subscriptionId: subscription.id,
      createdById: ctx.user?.id ?? null,
    })
    .returning();

  // --- ARR movements -------------------------------------------------------
  const priorSubs = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.accountId, quote.accountId), ne(subscriptions.id, subscription.id)));

  const isFirst = priorSubs.length === 0;
  const components = isFirst
    ? {
        newArrCents: arrCents,
        expansionArrCents: 0,
        upliftArrCents: 0,
        contractionArrCents: 0,
        churnArrCents: 0,
      }
    : decomposeOpportunityMovement(
        lines.map((l) => ({
          action: l.action,
          arrCents: l.arrCents,
          annualizedArrCents: l.annualizedArrCents,
          isNewProductForAccount: true,
          priceChangedOnly: false,
        })),
      );

  await writeMovements(
    movementRowsFor({
      accountId: quote.accountId,
      subscriptionId: subscription.id,
      opportunityId,
      effectiveDate: startDate,
      components,
    }),
    ctx,
  );

  await db
    .update(opportunities)
    .set({
      newArrCents: components.newArrCents,
      expansionArrCents: components.expansionArrCents,
      upliftArrCents: components.upliftArrCents,
      contractionArrCents: components.contractionArrCents,
      churnArrCents: components.churnArrCents,
      arrCents,
      updatedAt: new Date(),
    })
    .where(eq(opportunities.id, opportunityId));

  await db
    .update(accounts)
    .set({
      isCustomer: true,
      customerSince: isFirst ? startDate : undefined,
      lifecycleStage: isFirst ? 'onboarding' : undefined,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, quote.accountId));

  await refreshAccountArr(quote.accountId);

  // --- the renewal, created immediately -----------------------------------
  const renewal = await createRenewalForSubscription(subscription.id, ctx);

  await recordAudit(ctx, {
    objectType: 'opportunities',
    recordId: opportunityId,
    action: 'book',
    metadata: {
      subscriptionId: subscription.id,
      orderId: orderRows[0].id,
      contractId: contract.id,
      renewalId: renewal.renewalId,
      arrCents,
    },
  });

  await emitEvent('erp', 'order.booked', {
    orderNumber: orderRows[0].number,
    accountId: quote.accountId,
    arrCents,
    tcvCents: quote.tcvCents,
  }, { objectType: 'orders', recordId: orderRows[0].id });

  await emitEvent('billing', 'subscription.created', {
    subscriptionNumber: subscription.number,
    accountId: quote.accountId,
    arrCents,
    startDate,
    endDate,
  }, { objectType: 'subscriptions', recordId: subscription.id });

  return {
    subscriptionId: subscription.id,
    orderId: orderRows[0].id,
    contractId: contract.id,
    renewalId: renewal.renewalId,
    renewalOpportunityId: renewal.opportunityId,
    arrCents,
    created: true,
  };
}

/* --------------------------------------------------------------- amendments */

export type AmendInput = {
  type: AmendmentType;
  effectiveDate: IsoDate;
  opportunityId?: string | null;
  quoteId?: string | null;
  /** Lines to add, when not derived from a quote. */
  lines?: {
    productId: string;
    quantity: number;
    priorQuantity?: number;
    netUnitCents: number;
    listUnitCents?: number;
    action?: 'add' | 'increase' | 'decrease' | 'remove' | 'price_change';
  }[];
  removeItemIds?: string[];
  notes?: string | null;
};

/**
 * Amends a live subscription.
 *
 * Mid-term additions are co-termed to the parent end date, billed pro rata for the
 * stub period, and their full annual value is rolled into the next open renewal.
 * All three happen together — doing any one without the others is what produces
 * either a second renewal date or a renewal quoted below the true run rate.
 */
export async function amendSubscription(
  subscriptionId: string,
  input: AmendInput,
  ctx: AuditContext,
): Promise<{
  amendmentId: string;
  deltaArrCents: number;
  annualizedArrCents: number;
  proratedAmountCents: number;
  isCoTermed: boolean;
  coTermEndDate: IsoDate;
  appliedToRenewalId: string | null;
  appliedToRenewalOpportunityId: string | null;
  newArrCents: number;
}> {
  const db = await getDb();
  const state = await loadSubscriptionState(subscriptionId);

  const subRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  const sub = subRows[0];
  if (!sub) throw new NotFoundError('Subscription not found');
  if (sub.status !== 'active') {
    throw new ValidationError(`A ${sub.status} subscription cannot be amended`);
  }
  if (input.effectiveDate > sub.endDate) {
    throw new ValidationError(
      `Effective date ${input.effectiveDate} is after the subscription ends on ${sub.endDate}. Amend the renewal instead.`,
    );
  }

  // Resolve the lines: either supplied directly or taken from an accepted quote.
  let pricedLines = [] as ReturnType<typeof priceLine>[];

  if (input.quoteId) {
    const qLines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, input.quoteId));
    pricedLines = qLines.map((l) => ({
      productId: l.productId,
      action: l.action,
      quantity: l.quantity,
      priorQuantity: l.priorQuantity ?? undefined,
      listUnitCents: l.listUnitCents,
      netUnitCents: l.netUnitCents,
      discountBps: l.discountBps,
      programDiscountBps: l.programDiscountBps,
      termMonths: l.termMonths,
      startDate: l.startDate,
      endDate: l.endDate,
      prorationFactorBps: l.prorationFactorBps,
      arrCents: l.arrCents,
      annualizedArrCents: l.annualizedArrCents,
      proratedAmountCents: l.proratedAmountCents,
      tcvCents: l.tcvCents,
      rampSchedule: l.rampSchedule as never,
      minCommitVolume: l.minCommitVolume,
      overageUnitCents: l.overageUnitCents,
      replacesSubscriptionItemId: l.replacesSubscriptionItemId,
      isRecurring: true,
    }));
  } else if (input.lines?.length) {
    const { coTerm } = await import('@/domain/pricing');
    const ct = coTerm(input.effectiveDate, sub.endDate);
    pricedLines = input.lines.map((l) =>
      priceLine(
        {
          productId: l.productId,
          action: l.action ?? 'add',
          quantity: l.quantity,
          priorQuantity: l.priorQuantity,
          netUnitCentsOverride: l.netUnitCents,
          termMonths: 12,
          startDate: ct.startDate,
          endDate: ct.endDate,
        },
        {
          id: 'inline',
          productId: l.productId,
          listUnitCents: l.listUnitCents ?? l.netUnitCents,
          minQuantity: 1,
          maxQuantity: null,
          termMonths: 12,
          multiYearDiscountBps: 0,
          includedVolume: null,
          overageUnitCents: null,
        },
      ),
    );
  }

  const plan = planAmendment({
    subscription: state,
    type: input.type,
    effectiveDate: input.effectiveDate,
    lines: pricedLines,
    removeItemIds: input.removeItemIds,
  });

  const number = await nextNumber('subscription_amendments');

  const amendmentRows = await db
    .insert(subscriptionAmendments)
    .values({
      number,
      subscriptionId,
      type: input.type,
      status: 'applied',
      opportunityId: input.opportunityId ?? null,
      quoteId: input.quoteId ?? null,
      effectiveDate: input.effectiveDate,
      coTermEndDate: plan.coTermEndDate,
      isCoTermed: plan.isCoTermed,
      prorationFactorBps: plan.prorationFactorBps,
      remainingDays: plan.remainingDays,
      deltaArrCents: plan.deltaArrCents,
      annualizedArrCents: plan.annualizedArrCents,
      proratedAmountCents: plan.proratedAmountCents,
      arrBeforeCents: plan.arrBeforeCents,
      arrAfterCents: plan.arrAfterCents,
      notes: input.notes ?? null,
      createdById: ctx.user?.id ?? null,
    })
    .returning();
  const amendment = amendmentRows[0];

  // Apply item changes.
  if (plan.itemIdsRemoved.length > 0) {
    await db
      .update(subscriptionItems)
      .set({
        status: 'removed',
        removedByAmendmentId: amendment.id,
        removedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(inArray(subscriptionItems.id, plan.itemIdsRemoved));
  }

  const newItemIds: string[] = [];
  if (plan.itemsAdded.length > 0) {
    const inserted = await db
      .insert(subscriptionItems)
      .values(
        plan.itemsAdded.map((l) => ({
          subscriptionId,
          productId: l.productId,
          status: 'active',
          quantity: l.quantity,
          listUnitCents: l.listUnitCents,
          netUnitCents: l.netUnitCents,
          discountBps: l.discountBps,
          arrCents: l.arrCents,
          mrrCents: mrrFromArr(l.arrCents),
          startDate: l.startDate,
          endDate: l.endDate,
          isCoTermed: plan.isCoTermed,
          prorationFactorBps: l.prorationFactorBps,
          annualizedArrCents: l.annualizedArrCents,
          minCommitVolume: l.minCommitVolume,
          overageUnitCents: l.overageUnitCents,
          addedByAmendmentId: amendment.id,
          createdById: ctx.user?.id ?? null,
        })),
      )
      .returning();
    newItemIds.push(...inserted.map((i) => i.id));
  }

  const nextState = applyAmendment(state, plan, amendment.id, newItemIds);

  await db
    .update(subscriptions)
    .set({
      version: nextState.version,
      currentArrCents: nextState.currentArrCents,
      currentMrrCents: nextState.currentMrrCents,
      coTermedAdditionsArrCents: nextState.coTermedAdditionsArrCents,
      remainingContractValueCents: remainingContractValue(
        { endDate: sub.endDate, currentArrCents: nextState.currentArrCents },
        today(),
      ),
      status: input.type === 'cancellation' ? 'cancelled' : sub.status,
      cancellationEffectiveDate:
        input.type === 'cancellation' ? input.effectiveDate : sub.cancellationEffectiveDate,
      churnedAt: input.type === 'cancellation' ? input.effectiveDate : sub.churnedAt,
      updatedAt: new Date(),
      updatedById: ctx.user?.id ?? null,
    })
    .where(eq(subscriptions.id, subscriptionId));

  // --- ARR ledger ----------------------------------------------------------
  const movementType = classifyMovement({
    isFirstSubscriptionForAccount: false,
    isRenewal: input.type === 'renewal',
    deltaArrCents: plan.deltaArrCents,
    quantityChanged: plan.itemsAdded.length > 0 || plan.itemIdsRemoved.length > 0,
    priceChanged: input.type === 'price_change',
    isCancellation: input.type === 'cancellation',
  });

  if (movementType) {
    const components = {
      newArrCents: 0,
      expansionArrCents: 0,
      upliftArrCents: 0,
      contractionArrCents: 0,
      churnArrCents: 0,
    };
    if (movementType === 'expansion') components.expansionArrCents = plan.deltaArrCents;
    else if (movementType === 'uplift') components.upliftArrCents = plan.deltaArrCents;
    else if (movementType === 'contraction') components.contractionArrCents = plan.deltaArrCents;
    else if (movementType === 'churn') components.churnArrCents = plan.deltaArrCents;
    else if (movementType === 'new') components.newArrCents = plan.deltaArrCents;

    await writeMovements(
      movementRowsFor({
        accountId: sub.accountId,
        subscriptionId,
        amendmentId: amendment.id,
        opportunityId: input.opportunityId ?? null,
        effectiveDate: input.effectiveDate,
        components,
      }),
      ctx,
    );
  }

  // --- roll the annualised value into the next open renewal ----------------
  let appliedToRenewalId: string | null = null;
  let appliedToRenewalOpportunityId: string | null = null;

  if (plan.rollsIntoRenewal && plan.annualizedArrCents !== 0) {
    const renewalRows = await db
      .select()
      .from(renewals)
      .where(eq(renewals.subscriptionId, subscriptionId));

    const candidates: RenewalRecord[] = renewalRows.map((r) => ({
      id: r.id,
      subscriptionId: r.subscriptionId,
      accountId: r.accountId,
      opportunityId: r.opportunityId,
      renewalDate: r.renewalDate,
      noticeDate: r.noticeDate,
      status: r.status,
      currentArrCents: r.currentArrCents,
      renewableArrCents: r.renewableArrCents,
      coTermedAdditionsArrCents: r.coTermedAdditionsArrCents,
      expectedArrCents: r.expectedArrCents,
      upliftBps: r.upliftBps,
      autoRenew: r.autoRenew,
      closedAt: r.closedAt,
    }));

    const target = findNextOpenRenewal(candidates, subscriptionId, input.effectiveDate);

    if (target) {
      const rolled = rollIntoRenewal(target, plan.annualizedArrCents);

      await db
        .update(renewals)
        .set({
          currentArrCents: nextState.currentArrCents,
          coTermedAdditionsArrCents: rolled.coTermedAdditionsArrCents,
          renewableArrCents: rolled.renewableArrCents,
          upliftArrCents: rolled.upliftArrCents,
          expectedArrCents: rolled.expectedArrCents,
          updatedAt: new Date(),
        })
        .where(eq(renewals.id, target.id));

      appliedToRenewalId = target.id;
      appliedToRenewalOpportunityId = target.opportunityId;

      // Keep the paired renewal opportunity in step, so the forecast reflects it.
      if (target.opportunityId) {
        await db
          .update(opportunities)
          .set({
            amountCents: rolled.expectedArrCents,
            arrCents: rolled.expectedArrCents,
            tcvCents: rolled.expectedArrCents,
            expectedRenewalArrCents: rolled.expectedArrCents,
            updatedAt: new Date(),
          })
          .where(eq(opportunities.id, target.opportunityId));
      }

      await db
        .update(subscriptionAmendments)
        .set({
          appliedToRenewalId: target.id,
          appliedToRenewalOpportunityId: target.opportunityId,
          appliedToRenewalAt: new Date(),
        })
        .where(eq(subscriptionAmendments.id, amendment.id));

      await recordAudit(ctx, {
        objectType: 'renewals',
        recordId: target.id,
        action: 'update',
        field: 'renewableArrCents',
        oldValue: String(target.renewableArrCents),
        newValue: String(rolled.renewableArrCents),
        metadata: {
          reason: 'Co-termed mid-term change rolled into the next open renewal',
          amendmentId: amendment.id,
          amendmentNumber: number,
          annualizedArrCents: plan.annualizedArrCents,
        },
      });
    }
  }

  await refreshAccountArr(sub.accountId);

  await recordAudit(ctx, {
    objectType: 'subscriptions',
    recordId: subscriptionId,
    action: 'update',
    metadata: {
      amendmentId: amendment.id,
      amendmentNumber: number,
      type: input.type,
      deltaArrCents: plan.deltaArrCents,
      annualizedArrCents: plan.annualizedArrCents,
      proratedAmountCents: plan.proratedAmountCents,
      isCoTermed: plan.isCoTermed,
      appliedToRenewalId,
    },
  });

  await emitEvent('billing', 'subscription.amended', {
    subscriptionNumber: sub.number,
    amendmentNumber: number,
    type: input.type,
    proratedAmountCents: plan.proratedAmountCents,
    newArrCents: nextState.currentArrCents,
  }, { objectType: 'subscription_amendments', recordId: amendment.id });

  return {
    amendmentId: amendment.id,
    deltaArrCents: plan.deltaArrCents,
    annualizedArrCents: plan.annualizedArrCents,
    proratedAmountCents: plan.proratedAmountCents,
    isCoTermed: plan.isCoTermed,
    coTermEndDate: plan.coTermEndDate,
    appliedToRenewalId,
    appliedToRenewalOpportunityId,
    newArrCents: nextState.currentArrCents,
  };
}

/* ----------------------------------------------------------- closing a renewal */

/**
 * Completes a renewal: creates the successor subscription at the renewed rate,
 * records the uplift as ARR movement, and creates the renewal *after* that one.
 * The chain never runs dry.
 */
export async function completeRenewal(
  renewalId: string,
  input: { closedArrCents?: number; termMonths?: number; upliftBps?: number },
  ctx: AuditContext,
): Promise<{
  successorSubscriptionId: string;
  nextRenewalId: string;
  renewedArrCents: number;
  upliftArrCents: number;
}> {
  const db = await getDb();

  const renewalRows = await db.select().from(renewals).where(eq(renewals.id, renewalId)).limit(1);
  const renewal = renewalRows[0];
  if (!renewal) throw new NotFoundError('Renewal not found');
  if (renewal.status === 'renewed' || renewal.status === 'auto_renewed') {
    throw new ValidationError('This renewal has already been completed');
  }

  const state = await loadSubscriptionState(renewal.subscriptionId);
  const oldSubRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, renewal.subscriptionId))
    .limit(1);
  const oldSub = oldSubRows[0];

  const upliftBps = input.upliftBps ?? renewal.upliftBps;
  const term = planRenewalTerm(state, { termMonths: input.termMonths, upliftBps });
  const items = buildRenewalItems(state, term, upliftBps);

  const renewedArrCents = input.closedArrCents ?? items.reduce((s, i) => s + i.arrCents, 0);
  const upliftArrCents = renewedArrCents - term.renewableArrCents;

  const newSubRows = await db
    .insert(subscriptions)
    .values({
      number: await nextNumber('subscriptions'),
      accountId: renewal.accountId,
      contractId: oldSub.contractId,
      billingAccountId: oldSub.billingAccountId,
      predecessorSubscriptionId: oldSub.id,
      version: 1,
      status: 'active',
      startDate: term.startDate,
      endDate: term.endDate,
      termMonths: term.termMonths,
      billingFrequency: oldSub.billingFrequency,
      autoRenew: oldSub.autoRenew,
      noticeDays: oldSub.noticeDays,
      noticeDate: noticeDateFor(term.endDate, oldSub.noticeDays),
      upliftBps: oldSub.upliftBps,
      currency: oldSub.currency,
      originalArrCents: renewedArrCents,
      originalTcvCents: renewedArrCents,
      currentArrCents: renewedArrCents,
      currentMrrCents: mrrFromArr(renewedArrCents),
      currentTcvCents: renewedArrCents,
      remainingContractValueCents: renewedArrCents,
      coTermedAdditionsArrCents: 0,
      renewalOwnerId: renewal.ownerId,
      csmId: oldSub.csmId,
      createdById: ctx.user?.id ?? null,
    })
    .returning();
  const newSub = newSubRows[0];

  await db.insert(subscriptionItems).values(
    items.map((i) => ({
      subscriptionId: newSub.id,
      productId: i.productId,
      status: 'active',
      quantity: i.quantity,
      listUnitCents: i.listUnitCents,
      netUnitCents: i.netUnitCents,
      discountBps: i.discountBps,
      arrCents: i.arrCents,
      mrrCents: mrrFromArr(i.arrCents),
      startDate: i.startDate,
      endDate: i.endDate,
      isCoTermed: false,
      prorationFactorBps: i.prorationFactorBps,
      annualizedArrCents: i.annualizedArrCents,
      createdById: ctx.user?.id ?? null,
    })),
  );

  await db
    .update(subscriptions)
    .set({
      status: 'renewed',
      successorSubscriptionId: newSub.id,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, oldSub.id));

  await db
    .update(renewals)
    .set({
      status: 'renewed',
      closedArrCents: renewedArrCents,
      closedAt: new Date(),
      forecastCategory: 'closed',
      updatedAt: new Date(),
    })
    .where(eq(renewals.id, renewalId));

  if (renewal.opportunityId) {
    await db
      .update(opportunities)
      .set({
        stage: 'closed_won',
        isClosed: true,
        isWon: true,
        closedAt: new Date(),
        forecastCategory: 'closed',
        probabilityBps: 10_000,
        arrCents: renewedArrCents,
        amountCents: renewedArrCents,
        upliftArrCents: Math.max(0, upliftArrCents),
        contractionArrCents: Math.min(0, upliftArrCents),
        updatedAt: new Date(),
      })
      .where(eq(opportunities.id, renewal.opportunityId));
  }

  // Uplift or contraction on renewal is movement; the renewed base itself is not.
  if (upliftArrCents !== 0) {
    await writeMovements(
      movementRowsFor({
        accountId: renewal.accountId,
        subscriptionId: newSub.id,
        opportunityId: renewal.opportunityId,
        effectiveDate: term.startDate,
        components: {
          newArrCents: 0,
          expansionArrCents: 0,
          upliftArrCents: Math.max(0, upliftArrCents),
          contractionArrCents: Math.min(0, upliftArrCents),
          churnArrCents: 0,
        },
      }),
      ctx,
    );
  }

  await refreshAccountArr(renewal.accountId);

  const next = await createRenewalForSubscription(newSub.id, ctx, { ownerId: renewal.ownerId });

  await recordAudit(ctx, {
    objectType: 'renewals',
    recordId: renewalId,
    action: 'update',
    field: 'status',
    newValue: 'renewed',
    metadata: {
      successorSubscriptionId: newSub.id,
      renewedArrCents,
      upliftArrCents,
      nextRenewalId: next.renewalId,
    },
  });

  return {
    successorSubscriptionId: newSub.id,
    nextRenewalId: next.renewalId,
    renewedArrCents,
    upliftArrCents,
  };
}

/** Records a non-renewal: the subscription churns and its ARR leaves the base. */
export async function churnRenewal(
  renewalId: string,
  reason: string,
  ctx: AuditContext,
): Promise<{ churnedArrCents: number }> {
  const db = await getDb();
  const renewalRows = await db.select().from(renewals).where(eq(renewals.id, renewalId)).limit(1);
  const renewal = renewalRows[0];
  if (!renewal) throw new NotFoundError('Renewal not found');

  const state = await loadSubscriptionState(renewal.subscriptionId);
  const churnedArrCents = computeArr(state.items);

  await db
    .update(subscriptions)
    .set({
      status: 'expired',
      churnedAt: renewal.renewalDate,
      cancellationReason: reason,
      currentArrCents: 0,
      currentMrrCents: 0,
      remainingContractValueCents: 0,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, renewal.subscriptionId));

  await db
    .update(subscriptionItems)
    .set({ status: 'removed', removedAt: new Date() })
    .where(
      and(
        eq(subscriptionItems.subscriptionId, renewal.subscriptionId),
        eq(subscriptionItems.status, 'active'),
      ),
    );

  await db
    .update(renewals)
    .set({
      status: 'churned',
      closedArrCents: 0,
      closedAt: new Date(),
      forecastCategory: 'closed',
      notes: reason,
      updatedAt: new Date(),
    })
    .where(eq(renewals.id, renewalId));

  if (renewal.opportunityId) {
    await db
      .update(opportunities)
      .set({
        stage: 'closed_lost',
        isClosed: true,
        isWon: false,
        closedAt: new Date(),
        forecastCategory: 'closed',
        probabilityBps: 0,
        lossReason: reason,
        churnArrCents: -churnedArrCents,
        updatedAt: new Date(),
      })
      .where(eq(opportunities.id, renewal.opportunityId));
  }

  await writeMovements(
    movementRowsFor({
      accountId: renewal.accountId,
      subscriptionId: renewal.subscriptionId,
      opportunityId: renewal.opportunityId,
      effectiveDate: renewal.renewalDate,
      components: {
        newArrCents: 0,
        expansionArrCents: 0,
        upliftArrCents: 0,
        contractionArrCents: 0,
        churnArrCents: -churnedArrCents,
      },
    }),
    ctx,
  );

  const remaining = await refreshAccountArr(renewal.accountId);
  if (remaining === 0) {
    await db
      .update(accounts)
      .set({
        lifecycleStage: 'churned',
        isCustomer: false,
        churnedAt: renewal.renewalDate,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, renewal.accountId));
  }

  await recordAudit({ ...ctx, reason }, {
    objectType: 'renewals',
    recordId: renewalId,
    action: 'update',
    field: 'status',
    newValue: 'churned',
    metadata: { churnedArrCents },
  });

  return { churnedArrCents };
}

export { computeAnnualizedArr, computeArr, fiscalPeriod, fiscalQuarter, addDays, termEndDate };
