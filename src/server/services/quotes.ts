import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  approvalRequests,
  approvalSteps,
  discountPolicies,
  opportunities,
  priceBookEntries,
  products,
  quoteLines,
  quotes,
  roles,
  subscriptions,
  users,
} from '@/db/schema';
import { addDays, termEndDate, today, type IsoDate } from '@/domain/dates';
import { applyDecision, canDecide, planApprovals, type DiscountPolicy } from '@/domain/approvals';
import {
  coTerm,
  priceLine,
  selectPriceBookEntry,
  totalQuote,
  type PriceBookEntryLike,
} from '@/domain/pricing';
import type { LineAction, PricedLine } from '@/domain/types';
import type { AuthenticatedUser } from '../auth';
import { recordAudit, type AuditContext } from '../audit';
import { assertCan, NotFoundError, ValidationError } from '../rbac';
import { nextNumber } from './numbering';
import { emitEvent } from './integrations';

/**
 * Quoting and discount approval.
 *
 * The quote is where pricing, co-termination and approval policy meet. Two rules
 * are enforced here rather than left to the user interface: a quote in approval
 * cannot be edited, and a quote cannot be marked accepted unless it is approved.
 * Without those, the approval chain is decorative.
 */

export type QuoteLineInput = {
  productId: string;
  action?: LineAction;
  quantity: number;
  priorQuantity?: number;
  discountBps?: number;
  netUnitCentsOverride?: number;
  discountReason?: string;
  replacesSubscriptionItemId?: string;
  minCommitVolume?: number;
  rampSchedule?: { year: number; quantity: number; netUnitCents: number }[];
};

export type BuildQuoteInput = {
  opportunityId: string;
  accountId: string;
  priceBookId: string;
  termMonths: number;
  startDate: IsoDate;
  billingFrequency?: 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'upfront';
  /** Supplying this co-terms the quote onto an existing subscription. */
  coTermSubscriptionId?: string | null;
  hasNonStandardTerms?: boolean;
  nonStandardTermsDetail?: string | null;
  paymentTerms?: string;
  lines: QuoteLineInput[];
  notes?: string | null;
  currency?: string;
};

async function loadPriceBookEntries(priceBookId: string): Promise<PriceBookEntryLike[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(priceBookEntries)
    .where(and(eq(priceBookEntries.priceBookId, priceBookId), eq(priceBookEntries.active, true)));

  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    listUnitCents: r.listUnitCents,
    minQuantity: r.minQuantity,
    maxQuantity: r.maxQuantity,
    termMonths: r.termMonths,
    multiYearDiscountBps: r.multiYearDiscountBps,
    includedVolume: r.includedVolume,
    overageUnitCents: r.overageUnitCents,
    active: r.active,
  }));
}

/**
 * Prices a quote without persisting it — used by the quote builder so the seller
 * sees live totals, the blended discount and the approval chain before saving.
 */
