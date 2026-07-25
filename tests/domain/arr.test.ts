import { describe, expect, it } from 'vitest';
import {
  buildWaterfall,
  buildWaterfallSeries,
  classifyMovement,
  dealAverages,
  decomposeOpportunityMovement,
  movementRowsFor,
  retention,
  type ArrMovement,
} from '@/domain/arr';

const mv = (
  type: ArrMovement['type'],
  arrDeltaCents: number,
  effectiveDate: string,
): ArrMovement => ({ type, arrDeltaCents, effectiveDate, accountId: 'acc_1' });

describe('movement classification', () => {
  it('treats the first subscription for an account as new ARR', () => {
    expect(
      classifyMovement({
        isFirstSubscriptionForAccount: true,
        isRenewal: false,
        deltaArrCents: 5_000_000,
        quantityChanged: true,
        priceChanged: false,
        isCancellation: false,
      }),
    ).toBe('new');
  });

  it('separates a price-only increase as uplift rather than expansion', () => {
    expect(
      classifyMovement({
        isFirstSubscriptionForAccount: false,
        isRenewal: true,
        deltaArrCents: 600_000,
        quantityChanged: false,
        priceChanged: true,
        isCancellation: false,
      }),
    ).toBe('uplift');
  });

  it('classifies added seats as expansion', () => {
    expect(
      classifyMovement({
        isFirstSubscriptionForAccount: false,
        isRenewal: false,
        deltaArrCents: 2_400_000,
        quantityChanged: true,
        priceChanged: false,
        isCancellation: false,
      }),
    ).toBe('expansion');
  });

  it('classifies a reduction as contraction and a cancellation as churn', () => {
    expect(
      classifyMovement({
        isFirstSubscriptionForAccount: false,
        isRenewal: false,
        deltaArrCents: -1_000_000,
        quantityChanged: true,
        priceChanged: false,
        isCancellation: false,
      }),
    ).toBe('contraction');

    expect(
      classifyMovement({
        isFirstSubscriptionForAccount: false,
        isRenewal: false,
        deltaArrCents: -1_000_000,
        quantityChanged: false,
        priceChanged: false,
        isCancellation: true,
      }),
    ).toBe('churn');
  });

  /** A flat renewal is not a churn-plus-new pair; it is no movement at all. */
  it('produces no movement for a flat renewal', () => {
    expect(
      classifyMovement({
        isFirstSubscriptionForAccount: false,
        isRenewal: true,
        deltaArrCents: 0,
        quantityChanged: false,
        priceChanged: false,
        isCancellation: false,
      }),
    ).toBeNull();
  });
});

describe('waterfall', () => {
  const movements = [
    mv('new', 5_000_000, '2026-01-15'),
    mv('expansion', 2_000_000, '2026-01-20'),
    mv('uplift', 500_000, '2026-01-25'),
    mv('contraction', -750_000, '2026-01-28'),
    mv('churn', -1_250_000, '2026-01-31'),
    mv('new', 9_000_000, '2026-02-10'),
  ];

  it('sums each component and ties to the ending balance', () => {
    const w = buildWaterfall('2026-01', 100_000_000, movements);

    expect(w.newArrCents).toBe(5_000_000);
    expect(w.expansionArrCents).toBe(2_000_000);
    expect(w.upliftArrCents).toBe(500_000);
    expect(w.contractionArrCents).toBe(-750_000);
    expect(w.churnArrCents).toBe(-1_250_000);
    expect(w.netChangeArrCents).toBe(5_500_000);
    expect(w.endingArrCents).toBe(105_500_000);
    expect(w.grossExpansionArrCents).toBe(2_500_000);
    expect(w.grossLossArrCents).toBe(-2_000_000);
  });

  it('excludes movements outside the period', () => {
    expect(buildWaterfall('2026-02', 0, movements).newArrCents).toBe(9_000_000);
  });

  it('chains periods so each opens where the last closed', () => {
    const series = buildWaterfallSeries(['2026-01', '2026-02'], 100_000_000, movements);
    expect(series[0].endingArrCents).toBe(105_500_000);
    expect(series[1].beginningArrCents).toBe(105_500_000);
    expect(series[1].endingArrCents).toBe(114_500_000);
  });

  it('reports an empty period as unchanged', () => {
    const w = buildWaterfall('2026-06', 50_000_000, movements);
    expect(w.netChangeArrCents).toBe(0);
    expect(w.endingArrCents).toBe(50_000_000);
  });
});

