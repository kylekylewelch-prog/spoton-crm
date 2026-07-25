import { describe, expect, it } from 'vitest';
import {
  classifyRun,
  interpolate,
  interpolateConfig,
  nextRetry,
  scheduledFor,
  selectWorkflows,
  shouldRunAction,
  type ActionResult,
  type TriggerEvent,
  type WorkflowDefinition,
} from '@/domain/workflow';
import {
  escalationLevel,
  evaluateTimer,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  supportSla,
} from '@/domain/sla';

const T0 = new Date('2026-07-25T09:00:00Z');

describe('SLA timers', () => {
  it('starts with a due time derived from the target', () => {
    const t = startTimer('case_first_response', 60, T0);
    expect(t.dueAt.toISOString()).toBe('2026-07-25T10:00:00.000Z');
    expect(t.status).toBe('running');
  });

  it('marks a timer met when stopped in time', () => {
    const t = stopTimer(startTimer('x', 60, T0), new Date('2026-07-25T09:30:00Z'));
    expect(t.status).toBe('met');
    expect(t.breachedAt).toBeNull();
  });

  it('marks a timer breached when stopped late', () => {
    const t = stopTimer(startTimer('x', 60, T0), new Date('2026-07-25T11:00:00Z'));
    expect(t.status).toBe('breached');
    expect(t.breachedAt).not.toBeNull();
  });

  /** Waiting on the customer should not burn our clock. */
  it('extends the effective deadline by paused time', () => {
    let t = startTimer('x', 60, T0);
    t = pauseTimer(t);
    expect(t.status).toBe('paused');
    t = resumeTimer(t, 120);
    expect(t.pausedMinutes).toBe(120);

    // Stopped three hours later, but two of them were the customer's.
    const stopped = stopTimer(t, new Date('2026-07-25T11:45:00Z'));
    expect(stopped.status).toBe('met');
  });

  it('reports remaining time and an at-risk warning', () => {
    const t = startTimer('x', 100, T0);

    const early = evaluateTimer(t, new Date('2026-07-25T09:30:00Z'));
    expect(early.minutesRemaining).toBe(70);
    expect(early.atRisk).toBe(false);
    expect(early.percentConsumedBps).toBe(3000);

    const late = evaluateTimer(t, new Date('2026-07-25T10:25:00Z'));
    expect(late.atRisk).toBe(true);

    const over = evaluateTimer(t, new Date('2026-07-25T11:00:00Z'));
    expect(over.breached).toBe(true);
    expect(over.minutesRemaining).toBeLessThan(0);
  });

  it('leaves a completed timer alone', () => {
    const done = stopTimer(startTimer('x', 60, T0), new Date('2026-07-25T09:10:00Z'));
    const evaluated = evaluateTimer(done, new Date('2026-07-26T00:00:00Z'));
    expect(evaluated.status).toBe('met');
    expect(evaluated.breached).toBe(false);
  });
});

describe('support SLA targets', () => {
  it('gives premier entitlements tighter targets than standard', () => {
    expect(supportSla('premier', 1).firstResponse).toBeLessThan(
      supportSla('standard', 1).firstResponse,
    );
  });

  it('tightens targets as severity rises', () => {
    expect(supportSla('enterprise', 1).resolution).toBeLessThan(
      supportSla('enterprise', 3).resolution,
    );
  });

  it('falls back to standard for an unknown level and clamps severity', () => {
    expect(supportSla(null, 1)).toEqual(supportSla('standard', 1));
    expect(supportSla('premier', 9)).toEqual(supportSla('premier', 4));
  });
});

describe('escalation ladder', () => {
  it('does not escalate a routine case', () => {
    const e = escalationLevel({
      severity: 3,
      breachCount: 0,
      reopenCount: 0,
      arrCents: 1_000_000,
      isStrategicAccount: false,
    });
    expect(e.level).toBe(0);
    expect(e.notifyRoles).toEqual([]);
    expect(e.executiveVisible).toBe(false);
  });

  /** A production outage should not wait eight hours to reach an executive. */
  it('starts a severity-1 case one rung up', () => {
    const e = escalationLevel({
      severity: 1,
      breachCount: 0,
      reopenCount: 0,
      arrCents: 1_000_000,
      isStrategicAccount: false,
    });
    expect(e.level).toBe(1);
    expect(e.notifyRoles).toContain('support_manager');
  });

  it('raises the level on breaches, reopens and account importance', () => {
    const e = escalationLevel({
      severity: 1,
      breachCount: 2,
      reopenCount: 2,
      arrCents: 40_000_000,
      isStrategicAccount: true,
    });
    expect(e.level).toBe(4);
    expect(e.notifyRoles).toContain('cro');
    expect(e.executiveVisible).toBe(true);
  });

  it('makes a large-ARB account executive-visible sooner', () => {
    const small = escalationLevel({ severity: 2, breachCount: 2, reopenCount: 0, arrCents: 500_000, isStrategicAccount: false });
    const large = escalationLevel({ severity: 2, breachCount: 2, reopenCount: 0, arrCents: 50_000_000, isStrategicAccount: false });
    expect(large.level).toBeGreaterThan(small.level);
  });
});

/* ------------------------------------------------------------------ workflows */