export async function priceQuote(input: BuildQuoteInput): Promise<{
  lines: PricedLine[];
  totals: ReturnType<typeof totalQuote>;
  startDate: IsoDate;
  endDate: IsoDate;
  isCoTermed: boolean;
  prorationFactorBps: number;
  productFamilies: string[];
}> {
  const db = await getDb();
  const entries = await loadPriceBookEntries(input.priceBookId);

  let startDate = input.startDate;
  let endDate = termEndDate(input.startDate, input.termMonths);
  let isCoTermed = false;

  if (input.coTermSubscriptionId) {
    const subRows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.coTermSubscriptionId))
      .limit(1);
    const sub = subRows[0];
    if (!sub) throw new NotFoundError('Subscription to co-term against was not found');

    const ct = coTerm(input.startDate, sub.endDate);
    startDate = ct.startDate;
    endDate = ct.endDate;
    isCoTermed = true;
  }

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const productRows =
    productIds.length > 0
      ? await db.select().from(products).where(eq(products.active, true))
      : [];
  const productById = new Map(productRows.map((p) => [p.id, p]));

  const priced: PricedLine[] = [];
  for (const line of input.lines) {
    const product = productById.get(line.productId);
    if (!product) {
      throw new ValidationError(`Product ${line.productId} is not available on this price book`, [
        { field: 'productId', message: 'Unknown or inactive product' },
      ]);
    }

    const entry = selectPriceBookEntry(
      entries,
      line.productId,
      line.quantity,
      input.termMonths,
    );
    if (!entry) {
      throw new ValidationError(`No price found for ${product.name} at quantity ${line.quantity}`, [
        { field: 'productId', message: 'No matching price book entry' },
      ]);
    }

    // A seller cannot exceed the product's own discount ceiling on a single line;
    // deeper cuts have to be expressed as a negotiated unit price, which is
    // visible and approvable rather than hidden in a percentage.
    if ((line.discountBps ?? 0) > product.maxDiscountBps) {
      throw new ValidationError(
        `Discount of ${((line.discountBps ?? 0) / 100).toFixed(1)}% exceeds the ${(
          product.maxDiscountBps / 100
        ).toFixed(1)}% ceiling for ${product.name}`,
        [{ field: 'discountBps', message: 'Exceeds product discount ceiling' }],
      );
    }

    priced.push(
      priceLine(
        {
          productId: line.productId,
          action: line.action,
          quantity: line.quantity,
          priorQuantity: line.priorQuantity,
          discountBps: line.discountBps,
          netUnitCentsOverride: line.netUnitCentsOverride,
          termMonths: input.termMonths,
          startDate,
          endDate: isCoTermed ? endDate : undefined,
          isRecurring: product.isRecurring,
          rampSchedule: line.rampSchedule ?? null,
          minCommitVolume: line.minCommitVolume ?? null,
          replacesSubscriptionItemId: line.replacesSubscriptionItemId ?? null,
        },
        entry,
      ),
    );
  }

  const totals = totalQuote(priced);

  return {
    lines: priced,
    totals,
    startDate,
    endDate,
    isCoTermed,
    prorationFactorBps: totals.prorationFactorBps,
    productFamilies: [
      ...new Set(
        input.lines
          .map((l) => productById.get(l.productId)?.family)
          .filter((x): x is string => Boolean(x)),
      ),
    ],
  };
}

