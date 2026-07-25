import { describe, expect, it } from 'vitest';
import {
  defaultForecastCategory,
  diffSnapshots,
  isAtRiskOfSlipping,
  pipelineAging,
  rollupForecast,
  salesVelocity,
  scoreAccuracy,
  stageConversion,
  winRate,
  type ForecastDeal,
  type SnapshotDeal,
} from '@/domain/forecast';

const deal = (over: Partial<ForecastDeal> = {}): ForecastDeal => ({
  id: 'opp_1',
  ownerId: 'usr_1',
  accountId: 'acc_1',
  stage: 'negotiation',
  forecastCategory: 'commit',
  type: 'new_logo',
  amountCents: 10_000_000,
  arrCents: 10_000_000,
  closeDate: '2026-08-15',
  isClosed: false,
  isWon: false,
  ...over,
});

describe('forecast rollup', () => {
  const deals: ForecastDeal[] = [
    deal({ id: 'won', isClosed: true, isWon: true, forecastCategory: 'closed', arrCents: 8_000_000 }),
    deal({ id: 'commit1', forecastCategory: 'commit', arrCents: 5_000_000, stage: 'contract' }),
    deal({ id: 'commit2', forecastCategory: 'commit', arrCents: 3_000_000 }),
    deal({ id: 'best', forecastCategory: 'best_case', arrCents: 6_000_000 }),
    deal({ id: 'pipe', forecastCategory: 'pipeline', arrCents: 12_000_000, stage: 'discovery' }),
    deal({ id: 'omit', forecastCategory: 'omitted', arrCents: 4_000_000 }),
    deal({ id: 'other_q', closeDate: '2026-11-15', forecastCategory: 'commit', arrCents: 99_000_000 }),
  ];

  it('separates closed-won from the open call', () => {
    const r = rollupForecast(deals, '2026-Q3', 30_000_000);

    expect(r.closedWonCents).toBe(8_000_000);
    expect(r.commitCents).toBe(8_000_000);
    expect(r.bestCaseCents).toBe(6_000_000);
    expect(r.pipelineCents).toBe(12_000_000);
    expect(r.omittedCents).toBe(4_000_000);
    // The defensible number is closed plus commit.
    expect(r.callCents).toBe(16_000_000);
    expect(r.bestCaseTotalCents).toBe(22_000_000);
  });

  it('excludes deals from other periods', () => {
    expect(rollupForecast(deals, '2026-Q3').commitCents).not.toContain(99_000_000);
    expect(rollupForecast(deals, '2026-Q4').commitCents).toBe(99_000_000);
  });

  /** Coverage is measured against the remaining gap, not the whole quota. */
  it('measures coverage against the gap to quota', () => {
    const r = rollupForecast(deals, '2026-Q3', 30_000_000);
    expect(r.gapToQuotaCents).toBe(22_000_000);
    expect(r.openCents).toBe(26_000_000);
    expect(r.coverageBps).toBe(11_818);
    expect(r.attainmentBps).toBe(2667);
  });

  it('reports zero coverage once quota is already attained', () => {
    const r = rollupForecast(deals, '2026-Q3', 5_000_000);
    expect(r.gapToQuotaCents).toBe(0);
    expect(r.coverageBps).toBe(0);
  });

  it('computes a stage-weighted figure alongside the categories', () => {
    const r = rollupForecast([deal({ probabilityBps: 5000, arrCents: 10_000_000 })], '2026-Q3');
    expect(r.weightedCents).toBe(5_000_000);
  });

  it('falls back to the stage default probability when none is set', () => {
    const r = rollupForecast([deal({ stage: 'contract', arrCents: 10_000_000 })], '2026-Q3');
    expect(r.weightedCents).toBe(9_000_000);
  });

  it('excludes parked deals from the open count', () => {
    const r = rollupForecast(
      [deal({ stage: 're_nurture', forecastCategory: 'omitted' })],
      '2026-Q3',
    );
    expect(r.dealCount).toBe(0);
  });
});

