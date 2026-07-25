import { describe, expect, it } from 'vitest';
import {
  applyUplift,
  billingSchedule,
  buildRamp,
  coTerm,
  finalRampYearArr,
  overageCharge,
  priceLine,
  prorationFactorBps,
  rampTcv,
  selectPriceBookEntry,
  totalQuote,
} from '@/domain/pricing';
import type { PriceBookEntryLike } from '@/domain/pricing';

const entry = (over: Partial<PriceBookEntryLike> = {}): PriceBookEntryLike => ({
  id: 'pbe_1',
  productId: 'prd_platform',
  listUnitCents: 120_000, // $1,200 per seat per year
  minQuantity: 1,
  maxQuantity: null,
  termMonths: 12,
  multiYearDiscountBps: 0,
  includedVolume: null,
  overageUnitCents: null,
  ...over,
});

describe('price book selection', () => {
  const entries: PriceBookEntryLike[] = [
    entry({ id: 'tier1', minQuantity: 1, maxQuantity: 49, listUnitCents: 120_000 }),
    entry({ id: 'tier2', minQuantity: 50, maxQuantity: 249, listUnitCents: 102_000 }),
    entry({ id: 'tier3', minQuantity: 250, maxQuantity: null, listUnitCents: 84_000 }),
    entry({ id: 'tier2_36mo', minQuantity: 50, maxQuantity: 249, termMonths: 36, listUnitCents: 90_000 }),
  ];

  it('picks the volume tier the quantity falls into', () => {
    expect(selectPriceBookEntry(entries, 'prd_platform', 25, 12)?.id).toBe('tier1');
    expect(selectPriceBookEntry(entries, 'prd_platform', 120, 12)?.id).toBe('tier2');
    expect(selectPriceBookEntry(entries, 'prd_platform', 900, 12)?.id).toBe('tier3');
  });

  it('prefers an exact term match over a wider band', () => {
    expect(selectPriceBookEntry(entries, 'prd_platform', 120, 36)?.id).toBe('tier2_36mo');
  });

  it('returns null when no band matches the product', () => {
    expect(selectPriceBookEntry(entries, 'prd_unknown', 10, 12)).toBeNull();
  });

  it('ignores inactive entries', () => {
    const inactive = [entry({ id: 'off', active: false })];
    expect(selectPriceBookEntry(inactive, 'prd_platform', 10, 12)).toBeNull();
  });
});

describe('proration', () => {
  it('treats a full year as 100%', () => {
    expect(prorationFactorBps('2026-01-01', '2026-12-31')).toBe(10_000);
  });

  it('prorates a partial term by days', () => {
    // 2026-09-01 to 2026-12-31 is 122 days of 365.
    expect(prorationFactorBps('2026-09-01', '2026-12-31')).toBe(3342);
  });

  it('prorates a single day', () => {
    expect(prorationFactorBps('2026-06-15', '2026-06-15')).toBe(27);
  });
});

describe('co-termination', () => {
  it('snaps a mid-term addition to the parent end date', () => {
    const result = coTerm('2026-09-01', '2026-12-31');
    expect(result.endDate).toBe('2026-12-31');
    expect(result.remainingDays).toBe(122);
    expect(result.prorationFactorBps).toBe(3342);
    expect(result.isCoTermed).toBe(true);
  });

  it('yields zero proration when the term has already ended', () => {
    const result = coTerm('2027-01-15', '2026-12-31');
    expect(result.remainingDays).toBe(0);
    expect(result.prorationFactorBps).toBe(0);
  });
});

