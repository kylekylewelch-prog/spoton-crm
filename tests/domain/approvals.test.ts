import { describe, expect, it } from 'vitest';
import {
  applyDecision,
  canDecide,
  discountImpact,
  planApprovals,
  type DiscountPolicy,
} from '@/domain/approvals';

/** The default matrix: escalating thresholds plus a deal-desk terms trigger. */
const POLICIES: DiscountPolicy[] = [
  {
    id: 'dpol_mgr',
    name: 'Sales Manager',
    sequence: 1,
    thresholdBps: 1000,
    approverRoleKey: 'sales_manager',
    triggersOnNonStandardTerms: false,
    slaHours: 24,
    escalateToRoleKey: 'vp_sales',
  },
  {
    id: 'dpol_vp',
    name: 'VP Sales',
    sequence: 2,
    thresholdBps: 2000,
    approverRoleKey: 'vp_sales',
    triggersOnNonStandardTerms: false,
    slaHours: 24,
    escalateToRoleKey: 'cro',
  },
  {
    id: 'dpol_cro',
    name: 'CRO',
    sequence: 3,
    thresholdBps: 3000,
    approverRoleKey: 'cro',
    triggersOnNonStandardTerms: false,
    slaHours: 48,
    escalateToRoleKey: null,
  },
  {
    id: 'dpol_cfo',
    name: 'CFO',
    sequence: 4,
    thresholdBps: 4000,
    approverRoleKey: 'cfo',
    triggersOnNonStandardTerms: false,
    slaHours: 48,
    escalateToRoleKey: null,
  },
  {
    id: 'dpol_desk',
    name: 'Deal Desk — non-standard terms',
    sequence: 5,
    thresholdBps: 0,
    approverRoleKey: 'deal_desk',
    triggersOnNonStandardTerms: true,
    slaHours: 12,
    escalateToRoleKey: 'cfo',
  },
];

describe('discount approval planning', () => {
  it('auto-approves a discount below the first threshold', () => {
    const plan = planApprovals(POLICIES, { discountBps: 500, amountCents: 5_000_000 });
    expect(plan.required).toBe(false);
    expect(plan.autoApproved).toBe(true);
    expect(plan.steps).toHaveLength(0);
    expect(plan.summary).toContain('auto-approved');
  });

  it('requires a single approval at the first threshold', () => {
    const plan = planApprovals(POLICIES, { discountBps: 1200, amountCents: 5_000_000 });
    expect(plan.steps.map((s) => s.approverRoleKey)).toEqual(['sales_manager']);
  });

  /**
   * The escalating-chain rule: a deep discount collects every level below it, so
   * each approver sees what they signed off rather than the CRO absorbing it alone.
   */
  it('builds an escalating chain for a deep discount', () => {
    const plan = planApprovals(POLICIES, { discountBps: 3500, amountCents: 20_000_000 });
    expect(plan.steps.map((s) => s.approverRoleKey)).toEqual([
      'sales_manager',
      'vp_sales',
      'cro',
    ]);
    expect(plan.totalSteps).toBe(3);
    expect(plan.slaHours).toBe(96);
    expect(plan.steps[0].sequence).toBe(1);
    expect(plan.steps[2].sequence).toBe(3);
  });

  it('collects every level including the CFO past 40%', () => {
    const plan = planApprovals(POLICIES, { discountBps: 4500, amountCents: 50_000_000 });
    expect(plan.steps.map((s) => s.approverRoleKey)).toEqual([
      'sales_manager',
      'vp_sales',
      'cro',
      'cfo',
    ]);
  });

  /** Non-standard paper is a different risk from price, so it always gets a human. */
  it('routes non-standard terms to deal desk even at zero discount', () => {
    const plan = planApprovals(POLICIES, {
      discountBps: 0,
      amountCents: 5_000_000,
      hasNonStandardTerms: true,
    });
    expect(plan.required).toBe(true);
    expect(plan.steps.map((s) => s.approverRoleKey)).toEqual(['deal_desk']);
    expect(plan.steps[0].reason).toContain('Non-standard');
  });

  it('combines a discount chain with the terms review', () => {
    const plan = planApprovals(POLICIES, {
      discountBps: 2500,
      amountCents: 5_000_000,
      hasNonStandardTerms: true,
    });
    expect(plan.steps.map((s) => s.approverRoleKey)).toEqual([
      'sales_manager',
      'vp_sales',
      'deal_desk',
    ]);
  });

  it("skips steps already covered by the requester's own authority", () => {
    const plan = planApprovals(POLICIES, {
      discountBps: 900,
      amountCents: 5_000_000,
      requesterAuthorityBps: 1000,
    });
    expect(plan.required).toBe(false);
  });

  it('still requires higher levels when the discount exceeds the requester authority', () => {
    const plan = planApprovals(POLICIES, {
      discountBps: 2500,
      amountCents: 5_000_000,
      requesterAuthorityBps: 1000,
    });
    expect(plan.steps.map((s) => s.approverRoleKey)).toEqual(['sales_manager', 'vp_sales']);
  });

  it('adds a renewal-director step when contractual uplift is waived', () => {
    const plan = planApprovals(POLICIES, {
      discountBps: 0,
      amountCents: 10_000_000,
      isRenewalUpliftWaived: true,
    });
    expect(plan.steps.map((s) => s.approverRoleKey)).toEqual(['renewal_director']);
  });

  it('respects a minimum amount on a policy row', () => {
    const scoped: DiscountPolicy[] = [
      { ...POLICIES[0], minAmountCents: 10_000_000 },
    ];
    expect(planApprovals(scoped, { discountBps: 1500, amountCents: 5_000_000 }).required).toBe(
      false,
    );
    expect(planApprovals(scoped, { discountBps: 1500, amountCents: 20_000_000 }).required).toBe(
      true,
    );
  });

  it('respects product-family scoping', () => {
    const scoped: DiscountPolicy[] = [
      { ...POLICIES[0], appliesToProductFamily: 'Platform' },
    ];
    expect(
      planApprovals(scoped, {
        discountBps: 1500,
        amountCents: 5_000_000,
        productFamilies: ['Services'],
      }).required,
    ).toBe(false);
    expect(
      planApprovals(scoped, {
        discountBps: 1500,
        amountCents: 5_000_000,
        productFamilies: ['Platform', 'Services'],
      }).required,
    ).toBe(true);
  });

  it('ignores inactive policy rows', () => {
    const inactive = POLICIES.map((p) => ({ ...p, active: false }));
    expect(planApprovals(inactive, { discountBps: 5000, amountCents: 1 }).required).toBe(false);
  });
});

