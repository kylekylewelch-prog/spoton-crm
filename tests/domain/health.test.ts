import { describe, expect, it } from 'vitest';
import {
  bandFor,
  computeHealth,
  DEFAULT_WEIGHTS,
  renewalLikelihoodBps,
  type HealthInputs,
} from '@/domain/health';

const healthy: HealthInputs = {
  activeUsers: 190,
  licensedUsers: 200,
  logins30d: 2800,
  daysSinceLastActivity: 1,
  usageTrendBps: 800,
  featureAdoptionBps: 8200,
  modulesAdopted: 4,
  modulesEntitled: 4,
  consumptionBps: 9200,
  openCases: 1,
  severity1Cases: 0,
  slaBreaches90d: 0,
  openEscalations: 0,
  pastDueCents: 0,
  arrCents: 20_000_000,
  npsScore: 60,
  csatScore: 5,
  sentimentBand: 'positive',
  executiveEngagedDays: 20,
  championPresent: true,
  championTurnover: false,
  lastBusinessReviewDays: 45,
  onboardingProgressBps: 10_000,
  timeToValueDays: 40,
  targetTimeToValueDays: 60,
  daysToRenewal: 200,
  openRisks: 0,
  csmAssessment: 88,
  productGaps: 0,
};

const failing: HealthInputs = {
  activeUsers: 22,
  licensedUsers: 200,
  logins30d: 40,
  daysSinceLastActivity: 28,
  usageTrendBps: -2500,
  featureAdoptionBps: 1200,
  modulesAdopted: 1,
  modulesEntitled: 4,
  consumptionBps: 2000,
  openCases: 12,
  severity1Cases: 2,
  slaBreaches90d: 4,
  openEscalations: 2,
  pastDueCents: 3_000_000,
  arrCents: 20_000_000,
  npsScore: -40,
  csatScore: 2,
  sentimentBand: 'negative',
  executiveEngagedDays: 210,
  championPresent: false,
  championTurnover: true,
  lastBusinessReviewDays: 300,
  onboardingProgressBps: 4000,
  timeToValueDays: 220,
  targetTimeToValueDays: 60,
  daysToRenewal: 45,
  openRisks: 3,
  csmAssessment: 25,
  productGaps: 3,
};

describe('health bands', () => {
  it('maps scores onto bands', () => {
    expect(bandFor(92)).toBe('excellent');
    expect(bandFor(75)).toBe('good');
    expect(bandFor(60)).toBe('fair');
    expect(bandFor(45)).toBe('poor');
    expect(bandFor(20)).toBe('critical');
  });

  it('uses inclusive lower bounds', () => {
    expect(bandFor(85)).toBe('excellent');
    expect(bandFor(84)).toBe('good');
  });
});