const def = (over: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: 'wfd_1',
  name: 'Test workflow',
  objectType: 'opportunities',
  trigger: 'on_field_change',
  watchField: 'stage',
  entryCriteria: { stage: 'closed_won' },
  exitCriteria: {},
  actions: [{ type: 'create_task', config: { title: 'Book it' } }],
  ownerUserId: 'usr_admin',
  maxAttempts: 3,
  exceptionQueue: 'default',
  active: true,
  ...over,
});

describe('workflow selection', () => {
  const event: TriggerEvent = {
    objectType: 'opportunities',
    recordId: 'opp_1',
    kind: 'update',
    record: { stage: 'closed_won', arrCents: 1_000_000 },
    changedFields: ['stage'],
  };

  it('fires when the watched field changes and criteria match', () => {
    expect(selectWorkflows([def()], event)).toHaveLength(1);
  });

  it('does not fire when a different field changed', () => {
    expect(selectWorkflows([def()], { ...event, changedFields: ['amountCents'] })).toHaveLength(0);
  });

  it('does not fire when entry criteria fail', () => {
    expect(
      selectWorkflows([def()], { ...event, record: { stage: 'negotiation' } }),
    ).toHaveLength(0);
  });

  it('ignores inactive definitions and other object types', () => {
    expect(selectWorkflows([def({ active: false })], event)).toHaveLength(0);
    expect(selectWorkflows([def({ objectType: 'leads' })], event)).toHaveLength(0);
  });

  /** Suppression: nothing to do if the record is already in the end state. */
  it('skips when exit criteria are already satisfied', () => {
    const d = def({ exitCriteria: { hasSubscription: true } });
    expect(
      selectWorkflows([d], { ...event, record: { ...event.record, hasSubscription: true } }),
    ).toHaveLength(0);
    expect(
      selectWorkflows([d], { ...event, record: { ...event.record, hasSubscription: false } }),
    ).toHaveLength(1);
  });

  it('matches trigger kinds correctly', () => {
    const created: TriggerEvent = { ...event, kind: 'create' };
    expect(selectWorkflows([def({ trigger: 'on_create', watchField: null })], created)).toHaveLength(1);
    expect(selectWorkflows([def({ trigger: 'on_create', watchField: null })], event)).toHaveLength(0);
    expect(
      selectWorkflows([def({ trigger: 'scheduled', watchField: null })], { ...event, kind: 'scheduled' }),
    ).toHaveLength(1);
  });

  it('computes the scheduled date for a time-based workflow', () => {
    const d = def({ trigger: 'time_based', offsetFromField: 'renewalDate', offsetDays: -90 });
    expect(scheduledFor(d, { renewalDate: '2026-12-31' })).toBe('2026-10-02');
    expect(scheduledFor(d, {})).toBeNull();
  });
});

describe('workflow retries', () => {
  const ok: ActionResult = { action: 'create_task', status: 'succeeded', detail: 'created' };
  const bad: ActionResult = { action: 'send_email', status: 'failed', detail: 'smtp', error: 'timeout' };

  it('succeeds when every action succeeds', () => {
    expect(classifyRun([ok], 1, 3).status).toBe('succeeded');
  });

  it('retries with exponential backoff before exhausting attempts', () => {
    const r = classifyRun([ok, bad], 1, 3, T0);
    expect(r.status).toBe('retrying');
    expect(r.nextRetryAt!.toISOString()).toBe('2026-07-25T09:01:00.000Z');
    expect(r.error).toContain('timeout');

    expect(classifyRun([bad], 2, 3, T0).nextRetryAt!.toISOString()).toBe(
      '2026-07-25T09:02:00.000Z',
    );
  });

  /** A failure must land somewhere a human looks, not vanish. */
  it('dead-letters after the final attempt', () => {
    const r = classifyRun([bad], 3, 3);
    expect(r.status).toBe('dead_letter');
    expect(r.nextRetryAt).toBeNull();
  });

  it('caps the backoff at an hour', () => {
    const far = nextRetry(20, T0);
    expect(far.getTime() - T0.getTime()).toBe(60 * 60_000);
  });

  it('treats no actions as skipped', () => {
    expect(classifyRun([], 1, 3).status).toBe('skipped');
  });
});

describe('workflow action guards and templating', () => {
  it('respects a per-action guard', () => {
    const action = { type: 'send_email' as const, config: {}, when: { tier: 'strategic' } };
    expect(shouldRunAction(action, { tier: 'strategic' })).toBe(true);
    expect(shouldRunAction(action, { tier: 'smb' })).toBe(false);
    expect(shouldRunAction({ type: 'send_email', config: {} }, {})).toBe(true);
  });

  it('interpolates record fields into templates', () => {
    expect(interpolate('Renewal for {{name}} due {{renewalDate}}', { name: 'Acme', renewalDate: '2026-12-31' })).toBe(
      'Renewal for Acme due 2026-12-31',
    );
    expect(interpolate('Missing {{nope}}', {})).toBe('Missing ');
  });

  it('interpolates only the string values in a config', () => {
    const out = interpolateConfig({ title: 'Chase {{name}}', priority: 'high', days: 30 }, { name: 'Acme' });
    expect(out).toEqual({ title: 'Chase Acme', priority: 'high', days: 30 });
  });
});