describe('default forecast category', () => {
  it('derives a sensible starting category from the stage', () => {
    expect(defaultForecastCategory('contract', false, false)).toBe('commit');
    expect(defaultForecastCategory('negotiation', false, false)).toBe('best_case');
    expect(defaultForecastCategory('discovery', false, false)).toBe('pipeline');
    expect(defaultForecastCategory('re_nurture', false, false)).toBe('omitted');
    expect(defaultForecastCategory('closed_won', true, true)).toBe('closed');
  });
});

describe('snapshot diffing', () => {
  const prior: SnapshotDeal[] = [
    { opportunityId: 'a', stage: 'discovery', forecastCategory: 'pipeline', amountCents: 5_000_000, arrCents: 5_000_000, closeDate: '2026-08-30', isClosed: false, isWon: false },
    { opportunityId: 'b', stage: 'proposal', forecastCategory: 'best_case', amountCents: 8_000_000, arrCents: 8_000_000, closeDate: '2026-09-15', isClosed: false, isWon: false },
    { opportunityId: 'c', stage: 'negotiation', forecastCategory: 'commit', amountCents: 12_000_000, arrCents: 12_000_000, closeDate: '2026-09-30', isClosed: false, isWon: false },
  ];

  const current: SnapshotDeal[] = [
    // advanced a stage and grew
    { opportunityId: 'a', stage: 'solution_design', forecastCategory: 'pipeline', amountCents: 6_000_000, arrCents: 6_000_000, closeDate: '2026-08-30', isClosed: false, isWon: false },
    // slipped out of the quarter
    { opportunityId: 'b', stage: 'proposal', forecastCategory: 'best_case', amountCents: 8_000_000, arrCents: 8_000_000, closeDate: '2026-11-20', isClosed: false, isWon: false },
    // won
    { opportunityId: 'c', stage: 'closed_won', forecastCategory: 'closed', amountCents: 12_000_000, arrCents: 12_000_000, closeDate: '2026-09-30', isClosed: true, isWon: true },
    // brand new
    { opportunityId: 'd', stage: 'srl', forecastCategory: 'pipeline', amountCents: 3_000_000, arrCents: 3_000_000, closeDate: '2026-09-10', isClosed: false, isWon: false },
  ];

  it('identifies creations, advances, wins and slippage', () => {
    const m = diffSnapshots(prior, current, '2026-Q3');

    expect(m.created).toEqual(['d']);
    expect(m.advanced).toEqual([
      { opportunityId: 'a', fromStage: 'discovery', toStage: 'solution_design' },
    ]);
    expect(m.won).toEqual(['c']);
    expect(m.slipped.map((s) => s.opportunityId)).toContain('b');
    expect(m.increased).toEqual([{ opportunityId: 'a', deltaCents: 1_000_000 }]);
  });

  it('reports net change for the period', () => {
    const m = diffSnapshots(prior, current, '2026-Q3');
    // Prior in-quarter: 5M + 8M + 12M = 25M. Current: 6M + 12M + 3M = 21M.
    expect(m.netChangeArrCents).toBe(-4_000_000);
  });

  it('detects regression to an earlier stage', () => {
    const regressed = [{ ...prior[2], stage: 'discovery' as const }];
    const m = diffSnapshots([prior[2]], regressed, '2026-Q3');
    expect(m.regressed).toEqual([
      { opportunityId: 'c', fromStage: 'negotiation', toStage: 'discovery' },
    ]);
  });

  it('detects a pull-in', () => {
    const pulled = [{ ...prior[1], closeDate: '2026-08-01' }];
    const m = diffSnapshots([prior[1]], pulled, '2026-Q3');
    expect(m.pulledIn).toEqual([]);
    const m2 = diffSnapshots(
      [{ ...prior[1], closeDate: '2026-12-01' }],
      [{ ...prior[1], closeDate: '2026-08-01' }],
      '2026-Q3',
    );
    expect(m2.pulledIn).toEqual(['b']);
  });

  it('reports a lost deal', () => {
    const lost = [{ ...prior[0], stage: 'closed_lost' as const, isClosed: true, isWon: false }];
    expect(diffSnapshots([prior[0]], lost, '2026-Q3').lost).toEqual(['a']);
  });
});

