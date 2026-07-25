import { addDays, type IsoDate } from './dates';
import { matchesCriteria } from './routing';

/**
 * The workflow engine.
 *
 * Design rules enforced by the types below: every definition has an owner, entry
 * criteria, an exception queue and a bounded retry policy. A run that fails its
 * final attempt lands in the dead-letter state rather than disappearing, and every
 * run carries a step log so its behaviour is explainable after the fact.
 */

export type WorkflowActionType =
  | 'create_task'
  | 'update_field'
  | 'create_record'
  | 'send_notification'
  | 'send_email'
  | 'post_chat_message'
  | 'start_sla_timer'
  | 'request_approval'
  | 'run_playbook'
  | 'emit_integration_event'
  | 'create_ai_insight';

export type WorkflowAction = {
  type: WorkflowActionType;
  /** Action-specific configuration, validated by the executor. */
  config: Record<string, unknown>;
  /** Optional per-action guard, evaluated against the record. */
  when?: Record<string, unknown>;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  objectType: string;
  trigger: 'on_create' | 'on_update' | 'on_field_change' | 'scheduled' | 'time_based' | 'manual';
  watchField?: string | null;
  entryCriteria: Record<string, unknown>;
  exitCriteria: Record<string, unknown>;
  actions: WorkflowAction[];
  offsetDays?: number | null;
  offsetFromField?: string | null;
  slaMinutes?: number | null;
  ownerUserId: string;
  maxAttempts: number;
  exceptionQueue: string;
  active: boolean;
};

export type TriggerEvent = {
  objectType: string;
  recordId: string;
  kind: 'create' | 'update' | 'scheduled' | 'manual';
  record: Record<string, unknown>;
  /** Previous values for changed fields, present on updates. */
  previous?: Record<string, unknown>;
  changedFields?: string[];
};

/**
 * Selects the definitions that should fire for an event.
 *
 * Exit criteria are checked as a suppression gate: if the record already satisfies
 * the end state the workflow exists to produce, the run is skipped. That is what
 * stops a "chase the missing next step" workflow from firing on records that have
 * one.
 */
export function selectWorkflows(
  definitions: WorkflowDefinition[],
  event: TriggerEvent,
): WorkflowDefinition[] {
  return definitions.filter((d) => {
    if (!d.active) return false;
    if (d.objectType !== event.objectType) return false;

    switch (d.trigger) {
      case 'on_create':
        if (event.kind !== 'create') return false;
        break;
      case 'on_update':
        if (event.kind !== 'update') return false;
        break;
      case 'on_field_change':
        if (event.kind !== 'update') return false;
        if (!d.watchField) return false;
        if (!event.changedFields?.includes(d.watchField)) return false;
        break;
      case 'scheduled':
      case 'time_based':
        if (event.kind !== 'scheduled') return false;
        break;
      case 'manual':
        if (event.kind !== 'manual') return false;
        break;
    }

    if (!matchesCriteria(event.record, d.entryCriteria)) return false;

    // Already in the desired end state — nothing to do.
    if (
      Object.keys(d.exitCriteria).length > 0 &&
      matchesCriteria(event.record, d.exitCriteria)
    ) {
      return false;
    }

    return true;
  });
}

/** When a time-based workflow should run, relative to a date on the record. */
export function scheduledFor(
  definition: WorkflowDefinition,
  record: Record<string, unknown>,
): IsoDate | null {
  if (!definition.offsetFromField || definition.offsetDays == null) return null;
  const base = record[definition.offsetFromField];
  if (typeof base !== 'string' || base.length < 10) return null;
  return addDays(base.slice(0, 10), definition.offsetDays);
}

export type ActionResult = {
  action: WorkflowActionType;
  status: 'succeeded' | 'skipped' | 'failed';
  detail: string;
  /** Ids of records the action created, for the run log. */
  createdIds?: string[];
  error?: string;
};

export type RunOutcome = {
  status: 'succeeded' | 'failed' | 'retrying' | 'dead_letter' | 'skipped';
  attempts: number;
  results: ActionResult[];
  nextRetryAt: Date | null;
  error: string | null;
};

/**
 * Exponential backoff with a cap: 1, 2, 4, 8... minutes up to an hour. A run that
 * exhausts `maxAttempts` becomes dead-letter, which the integration monitor
 * surfaces as an exception queue item for a human.
 */
export function nextRetry(attempt: number, now: Date = new Date()): Date {
  const minutes = Math.min(60, Math.pow(2, Math.max(0, attempt - 1)));
  return new Date(now.getTime() + minutes * 60_000);
}

export function classifyRun(
  results: ActionResult[],
  attempts: number,
  maxAttempts: number,
  now: Date = new Date(),
): RunOutcome {
  const failed = results.filter((r) => r.status === 'failed');

  if (failed.length === 0) {
    return {
      status: results.length === 0 ? 'skipped' : 'succeeded',
      attempts,
      results,
      nextRetryAt: null,
      error: null,
    };
  }

  const error = failed.map((f) => `${f.action}: ${f.error ?? f.detail}`).join('; ');

  if (attempts >= maxAttempts) {
    return { status: 'dead_letter', attempts, results, nextRetryAt: null, error };
  }
  return { status: 'retrying', attempts, results, nextRetryAt: nextRetry(attempts, now), error };
}

/** Whether a single action should run, given its own guard. */
export function shouldRunAction(
  action: WorkflowAction,
  record: Record<string, unknown>,
): boolean {
  if (!action.when) return true;
  return matchesCriteria(record, action.when);
}

/**
 * Resolves `{{field}}` placeholders in action config against the record, so
 * definitions stay data rather than code.
 */
export function interpolate(
  template: string,
  record: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = record[key];
    return v === null || v === undefined ? '' : String(v);
  });
}

export function interpolateConfig(
  config: Record<string, unknown>,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = typeof v === 'string' ? interpolate(v, record) : v;
  }
  return out;
}