export async function createQuote(
  user: AuthenticatedUser,
  input: BuildQuoteInput,
  ctx: AuditContext,
): Promise<{ quote: typeof quotes.$inferSelect; lines: (typeof quoteLines.$inferSelect)[] }> {
  assertCan(user, 'quotes', 'create');
  if (input.lines.length === 0) {
    throw new ValidationError('A quote needs at least one line', [
      { field: 'lines', message: 'Add a product' },
    ]);
  }

  const db = await getDb();
  const priced = await priceQuote(input);

  // Existing quotes on the deal become superseded — only one is primary.
  const existing = await db
    .select()
    .from(quotes)
    .where(eq(quotes.opportunityId, input.opportunityId));
  const version = existing.length + 1;
  if (existing.length > 0) {
    await db
      .update(quotes)
      .set({ isPrimary: false, status: 'superseded' })
      .where(and(eq(quotes.opportunityId, input.opportunityId), eq(quotes.isPrimary, true)));
  }

  const number = await nextNumber('quotes');

  const inserted = await db
    .insert(quotes)
    .values({
      number,
      opportunityId: input.opportunityId,
      accountId: input.accountId,
      version,
      isPrimary: true,
      status: 'draft',
      priceBookId: input.priceBookId,
      currency: input.currency ?? 'USD',
      termMonths: input.termMonths,
      billingFrequency: input.billingFrequency ?? 'annual',
      startDate: priced.startDate,
      endDate: priced.endDate,
      coTermSubscriptionId: input.coTermSubscriptionId ?? null,
      isCoTermed: priced.isCoTermed,
      prorationFactorBps: priced.prorationFactorBps,
      listTotalCents: priced.totals.listTotalCents,
      discountTotalCents: priced.totals.discountTotalCents,
      netTotalCents: priced.totals.netTotalCents,
      effectiveDiscountBps: priced.totals.effectiveDiscountBps,
      arrCents: priced.totals.arrCents,
      annualizedArrCents: priced.totals.annualizedArrCents,
      proratedAmountCents: priced.totals.proratedAmountCents,
      tcvCents: priced.totals.tcvCents,
      hasNonStandardTerms: input.hasNonStandardTerms ?? false,
      nonStandardTermsDetail: input.nonStandardTermsDetail ?? null,
      paymentTerms: input.paymentTerms ?? 'net_30',
      expiresAt: addDays(today(), 30),
      ownerId: user.id,
      notes: input.notes ?? null,
      createdById: user.id,
      updatedById: user.id,
    })
    .returning();

  const quote = inserted[0];

  const lineRows = await db
    .insert(quoteLines)
    .values(
      priced.lines.map((l, i) => ({
        quoteId: quote.id,
        productId: l.productId,
        sequence: i,
        action: l.action,
        quantity: l.quantity,
        priorQuantity: l.priorQuantity ?? null,
        listUnitCents: l.listUnitCents,
        netUnitCents: l.netUnitCents,
        discountBps: l.discountBps,
        programDiscountBps: l.programDiscountBps ?? 0,
        discountReason: input.lines[i]?.discountReason ?? null,
        termMonths: l.termMonths,
        startDate: l.startDate,
        endDate: l.endDate,
        prorationFactorBps: l.prorationFactorBps,
        arrCents: l.arrCents,
        annualizedArrCents: l.annualizedArrCents,
        proratedAmountCents: l.proratedAmountCents,
        tcvCents: l.tcvCents,
        rampSchedule: l.rampSchedule ?? null,
        minCommitVolume: l.minCommitVolume ?? null,
        overageUnitCents: l.overageUnitCents ?? null,
        replacesSubscriptionItemId: l.replacesSubscriptionItemId ?? null,
        createdById: user.id,
      })),
    )
    .returning();

  await recordAudit(ctx, {
    objectType: 'quotes',
    recordId: quote.id,
    action: 'create',
    metadata: {
      number,
      arrCents: quote.arrCents,
      effectiveDiscountBps: quote.effectiveDiscountBps,
      isCoTermed: quote.isCoTermed,
    },
  });

  return { quote, lines: lineRows };
}

/* ------------------------------------------------------------------ approvals */

async function loadPolicies(): Promise<DiscountPolicy[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(discountPolicies)
    .where(eq(discountPolicies.active, true));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sequence: r.sequence,
    thresholdBps: r.thresholdBps,
    approverRoleKey: r.approverRoleKey,
    appliesToProductFamily: r.appliesToProductFamily,
    appliesToOpportunityType: r.appliesToOpportunityType,
    minAmountCents: r.minAmountCents,
    triggersOnNonStandardTerms: r.triggersOnNonStandardTerms,
    slaHours: r.slaHours,
    escalateToRoleKey: r.escalateToRoleKey,
    active: r.active,
  }));
}