describe('health scoring', () => {
  it('scores a thriving account highly with full confidence', () => {
    const result = computeHealth(healthy);
    expect(result.overall).toBeGreaterThanOrEqual(80);
    expect(result.band === 'good' || result.band === 'excellent').toBe(true);
    expect(result.confidenceBps).toBe(10_000);
  });

  it('scores a failing account critically', () => {
    const result = computeHealth(failing);
    expect(result.overall).toBeLessThan(40);
    expect(result.band === 'critical' || result.band === 'poor').toBe(true);
  });

  it('exposes every dimension so the score is explainable', () => {
    const result = computeHealth(healthy);
    expect(result.dimensions).toHaveLength(9);
    expect(result.dimensions.map((d) => d.dimension)).toContain('utilisation');
    for (const d of result.dimensions) {
      expect(d.weightBps).toBe(DEFAULT_WEIGHTS[d.dimension]);
      expect(d.score).not.toBeNull();
    }
  });

  /**
   * Absence of data is not evidence of ill health: unmeasured dimensions are
   * dropped and the remaining weights renormalised, with the shortfall reported as
   * reduced confidence.
   */
  it('renormalises around missing inputs rather than scoring them zero', () => {
    const sparse: HealthInputs = { activeUsers: 95, licensedUsers: 100 };
    const result = computeHealth(sparse);

    expect(result.overall).toBeGreaterThan(80);
    expect(result.confidenceBps).toBeLessThan(3000);
    expect(result.dimensions.find((d) => d.dimension === 'support')?.score).toBeNull();
    expect(result.recommendedAction).toContain('Confidence is low');
  });

  it('reports zero with no inputs at all', () => {
    const result = computeHealth({});
    expect(result.overall).toBe(0);
    expect(result.confidenceBps).toBe(0);
  });

  it('reads utilisation in both directions', () => {
    const shelfware = computeHealth({ activeUsers: 30, licensedUsers: 200 });
    expect(shelfware.dimensions.find((d) => d.dimension === 'utilisation')?.detail.join(' ')).toContain(
      'shelfware',
    );

    const ceiling = computeHealth({ activeUsers: 198, licensedUsers: 200 });
    expect(ceiling.dimensions.find((d) => d.dimension === 'utilisation')?.detail.join(' ')).toContain(
      'expansion opportunity',
    );
  });

  it('prioritises a live escalation in the recommended action', () => {
    const result = computeHealth({ ...healthy, severity1Cases: 2, openEscalations: 1 });
    expect(result.recommendedAction).toContain('escalation');
  });

  it('prioritises champion loss above everything else', () => {
    const result = computeHealth({ ...healthy, championTurnover: true });
    expect(result.recommendedAction).toContain('Champion');
  });

  it('computes the delta and ranks the reasons for the change', () => {
    const result = computeHealth(healthy, {
      previousOverall: 70,
      previousDimensions: { support: 40, usage: 90 },
    });
    expect(result.delta).toBe(result.overall - 70);
    expect(result.previousOverall).toBe(70);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(Math.abs(result.reasons[0].delta)).toBeGreaterThanOrEqual(
      Math.abs(result.reasons[result.reasons.length - 1].delta),
    );
  });

  it('honours a segment-specific weighting', () => {
    const supportHeavy = computeHealth(failing, {
      weights: { support: 9000, usage: 100, adoption: 100, utilisation: 100, payment: 100, sentiment: 100, engagement: 100, implementation: 100, contract: 100 },
    });
    const balanced = computeHealth(failing);
    expect(supportHeavy.overall).not.toBe(balanced.overall);
  });

  it('treats over-consumption as a signal, not a win', () => {
    const ideal = computeHealth({ consumptionBps: 9000 });
    const runaway = computeHealth({ consumptionBps: 18_000 });
    expect(runaway.overall).toBeLessThan(ideal.overall);
  });
});

describe('renewal likelihood', () => {
  const base = {
    healthScore: 80,
    autoRenew: true,
    noticePassed: false,
    cancellationNoticeReceived: false,
    championPresent: true,
    openRisks: 0,
    daysToRenewal: 90,
    utilisationBps: 9000,
    priorRenewals: 2,
  };

  it('returns zero once cancellation notice is received', () => {
    expect(renewalLikelihoodBps({ ...base, cancellationNoticeReceived: true })).toBe(0);
  });

  it('rates a healthy auto-renewing account highly', () => {
    expect(renewalLikelihoodBps(base)).toBeGreaterThan(7500);
  });

  /** Contractually, an auto-renew past its notice date has already renewed. */
  it('raises likelihood once the notice window has closed', () => {
    expect(renewalLikelihoodBps({ ...base, noticePassed: true })).toBeGreaterThan(
      renewalLikelihoodBps(base),
    );
  });

  it('penalises champion absence and open risks', () => {
    expect(renewalLikelihoodBps({ ...base, championPresent: false })).toBeLessThan(
      renewalLikelihoodBps(base),
    );
    expect(renewalLikelihoodBps({ ...base, openRisks: 3 })).toBeLessThan(
      renewalLikelihoodBps(base),
    );
  });

  it('penalises low licence utilisation', () => {
    expect(renewalLikelihoodBps({ ...base, utilisationBps: 2000 })).toBeLessThan(
      renewalLikelihoodBps(base),
    );
  });

  it('stays inside 0-10000', () => {
    const max = renewalLikelihoodBps({ ...base, healthScore: 100, noticePassed: true, priorRenewals: 9 });
    const min = renewalLikelihoodBps({
      healthScore: 0,
      autoRenew: false,
      noticePassed: false,
      cancellationNoticeReceived: false,
      championPresent: false,
      openRisks: 9,
      daysToRenewal: 300,
      utilisationBps: 100,
    });
    expect(max).toBeLessThanOrEqual(10_000);
    expect(min).toBeGreaterThanOrEqual(0);
  });
});
