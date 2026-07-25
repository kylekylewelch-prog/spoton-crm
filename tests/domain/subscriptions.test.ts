import { describe, expect, it } from 'vitest';
import {
  applyAmendment,
  buildRenewalItems,
  cancellationCredit,
  computeAnnualizedArr,
  computeArr,
  noticeWindowState,
  planAmendment,
  planRenewalTerm,
  remainingContractValue,
  type SubscriptionState,
} from '@/domain/subscriptions';
import { coTerm, priceLine, type PriceBookEntryLike } from '@/domain/pricing';
import { findNextOpenRenewal, rollIntoRenewal, type RenewalRecord } from '@/domain/renewals';

const seatEntry: PriceBookEntryLike = {
  id: 'pbe_seat',
  productId: 'prd_platform',
  listUnitCents: 120_000,
  minQuantity: 1,
  maxQuantity: null,
  termMonths: 12,
  multiYearDiscountBps: 0,
  includedVolume: null,
  overageUnitCents: null,
};

const analyticsEntry: PriceBookEntryLike = {
  ...seatEntry,
  id: 'pbe_analytics',
  productId: 'prd_analytics',
  listUnitCents: 36_000,
};

/** A live 12-month subscription: 100 seats at $1,200 = $120,000 ARR. */
function baseSubscription(): SubscriptionState {
  return {
    id: 'sub_1',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    termMonths: 12,
    autoRenew: true,
    noticeDays: 60,
    upliftBps: 500,
    currentArrCents: 12_000_000,
    currentMrrCents: 1_000_000,
    originalArrCents: 12_000_000,
    coTermedAdditionsArrCents: 0,
    version: 1,
    items: [
      {
        id: 'subi_1',
        productId: 'prd_platform',
        status: 'active',
        quantity: 100,
        listUnitCents: 120_000,
        netUnitCents: 120_000,
        discountBps: 0,
        arrCents: 12_000_000,
        annualizedArrCents: 12_000_000,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        isCoTermed: false,
        prorationFactorBps: 10_000,
      },
    ],
  };
}

describe('subscription run rate', () => {
  it('sums only active items', () => {
    const sub = baseSubscription();
    sub.items.push({
      ...sub.items[0],
      id: 'subi_removed',
      status: 'removed',
      arrCents: 5_000_000,
      annualizedArrCents: 5_000_000,
    });
    expect(computeArr(sub.items)).toBe(12_000_000);
  });

  it('computes remaining contract value from a mid-term date', () => {
    const sub = baseSubscription();
    // 2026-10-01 to 2026-12-31 is 92 days of 365: $120,000 x 92/365.
    expect(remainingContractValue(sub, '2026-10-01')).toBe(3_024_658);
    expect(remainingContractValue(sub, '2027-06-01')).toBe(0);
  });

  it('derives the notice window and lock-in state', () => {
    const sub = baseSubscription();
    const before = noticeWindowState(sub, '2026-09-01');
    expect(before.noticeDate).toBe('2026-11-01');
    expect(before.noticePassed).toBe(false);
    expect(before.lockedIn).toBe(false);

    const after = noticeWindowState(sub, '2026-11-15');
    expect(after.noticePassed).toBe(true);
    expect(after.lockedIn).toBe(true);
  });
});