describe('priceLine', () => {
  it('prices a straightforward annual line', () => {
    const line = priceLine(
      { productId: 'prd_platform', quantity: 50, termMonths: 12, startDate: '2026-01-01' },
      entry(),
    );

    expect(line.endDate).toBe('2026-12-31');
    expect(line.netUnitCents).toBe(120_000);
    expect(line.discountBps).toBe(0);
    expect(line.arrCents).toBe(6_000_000); // 50 x $1,200 = $60,000
    expect(line.proratedAmountCents).toBe(6_000_000);
    expect(line.tcvCents).toBe(6_000_000);
  });

  it('applies a seller discount and reports the implied rate', () => {
    const line = priceLine(
      {
        productId: 'prd_platform',
        quantity: 100,
        termMonths: 12,
        startDate: '2026-01-01',
        discountBps: 1500,
      },
      entry(),
    );

    expect(line.netUnitCents).toBe(102_000);
    expect(line.discountBps).toBe(1500);
    expect(line.arrCents).toBe(10_200_000);
  });

  it('derives the discount from a negotiated unit price', () => {
    const line = priceLine(
      {
        productId: 'prd_platform',
        quantity: 10,
        termMonths: 12,
        startDate: '2026-01-01',
        netUnitCentsOverride: 90_000,
      },
      entry(),
    );
    expect(line.discountBps).toBe(2500);
  });

  /**
   * The central case in the specification: a mid-term addition bills a stub
   * period now but must carry its full annual value into the renewal.
   */
  it('separates billed-now from annual value on a co-termed mid-term addition', () => {
    const ct = coTerm('2026-09-01', '2026-12-31');
    const line = priceLine(
      {
        productId: 'prd_platform',
        quantity: 40,
        termMonths: 12,
        startDate: ct.startDate,
        endDate: ct.endDate,
      },
      entry(),
    );

    // Annual run rate is the full 40 seats at list.
    expect(line.arrCents).toBe(4_800_000); // $48,000
    expect(line.annualizedArrCents).toBe(4_800_000);
    // Cash now is only the 122 remaining days, prorated on exact days.
    expect(line.proratedAmountCents).toBe(1_604_384);
    expect(line.prorationFactorBps).toBe(3342);
    expect(line.endDate).toBe('2026-12-31');
  });

  it('counts only the delta when quantity increases on an existing item', () => {
    const line = priceLine(
      {
        productId: 'prd_platform',
        action: 'increase',
        quantity: 75,
        priorQuantity: 50,
        termMonths: 12,
        startDate: '2026-01-01',
      },
      entry(),
    );
    expect(line.arrCents).toBe(3_000_000); // 25 incremental seats
  });

  it('returns negative ARR when an item is removed', () => {
    const line = priceLine(
      {
        productId: 'prd_platform',
        action: 'remove',
        quantity: 20,
        priorQuantity: 20,
        termMonths: 12,
        startDate: '2026-01-01',
      },
      entry(),
    );
    expect(line.arrCents).toBe(-2_400_000);
  });

  it('carries no ARR on a non-recurring services line', () => {
    const line = priceLine(
      {
        productId: 'prd_onboarding',
        quantity: 1,
        termMonths: 12,
        startDate: '2026-01-01',
        isRecurring: false,
      },
      entry({ productId: 'prd_onboarding', listUnitCents: 1_500_000 }),
    );
    expect(line.arrCents).toBe(0);
    expect(line.proratedAmountCents).toBe(1_500_000);
    expect(line.tcvCents).toBe(1_500_000);
  });
});

describe('ramps and multi-year pricing', () => {
  it('builds a growing ramp with a multi-year discount', () => {
    const ramp = buildRamp(3, 100, 120_000, 2000, 1000);
    expect(ramp).toHaveLength(3);
    expect(ramp[0]).toEqual({ year: 1, quantity: 100, netUnitCents: 108_000 });
    expect(ramp[1].quantity).toBe(120);
    expect(ramp[2].quantity).toBe(144);
  });

  it('renews from the final ramp year, not the first', () => {
    const ramp = buildRamp(3, 100, 120_000, 2000, 0);
    expect(finalRampYearArr(ramp)).toBe(144 * 120_000);
    expect(rampTcv(ramp)).toBe((100 + 120 + 144) * 120_000);
  });

  it('uses the final ramp year as the annualised ARR on a line', () => {
    const ramp = buildRamp(3, 100, 120_000, 2000, 0);
    const line = priceLine(
      {
        productId: 'prd_platform',
        quantity: 100,
        termMonths: 36,
        startDate: '2026-01-01',
        rampSchedule: ramp,
      },
      entry(),
    );
    expect(line.arrCents).toBe(12_000_000);
    expect(line.annualizedArrCents).toBe(17_280_000);
    expect(line.tcvCents).toBe(rampTcv(ramp));
  });
});

