import { describe, expect, it } from 'vitest';
import {
  campaignPerformance,
  creditTouches,
  sourceStamps,
  sourcedVsInfluenced,
  weightTouches,
  type Touch,
} from '@/domain/attribution';
import { BPS } from '@/domain/money';

const touch = (id: string, occurredAt: string, category = 'marketing', campaignId = `cmp_${id}`): Touch => ({
  id,
  campaignId,
  sourceCategory: category,
  occurredAt,
});

const journey: Touch[] = [
  touch('t1', '2026-01-10', 'marketing'),
  touch('t2', '2026-02-14', 'bdr'),
  touch('t3', '2026-03-20', 'marketing'),
  touch('t4', '2026-05-05', 'partner'),
];

describe('touch weighting', () => {
  it('gives all credit to the first touch under first-touch', () => {
    const w = weightTouches(journey, 'first_touch');
    expect(w).toEqual([{ touchId: 't1', weightBps: BPS }]);
  });

  it('gives all credit to the last touch under last-touch', () => {
    const w = weightTouches(journey, 'last_touch');
    expect(w).toEqual([{ touchId: 't4', weightBps: BPS }]);
  });

  it('splits evenly under linear and still totals exactly 10000', () => {
    const w = weightTouches(journey, 'linear');
    expect(w).toHaveLength(4);
    expect(w.reduce((s, x) => s + x.weightBps, 0)).toBe(BPS);
    expect(w.every((x) => x.weightBps === 2500)).toBe(true);
  });

  it('totals exactly 10000 for an awkward touch count', () => {
    const three = journey.slice(0, 3);
    const w = weightTouches(three, 'linear');
    expect(w.reduce((s, x) => s + x.weightBps, 0)).toBe(BPS);
    expect(w.map((x) => x.weightBps)).toEqual([3334, 3333, 3333]);
  });

  it('weights recent touches more heavily under time decay', () => {
    const w = weightTouches(journey, 'time_decay', { closedAt: '2026-05-20' });
    expect(w.reduce((s, x) => s + x.weightBps, 0)).toBe(BPS);
    const byId = Object.fromEntries(w.map((x) => [x.touchId, x.weightBps]));
    expect(byId.t4).toBeGreaterThan(byId.t1);
  });

  it('credits the touch nearest opportunity creation', () => {
    const w = weightTouches(journey, 'opportunity_creation', {
      opportunityCreatedAt: '2026-03-25',
    });
    expect(w).toEqual([{ touchId: 't3', weightBps: BPS }]);
  });

  it('shapes credit across the three anchor moments under W-shaped', () => {
    const w = weightTouches(journey, 'w_shaped', {
      contactCreatedAt: '2026-02-14',
      opportunityCreatedAt: '2026-05-05',
    });
    expect(w.reduce((s, x) => s + x.weightBps, 0)).toBe(BPS);
    const byId = Object.fromEntries(w.map((x) => [x.touchId, x.weightBps]));
    // First touch, lead creation and opportunity creation carry the weight.
    expect(byId.t1).toBeGreaterThanOrEqual(3000);
    expect(byId.t2).toBeGreaterThanOrEqual(3000);
    expect(byId.t4).toBeGreaterThanOrEqual(3000);
    expect(byId.t3).toBeLessThan(2000);
  });

  it('excludes touches outside the attribution window', () => {
    // t3 (2026-03-20) is 61 days before the close, t4 (2026-05-05) is 15.
    const tight = weightTouches(journey, 'linear', {
      closedAt: '2026-05-20',
      attributionWindowDays: 60,
    });
    expect(tight.map((x) => x.touchId)).toEqual(['t4']);

    const inclusive = weightTouches(journey, 'linear', {
      closedAt: '2026-05-20',
      attributionWindowDays: 61,
    });
    expect(inclusive.map((x) => x.touchId).sort()).toEqual(['t3', 't4']);
    expect(inclusive.reduce((s, x) => s + x.weightBps, 0)).toBe(BPS);
  });

  it('handles a single-touch journey and an empty one', () => {
    expect(weightTouches([touch('solo', '2026-01-01')], 'linear')).toEqual([
      { touchId: 'solo', weightBps: BPS },
    ]);
    expect(weightTouches([], 'linear')).toEqual([]);
  });
});

