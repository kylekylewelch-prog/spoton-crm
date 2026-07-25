import { describe, expect, it } from 'vitest';
import {
  assessRenewalRisk,
  renewalForecastCategory,
  renewalNeedsApproval,
  renewalScenarios,
  renewalStartDate,
  renewalUrgency,
} from '@/domain/renewals';

const ASOF = '2026-07-25';

const lowRisk = {
  healthScore: 85,
  renewalLikelihoodBps: 8500,
  daysToRenewal: 150,
  openRisks: 0,
  openSeverity1Cases: 0,
  slaBreaches90d: 0,
  utilisationBps: 9200,
  championPresent: true,
  championTurnover: false,
  executiveEngagedDays: 20,
  pastDueCents: 0,
  cancellationNoticeReceived: false,
  autoRenew: true,
  arrCents: 20_000_000,
};

describe('renewal risk', () => {
  it('rates a healthy account low risk with no exposure', () => {
    const risk = assessRenewalRisk(lowRisk);
    expect(risk.level).toBe('low');
    expect(risk.churnRiskArrCents).toBe(0);
    expect(risk.recommendedPlaybook).toBe('renewal_standard');
    expect(risk.requiresEscalation).toBe(false);
  });

  it('treats a received cancellation notice as critical immediately', () => {
    const risk = assessRenewalRisk({ ...lowRisk, cancellationNoticeReceived: true });
    expect(risk.level).toBe('critical');
    expect(risk.score).toBe(100);
    // The whole contract is exposed, not a fraction of it.
    expect(risk.churnRiskArrCents).toBe(20_000_000);
    expect(risk.recommendedPlaybook).toBe('save_play');
  });

  it('escalates when health collapses and the champion leaves', () => {
    const risk = assessRenewalRisk({
      ...lowRisk,
      healthScore: 30,
      championPresent: false,
      championTurnover: true,
      utilisationBps: 2500,
      openRisks: 2,
    });
    expect(risk.level).toBe('critical');
    expect(risk.drivers.join(' ')).toContain('Champion has left');
    expect(risk.churnRiskArrCents).toBeGreaterThan(0);
    expect(risk.requiresEscalation).toBe(true);
  });

  it('scales exposed ARR with the risk level rather than all-or-nothing', () => {
    // Health of 50 is below par (+22) plus one open risk (+5) — squarely medium.
    const medium = assessRenewalRisk({ ...lowRisk, healthScore: 50, openRisks: 1 });
    expect(medium.level).toBe('medium');
    expect(medium.churnRiskArrCents).toBeGreaterThan(0);
    expect(medium.churnRiskArrCents).toBeLessThan(lowRisk.arrCents);
  });

  it('names every driver so the assessment is auditable', () => {
    const risk = assessRenewalRisk({
      ...lowRisk,
      healthScore: 45,
      openSeverity1Cases: 1,
      slaBreaches90d: 2,
      pastDueCents: 500_000,
      executiveEngagedDays: 200,
      autoRenew: false,
    });
    const joined = risk.drivers.join(' | ');
    expect(joined).toContain('severity-1');
    expect(joined).toContain('SLA breach');
    expect(joined).toContain('Past-due');
    expect(joined).toContain('executive contact');
    expect(joined).toContain('Auto-renew');
  });

  it('escalates a high-risk large renewal even below critical', () => {
    const risk = assessRenewalRisk({
      ...lowRisk,
      healthScore: 50,
      championPresent: false,
      utilisationBps: 3000,
      arrCents: 30_000_000,
    });
    expect(risk.level).toBe('high');
    expect(risk.requiresEscalation).toBe(true);
  });
});

describe('renewal forecast category', () => {
  /** The rule that removes most guesswork from a renewal forecast. */
  it('commits an auto-renewal once the notice window has closed', () => {
    expect(
      renewalForecastCategory({
        autoRenew: true,
        noticePassed: true,
        cancellationNoticeReceived: false,
        riskLevel: 'medium',
        renewalLikelihoodBps: 6000,
        isQuoted: false,
        isCommitted: false,
      }),
    ).toBe('commit');
  });

  it('omits a renewal that has served notice', () => {
    expect(
      renewalForecastCategory({
        autoRenew: true,
        noticePassed: true,
        cancellationNoticeReceived: true,
        riskLevel: 'low',
        renewalLikelihoodBps: 9000,
        isQuoted: true,
        isCommitted: true,
      }),
    ).toBe('omitted');
  });

  it('omits a critical-risk renewal', () => {
    expect(
      renewalForecastCategory({
        autoRenew: false,
        noticePassed: false,
        cancellationNoticeReceived: false,
        riskLevel: 'critical',
        renewalLikelihoodBps: 4000,
        isQuoted: false,
        isCommitted: false,
      }),
    ).toBe('omitted');
  });

  it('commits a quoted renewal with strong likelihood', () => {
    expect(
      renewalForecastCategory({
        autoRenew: false,
        noticePassed: false,
        cancellationNoticeReceived: false,
        riskLevel: 'low',
        renewalLikelihoodBps: 8000,
        isQuoted: true,
        isCommitted: false,
      }),
    ).toBe('commit');
  });

  it('grades unquoted renewals by likelihood', () => {
    const shared = {
      autoRenew: false,
      noticePassed: false,
      cancellationNoticeReceived: false,
      riskLevel: 'low' as const,
      isQuoted: false,
      isCommitted: false,
    };
    expect(renewalForecastCategory({ ...shared, renewalLikelihoodBps: 8000 })).toBe('best_case');
    expect(renewalForecastCategory({ ...shared, renewalLikelihoodBps: 5000 })).toBe('pipeline');
    expect(renewalForecastCategory({ ...shared, renewalLikelihoodBps: 2000 })).toBe('omitted');
  });
});