describe('decision handling', () => {
  const steps = [
    { sequence: 1, status: 'pending' as const },
    { sequence: 2, status: 'pending' as const },
    { sequence: 3, status: 'pending' as const },
  ];

  it('opens the next step on approval', () => {
    const result = applyDecision(steps, 1, 'approved');
    expect(result.requestStatus).toBe('pending');
    expect(result.nextStep).toBe(2);
  });

  it('approves the request once the final step clears', () => {
    let state = applyDecision(steps, 1, 'approved');
    state = applyDecision(state.steps, 2, 'approved');
    state = applyDecision(state.steps, 3, 'approved');
    expect(state.requestStatus).toBe('approved');
    expect(state.nextStep).toBeNull();
  });

  /** A rejection anywhere kills the request — no creeping forward on partials. */
  it('terminates the whole request on any rejection', () => {
    const state = applyDecision(steps, 2, 'rejected');
    expect(state.requestStatus).toBe('rejected');
    expect(state.nextStep).toBeNull();
  });

  it('does not mutate the input', () => {
    applyDecision(steps, 1, 'approved');
    expect(steps[0].status).toBe('pending');
  });
});

describe('decision authority', () => {
  const step = { approverRoleKey: 'vp_sales', approverUserId: null };

  it('blocks self-approval', () => {
    const result = canDecide(step, { id: 'usr_1', roleKey: 'vp_sales' }, 'usr_1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('own request');
  });

  it('allows the right role to decide', () => {
    expect(canDecide(step, { id: 'usr_2', roleKey: 'vp_sales' }, 'usr_1').allowed).toBe(true);
  });

  it('blocks the wrong role', () => {
    const result = canDecide(step, { id: 'usr_2', roleKey: 'sales_manager' }, 'usr_1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('vp_sales');
  });

  it('blocks a user other than the named approver', () => {
    const named = { approverRoleKey: 'vp_sales', approverUserId: 'usr_9' };
    expect(canDecide(named, { id: 'usr_2', roleKey: 'vp_sales' }, 'usr_1').allowed).toBe(false);
  });

  it('lets an admin override', () => {
    const named = { approverRoleKey: 'vp_sales', approverUserId: 'usr_9' };
    expect(
      canDecide(named, { id: 'usr_2', roleKey: 'admin', isAdmin: true }, 'usr_1').allowed,
    ).toBe(true);
  });
});

describe('discount impact', () => {
  it('shows the cash consequence of a discount', () => {
    const impact = discountImpact(20_000_000, 2500);
    expect(impact.discountCents).toBe(5_000_000);
    expect(impact.netCents).toBe(15_000_000);
  });
});