describe('credit allocation', () => {
  it('distributes value without losing cents', () => {
    const credited = creditTouches(journey.slice(0, 3), 'linear', {
      pipelineCents: 10_000_001,
      arrCents: 3_333_333,
      revenueCents: 7,
    });

    expect(credited.reduce((s, c) => s + c.creditedPipelineCents, 0)).toBe(10_000_001);
    expect(credited.reduce((s, c) => s + c.creditedArrCents, 0)).toBe(3_333_333);
    expect(credited.reduce((s, c) => s + c.creditedRevenueCents, 0)).toBe(7);
  });

  it('carries the campaign and source category through', () => {
    const credited = creditTouches(journey, 'first_touch', {
      pipelineCents: 1000,
      arrCents: 1000,
      revenueCents: 0,
    });
    expect(credited[0].campaignId).toBe('cmp_t1');
    expect(credited[0].sourceCategory).toBe('marketing');
  });
});

describe('sourced versus influenced', () => {
  /**
   * Sourced is exclusive, influenced is inclusive. Influenced pipeline legitimately
   * sums to more than total pipeline, which is why the two can never share a column.
   */
  it('assigns sourced credit to exactly one team and influenced to all', () => {
    const result = sourcedVsInfluenced(
      journey,
      { opportunityCreatedAt: '2026-03-25' },
      { pipelineCents: 10_000_000, arrCents: 10_000_000 },
    );

    expect(result.sourcedBy).toBe('marketing');
    expect(result.sourcedCampaignId).toBe('cmp_t3');
    expect(Object.keys(result.sourced)).toEqual(['marketing']);

    expect(result.influencedBy.sort()).toEqual(['bdr', 'marketing', 'partner']);
    expect(result.influenced.bdr.arrCents).toBe(10_000_000);
    expect(result.influenced.partner.arrCents).toBe(10_000_000);
  });

  it('attributes a partner-created opportunity to the partner', () => {
    const result = sourcedVsInfluenced(
      journey,
      { opportunityCreatedAt: '2026-05-10' },
      { pipelineCents: 5_000_000, arrCents: 5_000_000 },
    );
    expect(result.sourcedBy).toBe('partner');
  });

  it('handles a journey with no touches', () => {
    const result = sourcedVsInfluenced([], {}, { pipelineCents: 100, arrCents: 100 });
    expect(result.sourcedBy).toBeNull();
    expect(result.influencedBy).toEqual([]);
  });
});

describe('campaign performance', () => {
  it('computes ROI and unit costs', () => {
    const perf = campaignPerformance({
      campaignId: 'cmp_1',
      costCents: 2_500_000,
      responses: 250,
      opportunities: 20,
      sourcedPipelineCents: 40_000_000,
      sourcedArrCents: 10_000_000,
      influencedPipelineCents: 90_000_000,
      influencedArrCents: 22_000_000,
    });

    expect(perf.roiBps).toBe(40_000); // 4x return on sourced ARR
    expect(perf.costPerResponseCents).toBe(10_000);
    expect(perf.costPerOpportunityCents).toBe(125_000);
  });

  it('avoids dividing by zero on a free campaign', () => {
    const perf = campaignPerformance({
      campaignId: 'cmp_2',
      costCents: 0,
      responses: 0,
      opportunities: 0,
      sourcedPipelineCents: 0,
      sourcedArrCents: 0,
      influencedPipelineCents: 0,
      influencedArrCents: 0,
    });
    expect(perf.roiBps).toBe(0);
    expect(perf.costPerResponseCents).toBe(0);
  });
});

describe('source stamps', () => {
  it('records first and most recent source', () => {
    const stamps = sourceStamps(journey);
    expect(stamps.originalSource).toBe('marketing');
    expect(stamps.originalCampaignId).toBe('cmp_t1');
    expect(stamps.latestSource).toBe('partner');
    expect(stamps.latestCampaignId).toBe('cmp_t4');
  });

  it('returns nulls with no touches', () => {
    expect(sourceStamps([]).originalSource).toBeNull();
  });
});