describe('quote totals', () => {
  it('blends the discount across all lines', () => {
    const lines = [
      priceLine(
        {
          productId: 'prd_platform',
          quantity: 100,
          termMonths: 12,
          startDate: '2026-01-01',
          discountBps: 1000,
        },
        entry(),
      ),
      priceLine(
        {
          productId: 'prd_addon',
          quantity: 100,
          termMonths: 12,
          startDate: '2026-01-01',
          discountBps: 3000,
        },
        entry({ productId: 'prd_addon', listUnitCents: 30_000 }),
      ),
    ];

    const totals = totalQuote(lines);
    expect(totals.listTotalCents).toBe(12_000_000 + 3_000_000);
    expect(totals.netTotalCents).toBe(10_800_000 + 2_100_000);
    expect(totals.discountTotalCents).toBe(2_100_000);
    // Blended against list across the whole quote: 2.1M / 15M = 14%.
    expect(totals.effectiveDiscountBps).toBe(1400);
    expect(totals.arrCents).toBe(12_900_000);
  });

  it('reports full proration when nothing is co-termed', () => {
    const lines = [
      priceLine(
        { productId: 'prd_platform', quantity: 10, termMonths: 12, startDate: '2026-01-01' },
        entry(),
      ),
    ];
    expect(totalQuote(lines).prorationFactorBps).toBe(10_000);
  });
});

describe('uplift', () => {
  it('applies a contractual uplift', () => {
    const result = applyUplift(10_000_000, 500);
    expect(result.upliftArrCents).toBe(500_000);
    expect(result.newArrCents).toBe(10_500_000);
    expect(result.appliedBps).toBe(500);
  });

  it('honours a negotiated cap', () => {
    const result = applyUplift(10_000_000, 700, 300);
    expect(result.appliedBps).toBe(300);
    expect(result.upliftArrCents).toBe(300_000);
  });
});

describe('usage overage', () => {
  it('charges only volume above the included amount', () => {
    expect(overageCharge(1200, 1000, 50)).toBe(10_000);
    expect(overageCharge(800, 1000, 50)).toBe(0);
  });
});

describe('billing schedule', () => {
  it('splits an annual term into quarterly instalments that sum exactly', () => {
    const schedule = billingSchedule('2026-01-01', '2026-12-31', 'quarterly', 12_000_000);
    expect(schedule).toHaveLength(4);
    expect(schedule.reduce((s, p) => s + p.amountCents, 0)).toBe(12_000_000);
    expect(schedule[0].periodStart).toBe('2026-01-01');
    expect(schedule[3].periodEnd).toBe('2026-12-31');
  });

  it('splits into twelve monthly instalments that sum exactly', () => {
    const schedule = billingSchedule('2026-01-01', '2026-12-31', 'monthly', 10_000_001);
    expect(schedule).toHaveLength(12);
    expect(schedule.reduce((s, p) => s + p.amountCents, 0)).toBe(10_000_001);
  });

  it('bills a single instalment upfront', () => {
    const schedule = billingSchedule('2026-01-01', '2028-12-31', 'upfront', 30_000_000);
    expect(schedule).toEqual([
      { periodStart: '2026-01-01', periodEnd: '2028-12-31', amountCents: 30_000_000 },
    ]);
  });

  it('does not run past the term end on an uneven split', () => {
    const schedule = billingSchedule('2026-01-01', '2026-10-31', 'quarterly', 9_000_000);
    expect(schedule.at(-1)!.periodEnd).toBe('2026-10-31');
    expect(schedule.reduce((s, p) => s + p.amountCents, 0)).toBe(9_000_000);
  });
});