/** First active user holding a role, so a chain step lands on a real person. */
async function resolveApprover(roleKey: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(roles.key, roleKey), eq(users.active, true)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Submits a quote for approval.
 *
 * If the discount is inside the seller's authority and the paper is standard, the
 * quote is auto-approved and the reason recorded — that is a real decision with an
 * audit row, not an absence of one.
 */
export async function submitQuoteForApproval(
  user: AuthenticatedUser,
  quoteId: string,
  justification: string | null,
  ctx: AuditContext,
): Promise<{
  status: 'auto_approved' | 'pending';
  requestId: string | null;
  steps: { sequence: number; approverRoleKey: string; approverUserId: string | null }[];
  summary: string;
}> {
  assertCan(user, 'quotes', 'update');
  const db = await getDb();

  const quoteRows = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  const quote = quoteRows[0];
  if (!quote) throw new NotFoundError('Quote not found');
  if (quote.status !== 'draft' && quote.status !== 'rejected') {
    throw new ValidationError(`A quote in ${quote.status} status cannot be submitted again`);
  }

  const lineRows = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quoteId));
  const productRows = await db.select().from(products);
  const familyById = new Map(productRows.map((p) => [p.id, p.family]));
  const productFamilies = [
    ...new Set(lineRows.map((l) => familyById.get(l.productId)).filter((x): x is string => !!x)),
  ];

  const opp = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, quote.opportunityId))
    .limit(1);

  const plan = planApprovals(await loadPolicies(), {
    discountBps: quote.effectiveDiscountBps,
    amountCents: quote.netTotalCents,
    opportunityType: opp[0]?.type,
    productFamilies,
    hasNonStandardTerms: quote.hasNonStandardTerms,
    requesterAuthorityBps: user.discountAuthorityBps,
  });

  if (!plan.required) {
    await db
      .update(quotes)
      .set({
        status: 'approved',
        approvedAt: new Date(),
        approvedById: user.id,
        updatedById: user.id,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quoteId));

    await recordAudit({ ...ctx, reason: plan.summary }, {
      objectType: 'quotes',
      recordId: quoteId,
      action: 'approve',
      metadata: {
        autoApproved: true,
        discountBps: quote.effectiveDiscountBps,
        authorityBps: user.discountAuthorityBps,
      },
    });

    return { status: 'auto_approved', requestId: null, steps: [], summary: plan.summary };
  }

  const slaDueAt = new Date(Date.now() + plan.steps[0].slaHours * 3_600_000);

  const requestRows = await db
    .insert(approvalRequests)
    .values({
      objectType: 'quotes',
      recordId: quoteId,
      kind: quote.hasNonStandardTerms ? 'non_standard_terms' : 'discount',
      status: 'pending',
      requestedById: user.id,
      justification,
      amountCents: quote.netTotalCents,
      discountBps: quote.effectiveDiscountBps,
      policySnapshot: plan.steps,
      currentStep: 1,
      totalSteps: plan.totalSteps,
      slaDueAt,
      createdById: user.id,
    })
    .returning();

  const request = requestRows[0];

  const stepRows: { sequence: number; approverRoleKey: string; approverUserId: string | null }[] = [];
  for (const step of plan.steps) {
    const approverUserId = await resolveApprover(step.approverRoleKey);
    await db.insert(approvalSteps).values({
      requestId: request.id,
      sequence: step.sequence,
      approverRoleKey: step.approverRoleKey,
      approverUserId,
      status: 'pending',
      thresholdBps: step.thresholdBps,
      slaDueAt: new Date(Date.now() + step.slaHours * 3_600_000),
    });
    stepRows.push({
      sequence: step.sequence,
      approverRoleKey: step.approverRoleKey,
      approverUserId,
    });
  }

  await db
    .update(quotes)
    .set({ status: 'in_approval', approvalRequestId: request.id, updatedAt: new Date() })
    .where(eq(quotes.id, quoteId));

  await recordAudit(ctx, {
    objectType: 'quotes',
    recordId: quoteId,
    action: 'update',
    field: 'status',
    oldValue: quote.status,
    newValue: 'in_approval',
    metadata: { requestId: request.id, chain: plan.steps.map((s) => s.approverRoleKey) },
  });

  await emitEvent('chat', 'approval.requested', {
    quoteNumber: quote.number,
    discountBps: quote.effectiveDiscountBps,
    amountCents: quote.netTotalCents,
    approvers: stepRows.map((s) => s.approverRoleKey),
  });

  return { status: 'pending', requestId: request.id, steps: stepRows, summary: plan.summary };
}