describe('mid-term upsell', () => {
  /**
   * The requirement, end to end: a mid-term addition co-terms with the active
   * subscription, bills only the stub period, and its full annual value is what
   * the next renewal inherits.
   */
  it('co-terms the addition and separates billed-now from annual value', () => {
    const sub = baseSubscription();
    const ct = coTerm('2026-09-01', sub.endDate);

    const line = priceLine(
      {
        productId: 'prd_platform',
        action: 'increase',
        quantity: 140,
        priorQuantity: 100,
        termMonths: 12,
        startDate: ct.startDate,
        endDate: ct.endDate,
      },
      seatEntry,
    );

    const plan = planAmendment({
      subscription: sub,
      type: 'upsell',
      effectiveDate: '2026-09-01',
      lines: [line],
    });

    expect(plan.isCoTermed).toBe(true);
    expect(plan.coTermEndDate).toBe('2026-12-31');
    expect(plan.remainingDays).toBe(122);

    // 40 incremental seats: $48,000 a year, but only 122/365 billed now.
    expect(plan.deltaArrCents).toBe(4_800_000);
    expect(plan.annualizedArrCents).toBe(4_800_000);
    expect(plan.proratedAmountCents).toBe(1_604_384);

    expect(plan.arrBeforeCents).toBe(12_000_000);
    expect(plan.arrAfterCents).toBe(16_800_000);
    expect(plan.rollsIntoRenewal).toBe(true);
  });

  it('applies the amendment and accumulates the co-termed additions', () => {
    const sub = baseSubscription();
    const ct = coTerm('2026-09-01', sub.endDate);
    const line = priceLine(
      {
        productId: 'prd_analytics',
        quantity: 100,
        termMonths: 12,
        startDate: ct.startDate,
        endDate: ct.endDate,
      },
      analyticsEntry,
    );

    const plan = planAmendment({
      subscription: sub,
      type: 'cross_sell',
      effectiveDate: '2026-09-01',
      lines: [line],
    });
    const updated = applyAmendment(sub, plan, 'amd_1', ['subi_new']);

    expect(updated.version).toBe(2);
    expect(updated.items).toHaveLength(2);
    expect(updated.currentArrCents).toBe(12_000_000 + 3_600_000);
    // The annualised value of the cross-sell is banked for the renewal.
    expect(updated.coTermedAdditionsArrCents).toBe(3_600_000);
    expect(updated.items[1].isCoTermed).toBe(true);
    expect(updated.items[1].endDate).toBe('2026-12-31');
  });

  it('rolls the annualised value into the next open renewal', () => {
    const renewals: RenewalRecord[] = [
      {
        id: 'rnw_closed',
        subscriptionId: 'sub_1',
        accountId: 'acc_1',
        opportunityId: 'opp_a',
        renewalDate: '2025-12-31',
        noticeDate: '2025-11-01',
        status: 'renewed',
        currentArrCents: 10_000_000,
        renewableArrCents: 10_000_000,
        coTermedAdditionsArrCents: 0,
        expectedArrCents: 10_500_000,
        upliftBps: 500,
        autoRenew: true,
      },
      {
        id: 'rnw_open',
        subscriptionId: 'sub_1',
        accountId: 'acc_1',
        opportunityId: 'opp_b',
        renewalDate: '2026-12-31',
        noticeDate: '2026-11-01',
        status: 'not_started',
        currentArrCents: 12_000_000,
        renewableArrCents: 12_000_000,
        coTermedAdditionsArrCents: 0,
        expectedArrCents: 12_600_000,
        upliftBps: 500,
        autoRenew: true,
      },
      {
        id: 'rnw_later',
        subscriptionId: 'sub_1',
        accountId: 'acc_1',
        opportunityId: 'opp_c',
        renewalDate: '2027-12-31',
        noticeDate: '2027-11-01',
        status: 'not_started',
        currentArrCents: 12_000_000,
        renewableArrCents: 12_000_000,
        coTermedAdditionsArrCents: 0,
        expectedArrCents: 12_600_000,
        upliftBps: 500,
        autoRenew: true,
      },
    ];

    const target = findNextOpenRenewal(renewals, 'sub_1', '2026-09-01');
    expect(target?.id).toBe('rnw_open');

    const rolled = rollIntoRenewal(target!, 4_800_000);
    expect(rolled.coTermedAdditionsArrCents).toBe(4_800_000);
    expect(rolled.renewableArrCents).toBe(16_800_000);
    // Uplift recalculates on the larger footprint, not the old one.
    expect(rolled.upliftArrCents).toBe(840_000);
    expect(rolled.expectedArrCents).toBe(17_640_000);
  });

  it('skips closed renewals and renewals dated before the change', () => {
    const renewals: RenewalRecord[] = [
      {
        id: 'rnw_past',
        subscriptionId: 'sub_1',
        accountId: 'acc_1',
        opportunityId: null,
        renewalDate: '2026-06-30',
        noticeDate: null,
        status: 'not_started',
        currentArrCents: 0,
        renewableArrCents: 0,
        coTermedAdditionsArrCents: 0,
        expectedArrCents: 0,
        upliftBps: 500,
        autoRenew: true,
      },
    ];
    expect(findNextOpenRenewal(renewals, 'sub_1', '2026-09-01')).toBeNull();
  });
});

