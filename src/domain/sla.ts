/**
 * SLA timers and escalation.
 *
 * Every timer has a target, a due time and a terminal state. Timers can be paused
 * (waiting on the customer should not burn the clock) and paused minutes are
 * tracked separately so the reported time-to-resolution is the time we actually
 * controlled.
 */

export type SlaState = 'running' | 'paused' | 'met' | 'breached' | 'cancelled';

export type SlaTimer = {
  name: string;
  targetMinutes: number;
  startedAt: Date;
  dueAt: Date;
  stoppedAt?: Date | null;
  breachedAt?: Date | null;
  pausedMinutes: number;
  status: SlaState;
};

export function startTimer(
  name: string,
  targetMinutes: number,
  startedAt: Date = new Date(),
): SlaTimer {
  return {
    name,
    targetMinutes,
    startedAt,
    dueAt: new Date(startedAt.getTime() + targetMinutes * 60_000),
    pausedMinutes: 0,
    status: 'running',
  };
}

/** Stops a timer, recording whether the target was met. */
export function stopTimer(timer: SlaTimer, stoppedAt: Date = new Date()): SlaTimer {
  if (timer.status !== 'running' && timer.status !== 'paused') return timer;
  const effectiveDue = new Date(timer.dueAt.getTime() + timer.pausedMinutes * 60_000);
  const breached = stoppedAt > effectiveDue;
  return {
    ...timer,
    stoppedAt,
    status: breached ? 'breached' : 'met',
    breachedAt: breached ? effectiveDue : null,
  };
}

export function pauseTimer(timer: SlaTimer): SlaTimer {
  return timer.status === 'running' ? { ...timer, status: 'paused' } : timer;
}

export function resumeTimer(timer: SlaTimer, pausedForMinutes: number): SlaTimer {
  return timer.status === 'paused'
    ? {
        ...timer,
        status: 'running',
        pausedMinutes: timer.pausedMinutes + Math.max(0, Math.round(pausedForMinutes)),
      }
    : timer;
}

export type SlaEvaluation = {
  status: SlaState;
  minutesRemaining: number;
  breached: boolean;
  /** True inside the last 20% of the window — the nudge threshold. */
  atRisk: boolean;
  elapsedMinutes: number;
  percentConsumedBps: number;
};

export function evaluateTimer(timer: SlaTimer, now: Date = new Date()): SlaEvaluation {
  if (timer.status === 'met' || timer.status === 'breached' || timer.status === 'cancelled') {
    const elapsed = timer.stoppedAt
      ? Math.round((timer.stoppedAt.getTime() - timer.startedAt.getTime()) / 60_000)
      : timer.targetMinutes;
    return {
      status: timer.status,
      minutesRemaining: 0,
      breached: timer.status === 'breached',
      atRisk: false,
      elapsedMinutes: elapsed,
      percentConsumedBps:
        timer.targetMinutes > 0
          ? Math.round((elapsed / timer.targetMinutes) * 10_000)
          : 10_000,
    };
  }

  const effectiveDue = new Date(timer.dueAt.getTime() + timer.pausedMinutes * 60_000);
  const minutesRemaining = Math.round((effectiveDue.getTime() - now.getTime()) / 60_000);
  const elapsedMinutes = Math.max(
    0,
    Math.round((now.getTime() - timer.startedAt.getTime()) / 60_000) - timer.pausedMinutes,
  );
  const breached = minutesRemaining < 0;
  const consumed =
    timer.targetMinutes > 0 ? Math.round((elapsedMinutes / timer.targetMinutes) * 10_000) : 0;

  return {
    status: breached ? 'breached' : timer.status,
    minutesRemaining,
    breached,
    atRisk: !breached && consumed >= 8000,
    elapsedMinutes,
    percentConsumedBps: consumed,
  };
}

/** Standard support SLA targets by severity and entitlement level. */
export const SUPPORT_SLA_MINUTES: Record<string, Record<number, { firstResponse: number; resolution: number }>> = {
  premier: {
    1: { firstResponse: 15, resolution: 240 },
    2: { firstResponse: 60, resolution: 480 },
    3: { firstResponse: 240, resolution: 2880 },
    4: { firstResponse: 480, resolution: 7200 },
  },
  enterprise: {
    1: { firstResponse: 30, resolution: 480 },
    2: { firstResponse: 120, resolution: 1440 },
    3: { firstResponse: 480, resolution: 4320 },
    4: { firstResponse: 1440, resolution: 10080 },
  },
  standard: {
    1: { firstResponse: 120, resolution: 1440 },
    2: { firstResponse: 480, resolution: 2880 },
    3: { firstResponse: 1440, resolution: 7200 },
    4: { firstResponse: 2880, resolution: 14400 },
  },
};

export function supportSla(
  supportLevel: string | null | undefined,
  severity: number,
): { firstResponse: number; resolution: number } {
  const level = SUPPORT_SLA_MINUTES[supportLevel ?? 'standard'] ?? SUPPORT_SLA_MINUTES.standard;
  return level[Math.min(4, Math.max(1, severity))] ?? level[3];
}

/**
 * Escalation ladder. Each breach raises the level, and severity-1 cases start one
 * level higher because the executive needs to hear about a production outage
 * before it is eight hours old.
 */
export function escalationLevel(input: {
  severity: number;
  breachCount: number;
  reopenCount: number;
  arrCents: number;
  isStrategicAccount: boolean;
}): { level: number; notifyRoles: string[]; executiveVisible: boolean } {
  let level = 0;
  if (input.severity === 1) level += 1;
  level += input.breachCount;
  if (input.reopenCount >= 2) level += 1;
  if (input.isStrategicAccount || input.arrCents >= 25_000_000) level += 1;

  level = Math.min(4, level);

  const ladder: Record<number, string[]> = {
    0: [],
    1: ['support_manager'],
    2: ['support_manager', 'customer_success_manager'],
    3: ['support_director', 'customer_success_manager', 'account_executive'],
    4: ['support_director', 'vp_customer_success', 'cro'],
  };

  return {
    level,
    notifyRoles: ladder[level],
    executiveVisible: level >= 3,
  };
}