export async function decideApproval(
  user: AuthenticatedUser,
  requestId: string,
  decision: 'approved' | 'rejected',
  comments: string | null,
  ctx: AuditContext,
): Promise<{ requestStatus: string; nextStep: number | null; recordStatus: string | null }> {
  const db = await getDb();

  const reqRows = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId))
    .limit(1);
  const request = reqRows[0];
  if (!request) throw new NotFoundError('Approval request not found');
  if (request.status !== 'pending') {
    throw new ValidationError(`This request is already ${request.status}`);
  }

  const steps = await db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.requestId, requestId));

  const currentStep = steps.find((s) => s.sequence === request.currentStep);
  if (!currentStep) throw new ValidationError('No pending step on this request');

  const authority = canDecide(
    { approverRoleKey: currentStep.approverRoleKey, approverUserId: currentStep.approverUserId },
    { id: user.id, roleKey: user.roleKey, isAdmin: user.isAdmin },
    request.requestedById,
  );
  if (!authority.allowed) throw new ValidationError(authority.reason ?? 'Not permitted to decide');

  const result = applyDecision(
    steps.map((s) => ({ sequence: s.sequence, status: s.status as never })),
    currentStep.sequence,
    decision,
  );

  await db
    .update(approvalSteps)
    .set({
      status: decision,
      decidedAt: new Date(),
      decidedByUserId: user.id,
      comments,
    })
    .where(eq(approvalSteps.id, currentStep.id));

  await db
    .update(approvalRequests)
    .set({
      status: result.requestStatus as never,
      currentStep: result.nextStep ?? request.currentStep,
      completedAt: result.requestStatus === 'pending' ? null : new Date(),
      updatedAt: new Date(),
      updatedById: user.id,
    })
    .where(eq(approvalRequests.id, requestId));

  await recordAudit({ ...ctx, reason: comments ?? undefined }, {
    objectType: 'approval_requests',
    recordId: requestId,
    action: decision === 'approved' ? 'approve' : 'reject',
    metadata: { step: currentStep.sequence, role: currentStep.approverRoleKey },
  });

  let recordStatus: string | null = null;

  if (request.objectType === 'quotes' && result.requestStatus !== 'pending') {
    recordStatus = result.requestStatus === 'approved' ? 'approved' : 'rejected';
    await db
      .update(quotes)
      .set({
        status: recordStatus as never,
        approvedAt: result.requestStatus === 'approved' ? new Date() : null,
        approvedById: result.requestStatus === 'approved' ? user.id : null,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, request.recordId));

    await recordAudit(ctx, {
      objectType: 'quotes',
      recordId: request.recordId,
      action: decision === 'approved' ? 'approve' : 'reject',
      field: 'status',
      newValue: recordStatus,
    });
  }

  return { requestStatus: result.requestStatus, nextStep: result.nextStep, recordStatus };
}

/** Marks an approved quote as presented, then accepted by the customer. */
export async function acceptQuote(
  user: AuthenticatedUser,
  quoteId: string,
  ctx: AuditContext,
): Promise<typeof quotes.$inferSelect> {
  assertCan(user, 'quotes', 'update');
  const db = await getDb();

  const rows = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  const quote = rows[0];
  if (!quote) throw new NotFoundError('Quote not found');

  // The rule that makes the approval chain mean something.
  if (quote.status !== 'approved' && quote.status !== 'presented') {
    throw new ValidationError(
      `A quote must be approved before it can be accepted (currently ${quote.status})`,
    );
  }

  const updated = await db
    .update(quotes)
    .set({
      status: 'accepted',
      acceptedAt: new Date(),
      presentedAt: quote.presentedAt ?? new Date(),
      eSignStatus: 'signed',
      eSignCompletedAt: new Date(),
      updatedAt: new Date(),
      updatedById: user.id,
    })
    .where(eq(quotes.id, quoteId))
    .returning();

  await recordAudit(ctx, {
    objectType: 'quotes',
    recordId: quoteId,
    action: 'update',
    field: 'status',
    oldValue: quote.status,
    newValue: 'accepted',
  });

  await emitEvent('e_signature', 'envelope.completed', {
    quoteNumber: quote.number,
    accountId: quote.accountId,
  });

  return updated[0];
}
