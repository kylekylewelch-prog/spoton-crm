import { applyBps } from './money';
import type { Bps, Money } from './types';

/**
 * Discount approval chains.
 *
 * The matrix is data, not code: every policy row whose threshold is exceeded
 * contributes a step, producing an escalating chain rather than a single
 * approver. A 35% discount therefore collects manager, VP and CRO rather than
 * jumping straight to the CRO, so each level sees what it approved.
 */

export type DiscountPolicy = {
  id: string;
  name: string;
  sequence: number;
  thresholdBps: Bps;
  approverRoleKey: string;
  appliesToProductFamily?: string | null;
  appliesToOpportunityType?: string | null;
  minAmountCents?: Money | null;
  triggersOnNonStandardTerms: boolean;
  slaHours: number;
  escalateToRoleKey?: string | null;
  active?: boolean;
};

export type ApprovalContext = {
  discountBps: Bps;
  amountCents: Money;
  opportunityType?: string;
  productFamilies?: string[];
  hasNonStandardTerms?: boolean;
  /** Renewal below the contractual uplift needs its own approval. */
  isRenewalUpliftWaived?: boolean;
  /** Seller's own authority, from their role. */
  requesterAuthorityBps?: Bps;
};

export type ApprovalStepPlan = {
  sequence: number;
  approverRoleKey: string;
  thresholdBps: Bps;
  policyId: string;
  policyName: string;
  slaHours: number;
  escalateToRoleKey: string | null;
  /** Why this step exists — surfaced in the approval UI and the audit trail. */
  reason: string;
};

export type ApprovalPlan = {
  required: boolean;
  autoApproved: boolean;
  steps: ApprovalStepPlan[];
  totalSteps: number;
  /** Cumulative SLA if every step uses its full window. */
  slaHours: number;
  /** Human-readable summary for the request record. */
  summary: string;
};

function policyApplies(p: DiscountPolicy, ctx: ApprovalContext): boolean {
  if (p.active === false) return false;
  if (
    p.appliesToOpportunityType &&
    ctx.opportunityType &&
    p.appliesToOpportunityType !== ctx.opportunityType
  ) {
    return false;
  }
  if (
    p.appliesToProductFamily &&
    ctx.productFamilies &&
    !ctx.productFamilies.includes(p.appliesToProductFamily)
  ) {
    return false;
  }
  if (p.minAmountCents != null && ctx.amountCents < p.minAmountCents) return false;
  return true;
}

/**
 * Builds the approval chain for a quote or renewal.
 *
 * Auto-approval requires two things to be true: the discount is inside the
 * seller's own authority, and there is nothing non-standard about the paper.
 * Non-standard terms always draw a human review regardless of discount, because
 * the risk in those deals is rarely the price.
 */
export function planApprovals(
  policies: DiscountPolicy[],
  ctx: ApprovalContext,
): ApprovalPlan {
  const applicable = policies
    .filter((p) => policyApplies(p, ctx))
    .sort((a, b) => a.sequence - b.sequence);

  const steps: ApprovalStepPlan[] = [];
  let seq = 1;

  for (const p of applicable) {
    const byDiscount = ctx.discountBps >= p.thresholdBps && p.thresholdBps > 0;
    const byTerms = p.triggersOnNonStandardTerms && Boolean(ctx.hasNonStandardTerms);

    if (!byDiscount && !byTerms) continue;

    // Skip steps the requester's own authority already covers.
    if (
      byDiscount &&
      !byTerms &&
      ctx.requesterAuthorityBps !== undefined &&
      p.thresholdBps <= ctx.requesterAuthorityBps &&
      ctx.discountBps <= ctx.requesterAuthorityBps
    ) {
      continue;
    }

    steps.push({
      sequence: seq++,
      approverRoleKey: p.approverRoleKey,
      thresholdBps: p.thresholdBps,
      policyId: p.id,
      policyName: p.name,
      slaHours: p.slaHours,
      escalateToRoleKey: p.escalateToRoleKey ?? null,
      reason: byTerms
        ? 'Non-standard contract terms require deal desk review'
        : `Discount of ${(ctx.discountBps / 100).toFixed(1)}% meets the ${(
            p.thresholdBps / 100
          ).toFixed(1)}% threshold`,
    });
  }

  if (ctx.isRenewalUpliftWaived) {
    steps.push({
      sequence: seq++,
      approverRoleKey: 'renewal_director',
      thresholdBps: 0,
      policyId: 'implicit_uplift_waiver',
      policyName: 'Renewal uplift waiver',
      slaHours: 24,
      escalateToRoleKey: 'cro',
      reason: 'Contractual uplift was waived or reduced on a renewal',
    });
  }

  const required = steps.length > 0;

  return {
    required,
    autoApproved: !required,
    steps,
    totalSteps: steps.length,
    slaHours: steps.reduce((a, s) => a + s.slaHours, 0),
    summary: required
      ? `${steps.length} approval${steps.length > 1 ? 's' : ''} required: ${steps
          .map((s) => s.approverRoleKey)
          .join(' → ')}`
      : 'Within seller authority — auto-approved',
  };
}

export type ApprovalStepState = {
  sequence: number;
  status: 'pending' | 'approved' | 'rejected' | 'recalled' | 'escalated' | 'auto_approved';
};

/**
 * Advances a chain after a decision. Steps are strictly sequential: an approval
 * opens the next step, and any rejection terminates the whole request so the
 * deal cannot creep forward on a partially approved discount.
 */
export function applyDecision(
  steps: ApprovalStepState[],
  sequence: number,
  decision: 'approved' | 'rejected',
): {
  steps: ApprovalStepState[];
  requestStatus: 'pending' | 'approved' | 'rejected';
  nextStep: number | null;
} {
  const next = steps.map((s) =>
    s.sequence === sequence ? { ...s, status: decision } : { ...s },
  );

  if (decision === 'rejected') {
    return { steps: next, requestStatus: 'rejected', nextStep: null };
  }

  const pending = next
    .filter((s) => s.status === 'pending')
    .sort((a, b) => a.sequence - b.sequence);

  if (pending.length === 0) {
    return { steps: next, requestStatus: 'approved', nextStep: null };
  }
  return { steps: next, requestStatus: 'pending', nextStep: pending[0].sequence };
}

/** Whether a decision is the requester's to make (self-approval is blocked). */
export function canDecide(
  step: { approverRoleKey: string; approverUserId?: string | null },
  user: { id: string; roleKey: string; isAdmin?: boolean },
  requestedById: string,
): { allowed: boolean; reason?: string } {
  if (user.id === requestedById && !user.isAdmin) {
    return { allowed: false, reason: 'Approvers cannot decide their own request' };
  }
  if (step.approverUserId && step.approverUserId !== user.id && !user.isAdmin) {
    return { allowed: false, reason: 'Assigned to a different approver' };
  }
  if (!step.approverUserId && step.approverRoleKey !== user.roleKey && !user.isAdmin) {
    return { allowed: false, reason: `Requires the ${step.approverRoleKey} role` };
  }
  return { allowed: true };
}

/**
 * Margin left on the table. Used by the approval UI so an approver sees the cash
 * consequence of the discount, not just the percentage.
 */
export function discountImpact(
  listTotalCents: Money,
  discountBps: Bps,
): { discountCents: Money; netCents: Money } {
  const discountCents = applyBps(listTotalCents, discountBps);
  return { discountCents, netCents: listTotalCents - discountCents };
}