describe('contraction and cancellation', () => {
  it('records a removal as negative movement', () => {
    const sub = baseSubscription();
    sub.items.push({
      ...sub.items[0],
      id: 'subi_analytics',
      productId: 'prd_analytics',
      quantity: 100,
      netUnitCents: 36_000,
      arrCents: 3_600_000,
      annualizedArrCents: 3_600_000,
    });

    const plan = planAmendment({
      subscription: sub,
      type: 'contraction',
      effectiveDate: '2026-07-01',
      lines: [],
      removeItemIds: ['subi_analytics'],
    });

    expect(plan.deltaArrCents).toBe(-3_600_000);
    expect(plan.arrAfterCents).toBe(12_000_000);
    expect(plan.rollsIntoRenewal).toBe(true);
  });

  it('cancellation retires every active item', () => {
    const sub = baseSubscription();
    const plan = planAmendment({
      subscription: sub,
      type: 'cancellation',
      effectiveDate: '2026-07-01',
      lines: [],
    });

    expect(plan.deltaArrCents).toBe(-12_000_000);
    expect(plan.arrAfterCents).toBe(0);
    expect(plan.itemIdsRemoved).toEqual(['subi_1']);
    // A cancellation feeds no renewal.
    expect(plan.rollsIntoRenewal).toBe(false);

    const updated = applyAmendment(sub, plan, 'amd_cancel', []);
    expect(computeArr(updated.items)).toBe(0);
  });

  it('credits the unused portion of a cancelled term', () => {
    const sub = baseSubscription();
    // 2026-10-01 to 2026-12-31 is 92 days.
    expect(cancellationCredit(sub, '2026-10-01')).toBe(3_024_658);
  });
});

describe('renewal term planning', () => {
  it('starts the day after the old term and applies uplift', () => {
    const sub = baseSubscription();
    const term = planRenewalTerm(sub);

    expect(term.startDate).toBe('2027-01-01');
    expect(term.endDate).toBe('2027-12-31');
    expect(term.noticeDate).toBe('2026-11-01');
    expect(term.renewableArrCents).toBe(12_000_000);
    expect(term.upliftArrCents).toBe(600_000);
    expect(term.expectedArrCents).toBe(12_600_000);
  });

  /**
   * A part-year upsell must renew at its full annual rate — this is the case
   * where getting the annualised figure wrong silently loses revenue.
   */
  it('renews a co-termed mid-term addition at its full annual value', () => {
    const sub = baseSubscription();
    const ct = coTerm('2026-09-01', sub.endDate);
    const line = priceLine(
      {
        productId: 'prd_analytics',
        quantity: 100,
        termMonths: 12,
        startDate: ct.startDate,
        endDate: ct.endDate,
      },
      analyticsEntry,
    );
    const plan = planAmendment({
      subscription: sub,
      type: 'cross_sell',
      effectiveDate: '2026-09-01',
      lines: [line],
    });
    const updated = applyAmendment(sub, plan, 'amd_1', ['subi_analytics']);

    const term = planRenewalTerm(updated);
    // Platform $120,000 + analytics $36,000 at full annual value.
    expect(term.renewableArrCents).toBe(15_600_000);
    expect(term.expectedArrCents).toBe(16_380_000);
    expect(computeAnnualizedArr(updated.items)).toBe(15_600_000);
  });

  it('supports a multi-year renewal option', () => {
    const sub = baseSubscription();
    const term = planRenewalTerm(sub, { termMonths: 36 });
    expect(term.termMonths).toBe(36);
    expect(term.endDate).toBe('2029-12-31');
  });

  it('honours an uplift cap on the renewal', () => {
    const sub = baseSubscription();
    const term = planRenewalTerm(sub, { upliftBps: 900, upliftCapBps: 300 });
    expect(term.upliftBps).toBe(300);
    expect(term.upliftArrCents).toBe(360_000);
  });

  it('builds successor items on the new term with uplift applied', () => {
    const sub = baseSubscription();
    const term = planRenewalTerm(sub);
    const items = buildRenewalItems(sub, term, 500);

    expect(items).toHaveLength(1);
    expect(items[0].startDate).toBe('2027-01-01');
    expect(items[0].endDate).toBe('2027-12-31');
    expect(items[0].arrCents).toBe(12_600_000);
    expect(items[0].isCoTermed).toBe(false);
    expect(items[0].prorationFactorBps).toBe(10_000);
  });

  it('excludes removed items from the renewal', () => {
    const sub = baseSubscription();
    sub.items.push({
      ...sub.items[0],
      id: 'subi_gone',
      status: 'removed',
      arrCents: 9_000_000,
      annualizedArrCents: 9_000_000,
    });
    const term = planRenewalTerm(sub);
    expect(buildRenewalItems(sub, term, 0)).toHaveLength(1);
  });
});