describe('forecast accuracy', () => {
  it('grades a forecast inside 5% as accurate', () => {
    const r = scoreAccuracy('2026-Q2', 10_200_000, 10_000_000);
    expect(r.verdict).toBe('accurate');
    expect(r.biasBps).toBe(200);
    expect(r.accuracyBps).toBe(9800);
  });

  it('identifies sandbagging', () => {
    const r = scoreAccuracy('2026-Q2', 8_000_000, 10_000_000);
    expect(r.verdict).toBe('sandbagged');
    expect(r.biasBps).toBe(-2000);
  });

  it('identifies over-commitment', () => {
    const r = scoreAccuracy('2026-Q2', 13_000_000, 10_000_000);
    expect(r.verdict).toBe('over_committed');
    expect(r.varianceCents).toBe(3_000_000);
  });

  it('handles a zero actual without dividing by zero', () => {
    const r = scoreAccuracy('2026-Q2', 5_000_000, 0);
    expect(r.accuracyBps).toBe(0);
    expect(Number.isFinite(r.biasBps)).toBe(true);
  });
});

describe('pipeline analytics', () => {
  it('computes stage conversion and average duration', () => {
    const history = [
      { opportunityId: '1', toStage: 'discovery' as const, durationDays: 10 },
      { opportunityId: '2', toStage: 'discovery' as const, durationDays: 20 },
      { opportunityId: '3', toStage: 'discovery' as const, durationDays: 30 },
      { opportunityId: '1', toStage: 'solution_design' as const, durationDays: 15 },
      { opportunityId: '2', toStage: 'solution_design' as const, durationDays: 25 },
    ];
    const rows = stageConversion(history);
    const discovery = rows.find((r) => r.stage === 'discovery')!;
    expect(discovery.entered).toBe(3);
    expect(discovery.advanced).toBe(2);
    expect(discovery.conversionBps).toBe(6667);
    expect(discovery.averageDaysInStage).toBe(20);
  });

  it('computes win rate over closed deals only', () => {
    const r = winRate([
      { isClosed: true, isWon: true },
      { isClosed: true, isWon: false },
      { isClosed: true, isWon: true },
      { isClosed: false, isWon: false },
    ]);
    expect(r.won).toBe(2);
    expect(r.lost).toBe(1);
    expect(r.winRateBps).toBe(6667);
  });

  it('computes sales velocity', () => {
    const r = salesVelocity({
      opportunityCount: 40,
      averageDealCents: 5_000_000,
      winRateBps: 2500,
      averageCycleDays: 90,
    });
    expect(r.velocityCentsPerDay).toBe(555_556);
  });

  it('buckets pipeline by age in stage', () => {
    const buckets = pipelineAging([
      { id: 'a', stage: 'discovery', daysInStage: 10 },
      { id: 'b', stage: 'proposal', daysInStage: 45 },
      { id: 'c', stage: 'negotiation', daysInStage: 75 },
      { id: 'd', stage: 'contract', daysInStage: 200 },
    ]);
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 1, 1]);
    expect(buckets[3].opportunityIds).toEqual(['d']);
  });

  it('flags a deal at risk of slipping and says why', () => {
    const r = isAtRiskOfSlipping(
      { stage: 'discovery', closeDate: '2026-08-15', nextMeetingAt: null, daysInStage: 60 },
      '2026-07-25',
    );
    expect(r.atRisk).toBe(true);
    expect(r.reasons.join(' ')).toContain('No next meeting');
    expect(r.reasons.join(' ')).toContain('60 days in current stage');
  });

  it('does not flag a well-run late-stage deal', () => {
    const r = isAtRiskOfSlipping(
      {
        stage: 'contract',
        closeDate: '2026-09-20',
        nextMeetingAt: new Date('2026-07-30'),
        daysInStage: 12,
      },
      '2026-07-25',
    );
    expect(r.atRisk).toBe(false);
  });
});
