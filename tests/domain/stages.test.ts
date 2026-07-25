import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  evaluateStageGate,
  OPEN_STAGES,
  STAGE_KEYS,
  STAGES,
  stageLabel,
  weightedValue,
} from '@/domain/stages';

describe('stage configuration', () => {
  it('defines all nine configured stages with their display numbers', () => {
    expect(STAGE_KEYS).toHaveLength(9);
    expect(STAGE_KEYS.map((k) => stageLabel(k))).toEqual([
      '0 - SRL',
      '1 - Discovery',
      '2 - Solution Design',
      '3 - Proposal',
      '4 - Negotiation',
      '5 - Contract',
      '6 - Closed Won',
      '7 - Re-Nurture',
      '8 - Closed Lost',
    ]);
  });

  it('marks terminal and parked stages correctly', () => {
    expect(STAGES.closed_won.isClosed && STAGES.closed_won.isWon).toBe(true);
    expect(STAGES.closed_lost.isClosed && !STAGES.closed_lost.isWon).toBe(true);
    expect(STAGES.re_nurture.isParked).toBe(true);
    expect(STAGES.re_nurture.isClosed).toBe(false);
  });

  it('excludes closed and parked stages from open pipeline', () => {
    expect(OPEN_STAGES).toEqual([
      'srl',
      'discovery',
      'solution_design',
      'proposal',
      'negotiation',
      'contract',
    ]);
  });

  it('increases default probability monotonically through the funnel', () => {
    const probs = OPEN_STAGES.map((k) => STAGES[k].defaultProbabilityBps);
    for (let i = 1; i < probs.length; i++) expect(probs[i]).toBeGreaterThan(probs[i - 1]);
  });

  it('weights a value by stage probability', () => {
    expect(weightedValue(10_000_000, 'negotiation')).toBe(7_000_000);
    expect(weightedValue(10_000_000, 'closed_lost')).toBe(0);
  });
});

describe('allowed transitions', () => {
  it('permits one step forward, any step back, and terminal outcomes', () => {
    const from = allowedTransitions('discovery', 'new_logo');
    expect(from).toContain('solution_design');
    expect(from).toContain('srl');
    expect(from).toContain('closed_won');
    expect(from).toContain('closed_lost');
    expect(from).toContain('re_nurture');
    // Cannot skip a stage.
    expect(from).not.toContain('proposal');
  });

  it('makes closed-won terminal', () => {
    expect(allowedTransitions('closed_won', 'new_logo')).toEqual([]);
  });

  it('allows a lost deal to be recycled into re-nurture', () => {
    expect(allowedTransitions('closed_lost', 'new_logo')).toEqual(['re_nurture']);
  });

  it('allows a parked deal back into discovery', () => {
    expect(allowedTransitions('re_nurture', 'new_logo')).toEqual(['discovery', 'closed_lost']);
  });

  it('never lets a churn opportunity be won', () => {
    const from = allowedTransitions('discovery', 'churn');
    expect(from).toEqual(['closed_lost', 're_nurture']);
  });
});

describe('stage gates', () => {
  const complete = {
    accountId: 'acc_1',
    contactRoleCount: 3,
    nextStep: 'Security review Thursday',
    description: 'Consolidating three tools; audit deadline in Q4',
    hasDecisionMaker: true,
    nextMeetingAt: new Date('2026-08-01'),
    amountCents: 12_000_000,
    productCount: 2,
    arrCents: 12_000_000,
    hasMutualActionPlan: true,
    closePlan: 'Signature by 30 Sept',
    hasApprovedQuote: true,
    hasEconomicBuyer: true,
    competitors: ['Incumbent Co'],
    hasAcceptedQuote: true,
    termMonths: 12,
    lossReason: null,
    reNurtureUntil: null,
  };

  it('allows a forward move when every exit criterion is met', () => {
    const result = evaluateStageGate('discovery', 'solution_design', 'new_logo', complete);
    expect(result.allowed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('blocks a forward move and names each unmet criterion', () => {
    const result = evaluateStageGate('discovery', 'solution_design', 'new_logo', {
      ...complete,
      hasDecisionMaker: false,
      nextMeetingAt: null,
      contactRoleCount: 1,
    });

    expect(result.allowed).toBe(false);
    expect(result.failures.map((f) => f.field)).toEqual(
      expect.arrayContaining(['hasDecisionMaker', 'nextMeetingAt', 'contactRoleCount']),
    );
    expect(result.illegalTransition).toBe(false);
  });

  it('flags an illegal transition separately from unmet criteria', () => {
    const result = evaluateStageGate('srl', 'negotiation', 'new_logo', complete);
    expect(result.allowed).toBe(false);
    expect(result.illegalTransition).toBe(true);
  });

  it('does not enforce exit criteria when moving backwards', () => {
    const result = evaluateStageGate('proposal', 'discovery', 'new_logo', {
      ...complete,
      hasApprovedQuote: false,
      hasEconomicBuyer: false,
    });
    expect(result.allowed).toBe(true);
  });

  it('requires a loss reason to close lost', () => {
    const blocked = evaluateStageGate('negotiation', 'closed_lost', 'new_logo', {
      ...complete,
      lossReason: null,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.failures[0].field).toBe('lossReason');

    const ok = evaluateStageGate('negotiation', 'closed_lost', 'new_logo', {
      ...complete,
      lossReason: 'Lost to incumbent on price',
    });
    expect(ok.allowed).toBe(true);
  });

  it('requires a recycle date and a reason to park a deal', () => {
    const blocked = evaluateStageGate('discovery', 're_nurture', 'new_logo', complete);
    expect(blocked.allowed).toBe(false);
    expect(blocked.failures.map((f) => f.field)).toEqual(
      expect.arrayContaining(['reNurtureUntil', 'lossReason']),
    );

    const ok = evaluateStageGate('discovery', 're_nurture', 'new_logo', {
      ...complete,
      reNurtureUntil: '2027-01-15',
      lossReason: 'Budget deferred to next fiscal year',
    });
    expect(ok.allowed).toBe(true);
  });

  it('treats a same-stage update as allowed', () => {
    expect(evaluateStageGate('discovery', 'discovery', 'new_logo', {}).allowed).toBe(true);
  });

  it('blocks progression out of SRL without a contact role', () => {
    const result = evaluateStageGate('srl', 'discovery', 'new_logo', {
      accountId: 'acc_1',
      contactRoleCount: 0,
      nextStep: 'Call scheduled',
    });
    expect(result.allowed).toBe(false);
    expect(result.failures[0].field).toBe('contactRoleCount');
  });
});
