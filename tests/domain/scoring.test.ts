import { describe, expect, it } from 'vitest';
import {
  decayFactor,
  decayStoredScore,
  MQL_THRESHOLD,
  scoreFit,
  scoreIntent,
  scoreLead,
  scoreNegative,
  type ResponseEvent,
} from '@/domain/scoring';

const ASOF = '2026-07-25';

describe('fit scoring', () => {
  it('scores an ideal-profile buyer highly', () => {
    const result = scoreFit({
      employeeCount: 6000,
      industry: 'Software',
      country: 'US',
      title: 'Chief Technology Officer',
      hasBusinessEmail: true,
    });
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.detail).toContain('target industry: Software');
  });

  it('scores a poor-profile lead low', () => {
    const result = scoreFit({
      employeeCount: 3,
      industry: 'Agriculture',
      country: 'ZW',
      title: 'Student',
      hasBusinessEmail: false,
    });
    expect(result.score).toBeLessThan(30);
  });

  it('gives existing customers a land-and-expand bonus', () => {
    const base = { employeeCount: 500, industry: 'Retail', country: 'GB', hasBusinessEmail: true };
    const cold = scoreFit(base);
    const warm = scoreFit({ ...base, isExistingCustomer: true });
    expect(warm.score).toBeGreaterThan(cold.score);
  });

  it('clamps to the 0-100 range', () => {
    const result = scoreFit({
      employeeCount: 100_000,
      industry: 'Software',
      country: 'US',
      title: 'Chief Executive Officer',
      hasBusinessEmail: true,
      isExistingCustomer: true,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('decay', () => {
  it('halves the contribution every half-life', () => {
    expect(decayFactor(ASOF, ASOF)).toBe(1);
    expect(decayFactor('2026-06-25', ASOF, 30)).toBeCloseTo(0.5, 2);
    expect(decayFactor('2026-05-26', ASOF, 30)).toBeCloseTo(0.25, 1);
  });

  it('decays a stored score without the raw events', () => {
    expect(decayStoredScore(80, '2026-06-10', ASOF, 45)).toBeLessThan(80);
    expect(decayStoredScore(80, ASOF, ASOF, 45)).toBe(80);
  });
});

describe('intent scoring', () => {
  it('weights a fresh demo request above an old one', () => {
    const fresh: ResponseEvent[] = [{ type: 'demo_request', occurredAt: '2026-07-24' }];
    const stale: ResponseEvent[] = [{ type: 'demo_request', occurredAt: '2026-01-10' }];
    expect(scoreIntent(fresh, ASOF).score).toBeGreaterThan(scoreIntent(stale, ASOF).score);
  });

  it('ignores purely behavioural events', () => {
    const events: ResponseEvent[] = [{ type: 'content_download', occurredAt: ASOF }];
    expect(scoreIntent(events, ASOF).score).toBe(0);
  });
});

describe('negative scoring', () => {
  it('penalises disqualifying signals', () => {
    expect(scoreNegative({ competitor: true }).score).toBe(60);
    expect(scoreNegative({ jobSeeker: true }).score).toBe(50);
    expect(scoreNegative({}).score).toBe(0);
  });

  it('accumulates and caps at 100', () => {
    const result = scoreNegative({
      competitor: true,
      jobSeeker: true,
      unsubscribed: true,
      student: true,
    });
    expect(result.score).toBe(100);
  });
});

describe('blended lead score', () => {
  const strongFit = {
    employeeCount: 4000,
    industry: 'Financial Services',
    country: 'US',
    title: 'VP of Engineering',
    hasBusinessEmail: true,
  };

  it('makes a high-fit, high-intent lead an MQL', () => {
    const result = scoreLead({
      fit: strongFit,
      events: [
        { type: 'demo_request', occurredAt: '2026-07-23' },
        { type: 'trial_signup', occurredAt: '2026-07-20' },
        { type: 'content_download', occurredAt: '2026-07-10' },
      ],
      engagement: { emailsOpened: 8, emailsClicked: 3, meetingsHeld: 1, lastResponseAt: '2026-07-22', asOf: ASOF },
      negative: {},
      asOf: ASOF,
    });

    expect(result.totalScore).toBeGreaterThanOrEqual(MQL_THRESHOLD);
    expect(result.isMql).toBe(true);
    expect(result.grade === 'A' || result.grade === 'B').toBe(true);
  });

  /**
   * The point of keeping the negative score separate: one disqualifying fact
   * should override an otherwise excellent profile rather than being averaged in.
   */
  it('disqualifies a competitor despite a perfect profile', () => {
    const result = scoreLead({
      fit: strongFit,
      events: [{ type: 'demo_request', occurredAt: ASOF }],
      engagement: { emailsOpened: 10, emailsClicked: 5, meetingsHeld: 2, lastResponseAt: ASOF, asOf: ASOF },
      negative: { competitor: true },
      asOf: ASOF,
    });
    expect(result.isMql).toBe(false);
    expect(result.negativeScore).toBe(60);
  });

  it('does not make a low-fit lead an MQL on engagement alone', () => {
    const result = scoreLead({
      fit: { employeeCount: 2, country: 'XX', hasBusinessEmail: false },
      events: [
        { type: 'content_download', occurredAt: ASOF },
        { type: 'form_fill', occurredAt: ASOF },
      ],
      engagement: { emailsOpened: 20, emailsClicked: 10, asOf: ASOF, lastResponseAt: ASOF },
      negative: {},
      asOf: ASOF,
    });
    expect(result.isMql).toBe(false);
  });

  it('keeps every dimension visible for explainability', () => {
    const result = scoreLead({
      fit: strongFit,
      events: [{ type: 'demo_request', occurredAt: ASOF }],
      engagement: { asOf: ASOF, lastResponseAt: null },
      negative: { unsubscribed: true },
      asOf: ASOF,
    });

    expect(result).toMatchObject({
      fitScore: expect.any(Number),
      intentScore: expect.any(Number),
      engagementScore: expect.any(Number),
      behavioralScore: expect.any(Number),
      negativeScore: expect.any(Number),
    });
    expect(result.detail.negative).toContain('unsubscribed from email');
  });

  it('penalises a lead that has never responded', () => {
    const responded = scoreLead({
      fit: strongFit,
      events: [],
      engagement: { meetingsHeld: 1, lastResponseAt: '2026-07-24', asOf: ASOF },
      negative: {},
      asOf: ASOF,
    });
    const silent = scoreLead({
      fit: strongFit,
      events: [],
      engagement: { meetingsHeld: 1, lastResponseAt: null, asOf: ASOF },
      negative: {},
      asOf: ASOF,
    });
    expect(silent.engagementScore).toBeLessThan(responded.engagementScore);
  });
});