describe('renewal scenarios', () => {
  it('produces a downside, expected and upside case', () => {
    const s = renewalScenarios({
      renewableArrCents: 20_000_000,
      upliftBps: 500,
      riskLevel: 'medium',
      expansionOpportunityArrCents: 4_000_000,
    });

    expect(s.expectedArrCents).toBe(21_000_000);
    expect(s.upsideArrCents).toBe(25_000_000);
    expect(s.downsideArrCents).toBe(17_000_000);
    expect(s.churnRiskArrCents).toBe(3_000_000);
    expect(s.downsideArrCents).toBeLessThan(s.expectedArrCents);
    expect(s.upsideArrCents).toBeGreaterThan(s.expectedArrCents);
  });

  it('widens the downside as risk rises', () => {
    const args = { renewableArrCents: 10_000_000, upliftBps: 500 };
    const low = renewalScenarios({ ...args, riskLevel: 'low' });
    const critical = renewalScenarios({ ...args, riskLevel: 'critical' });
    expect(critical.downsideArrCents).toBeLessThan(low.downsideArrCents);
    expect(critical.churnRiskArrCents).toBeGreaterThan(low.churnRiskArrCents);
  });

  it('subtracts a known contraction from every scenario', () => {
    const s = renewalScenarios({
      renewableArrCents: 10_000_000,
      upliftBps: 0,
      riskLevel: 'low',
      knownContractionArrCents: 2_000_000,
    });
    expect(s.expectedArrCents).toBe(8_000_000);
  });
});

describe('renewal timing', () => {
  it('starts large and risky renewals earlier', () => {
    expect(renewalStartDate('2026-12-31', 1_000_000, 'low').leadDays).toBe(90);
    expect(renewalStartDate('2026-12-31', 60_000_000, 'low').leadDays).toBe(210);
    expect(renewalStartDate('2026-12-31', 60_000_000, 'critical').leadDays).toBe(270);
  });

  it('returns the date to begin work', () => {
    expect(renewalStartDate('2026-12-31', 1_000_000, 'low').startDate).toBe('2026-10-02');
  });

  it('buckets renewals by urgency', () => {
    expect(
      renewalUrgency({ renewalDate: '2026-06-30', noticeDate: '2026-05-01', autoRenew: true }, ASOF)
        .bucket,
    ).toBe('overdue');

    expect(
      renewalUrgency({ renewalDate: '2026-09-30', noticeDate: '2026-08-01', autoRenew: true }, ASOF)
        .bucket,
    ).toBe('notice_window');

    expect(
      renewalUrgency({ renewalDate: '2026-10-15', noticeDate: '2026-09-15', autoRenew: true }, ASOF)
        .bucket,
    ).toBe('this_quarter');

    expect(
      renewalUrgency({ renewalDate: '2027-06-30', noticeDate: '2027-05-01', autoRenew: true }, ASOF)
        .bucket,
    ).toBe('future');
  });

  it('detects a passed notice date', () => {
    const result = renewalUrgency(
      { renewalDate: '2026-08-31', noticeDate: '2026-07-01', autoRenew: true },
      ASOF,
    );
    expect(result.noticePassed).toBe(true);
  });
});

describe('renewal approval triggers', () => {
  it('requires approval when uplift is waived', () => {
    const result = renewalNeedsApproval({
      contractualUpliftBps: 500,
      proposedUpliftBps: 0,
      renewableArrCents: 10_000_000,
      proposedArrCents: 10_000_000,
      termMonths: 12,
      contractualTermMonths: 12,
    });
    expect(result.required).toBe(true);
    expect(result.reasons[0]).toContain('Uplift reduced');
  });

  it('requires approval on a contraction and quantifies it', () => {
    const result = renewalNeedsApproval({
      contractualUpliftBps: 500,
      proposedUpliftBps: 500,
      renewableArrCents: 10_000_000,
      proposedArrCents: 8_500_000,
      termMonths: 12,
      contractualTermMonths: 12,
    });
    expect(result.required).toBe(true);
    expect(result.reasons.join(' ')).toContain('15.0% contraction');
  });

  it('requires approval on a shortened term', () => {
    const result = renewalNeedsApproval({
      contractualUpliftBps: 500,
      proposedUpliftBps: 500,
      renewableArrCents: 10_000_000,
      proposedArrCents: 10_500_000,
      termMonths: 6,
      contractualTermMonths: 12,
    });
    expect(result.required).toBe(true);
  });

  it('needs no approval for a standard renewal at uplift', () => {
    const result = renewalNeedsApproval({
      contractualUpliftBps: 500,
      proposedUpliftBps: 500,
      renewableArrCents: 10_000_000,
      proposedArrCents: 10_500_000,
      termMonths: 12,
      contractualTermMonths: 12,
    });
    expect(result.required).toBe(false);
  });
});