describe('retention', () => {
  it('caps gross retention at 100% and lets net exceed it', () => {
    const r = retention({
      beginningArrCents: 100_000_000,
      expansionArrCents: 12_000_000,
      upliftArrCents: 3_000_000,
      contractionArrCents: -4_000_000,
      churnArrCents: -6_000_000,
    });

    // (100 - 4 - 6) / 100 = 90%
    expect(r.grossRetentionBps).toBe(9000);
    // (90 + 12 + 3) / 100 = 105%
    expect(r.netRetentionBps).toBe(10_500);
  });

  it('normalises the sign of losses passed in as positive', () => {
    const a = retention({
      beginningArrCents: 10_000_000,
      expansionArrCents: 0,
      upliftArrCents: 0,
      contractionArrCents: 1_000_000,
      churnArrCents: 0,
    });
    expect(a.grossRetentionBps).toBe(9000);
  });

  it('computes renewal rate against renewable ARR', () => {
    const r = retention({
      beginningArrCents: 10_000_000,
      expansionArrCents: 0,
      upliftArrCents: 0,
      contractionArrCents: 0,
      churnArrCents: 0,
      renewableArrCents: 8_000_000,
      renewedArrCents: 7_200_000,
    });
    expect(r.renewalRateBps).toBe(9000);
  });

  it('computes logo retention separately from ARR retention', () => {
    const r = retention({
      beginningArrCents: 10_000_000,
      expansionArrCents: 0,
      upliftArrCents: 0,
      contractionArrCents: 0,
      churnArrCents: 0,
      beginningLogos: 50,
      churnedLogos: 4,
    });
    expect(r.logoRetentionBps).toBe(9200);
  });

  it('returns zeroes rather than dividing by zero on an empty base', () => {
    const r = retention({
      beginningArrCents: 0,
      expansionArrCents: 5_000_000,
      upliftArrCents: 0,
      contractionArrCents: 0,
      churnArrCents: 0,
    });
    expect(r.grossRetentionBps).toBe(0);
    expect(r.netRetentionBps).toBe(0);
  });
});

describe('opportunity movement decomposition', () => {
  /**
   * One expansion transaction containing four different kinds of revenue
   * movement — the case that a single net figure would destroy.
   */
  it('splits a mixed expansion deal into its components', () => {
    const result = decomposeOpportunityMovement([
      // 40 extra seats on a product they already own
      { action: 'increase', arrCents: 4_800_000, annualizedArrCents: 4_800_000, isNewProductForAccount: false, priceChangedOnly: false },
      // a cross-sold module they have never bought
      { action: 'add', arrCents: 3_600_000, annualizedArrCents: 3_600_000, isNewProductForAccount: true, priceChangedOnly: false },
      // a price rise on the existing platform
      { action: 'price_change', arrCents: 600_000, annualizedArrCents: 600_000, isNewProductForAccount: false, priceChangedOnly: true },
      // a retired add-on
      { action: 'remove', arrCents: -900_000, annualizedArrCents: -900_000, isNewProductForAccount: false, priceChangedOnly: false },
    ]);

    expect(result.newArrCents).toBe(3_600_000);
    expect(result.expansionArrCents).toBe(4_800_000);
    expect(result.upliftArrCents).toBe(600_000);
    expect(result.churnArrCents).toBe(-900_000);
    expect(result.netArrCents).toBe(8_100_000);
  });

  it('treats a quantity decrease as contraction, not churn', () => {
    const result = decomposeOpportunityMovement([
      { action: 'decrease', arrCents: -1_200_000, annualizedArrCents: -1_200_000, isNewProductForAccount: false, priceChangedOnly: false },
    ]);
    expect(result.contractionArrCents).toBe(-1_200_000);
    expect(result.churnArrCents).toBe(0);
  });
});

describe('ledger rows', () => {
  it('writes one row per non-zero component with fiscal stamps', () => {
    const rows = movementRowsFor({
      accountId: 'acc_1',
      subscriptionId: 'sub_1',
      opportunityId: 'opp_1',
      effectiveDate: '2026-05-15',
      components: {
        newArrCents: 0,
        expansionArrCents: 4_800_000,
        upliftArrCents: 600_000,
        contractionArrCents: 0,
        churnArrCents: -900_000,
      },
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.type)).toEqual(['expansion', 'uplift', 'churn']);
    expect(rows[0].fiscalPeriod).toBe('2026-05');
    expect(rows[0].fiscalQuarter).toBe('2026-Q2');
    expect(rows.reduce((s, r) => s + r.arrDeltaCents, 0)).toBe(4_500_000);
  });

  it('writes nothing when there is no movement', () => {
    expect(
      movementRowsFor({
        accountId: 'acc_1',
        effectiveDate: '2026-05-15',
        components: {
          newArrCents: 0,
          expansionArrCents: 0,
          upliftArrCents: 0,
          contractionArrCents: 0,
          churnArrCents: 0,
        },
      }),
    ).toHaveLength(0);
  });
});

describe('deal averages', () => {
  it('computes ACV and ASP', () => {
    const result = dealAverages([
      { arrCents: 10_000_000, tcvCents: 30_000_000 },
      { arrCents: 5_000_000, tcvCents: 5_000_000 },
    ]);
    expect(result.averageSellingPriceCents).toBe(7_500_000);
    expect(result.averageContractValueCents).toBe(17_500_000);
    expect(result.count).toBe(2);
  });

  it('handles an empty set', () => {
    expect(dealAverages([]).count).toBe(0);
  });
});
