import type { OpportunityType } from './types';

/**
 * The configured sales process.
 *
 * Stages carry an ordinal, a default probability and objective exit criteria.
 * Criteria are field predicates evaluated against the opportunity and its
 * related records, which is what turns "stage discipline" into something the
 * system can enforce rather than something managers nag about.
 */

export const STAGE_KEYS = [
  'srl',
  'discovery',
  'solution_design',
  'proposal',
  'negotiation',
  'contract',
  'closed_won',
  're_nurture',
  'closed_lost',
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export type ExitCriterion = {
  /** Dot path on the opportunity view: a field, or a related-record count. */
  field: string;
  /** present | truthy | gt | gte | in | count_gte */
  test: 'present' | 'truthy' | 'gt' | 'gte' | 'in' | 'count_gte';
  value?: unknown;
  label: string;
};

export type StageDefinition = {
  key: StageKey;
  ordinal: number;
  label: string;
  /** Displayed as "0 - SRL" etc. to match the configured numbering. */
  displayNumber: number;
  description: string;
  defaultProbabilityBps: number;
  isClosed: boolean;
  isWon: boolean;
  /** Excluded from open-pipeline totals but still an active record. */
  isParked: boolean;
  exitCriteria: ExitCriterion[];
};

export const STAGES: Record<StageKey, StageDefinition> = {
  srl: {
    key: 'srl',
    ordinal: 0,
    displayNumber: 0,
    label: 'SRL',
    description:
      'Sales Ready Lead. Accepted by sales, contact and account identified, first meeting not yet qualified.',
    defaultProbabilityBps: 500,
    isClosed: false,
    isWon: false,
    isParked: false,
    exitCriteria: [
      { field: 'accountId', test: 'present', label: 'Account identified' },
      { field: 'contactRoleCount', test: 'count_gte', value: 1, label: 'At least one contact role' },
      { field: 'nextStep', test: 'present', label: 'Next step recorded' },
    ],
  },
  discovery: {
    key: 'discovery',
    ordinal: 1,
    displayNumber: 1,
    label: 'Discovery',
    description:
      'Pain, current state, decision process and budget authority established with the buying group.',
    defaultProbabilityBps: 1500,
    isClosed: false,
    isWon: false,
    isParked: false,
    exitCriteria: [
      { field: 'description', test: 'present', label: 'Business pain documented' },
      { field: 'contactRoleCount', test: 'count_gte', value: 2, label: 'Two or more stakeholders mapped' },
      { field: 'hasDecisionMaker', test: 'truthy', label: 'Decision maker identified' },
      { field: 'nextMeetingAt', test: 'present', label: 'Next meeting scheduled' },
      { field: 'amountCents', test: 'gt', value: 0, label: 'Indicative value entered' },
    ],
  },
  solution_design: {
    key: 'solution_design',
    ordinal: 2,
    displayNumber: 2,
    label: 'Solution Design',
    description:
      'Products, quantities and technical fit agreed; success criteria and evaluation plan defined.',
    defaultProbabilityBps: 3000,
    isClosed: false,
    isWon: false,
    isParked: false,
    exitCriteria: [
      { field: 'productCount', test: 'count_gte', value: 1, label: 'Products selected' },
      { field: 'arrCents', test: 'gt', value: 0, label: 'ARR quantified' },
      { field: 'hasMutualActionPlan', test: 'truthy', label: 'Mutual action plan started' },
      { field: 'closePlan', test: 'present', label: 'Close plan documented' },
    ],
  },
  proposal: {
    key: 'proposal',
    ordinal: 3,
    displayNumber: 3,
    label: 'Proposal',
    description: 'Approved quote presented to the economic buyer.',
    defaultProbabilityBps: 5000,
    isClosed: false,
    isWon: false,
    isParked: false,
    exitCriteria: [
      { field: 'hasApprovedQuote', test: 'truthy', label: 'Quote approved and presented' },
      { field: 'hasEconomicBuyer', test: 'truthy', label: 'Economic buyer engaged' },
      { field: 'competitors', test: 'present', label: 'Competitive landscape recorded' },
    ],
  },
  negotiation: {
    key: 'negotiation',
    ordinal: 4,
    displayNumber: 4,
    label: 'Negotiation',
    description: 'Commercial and legal terms under negotiation; verbal agreement on scope.',
    defaultProbabilityBps: 7000,
    isClosed: false,
    isWon: false,
    isParked: false,
    exitCriteria: [
      { field: 'hasApprovedQuote', test: 'truthy', label: 'Current quote fully approved' },
      { field: 'closeDate', test: 'present', label: 'Close date committed' },
      { field: 'nextStep', test: 'present', label: 'Next step recorded' },
    ],
  },
  contract: {
    key: 'contract',
    ordinal: 5,
    displayNumber: 5,
    label: 'Contract',
    description: 'Paper out for signature; procurement and legal steps in flight.',
    defaultProbabilityBps: 9000,
    isClosed: false,
    isWon: false,
    isParked: false,
    exitCriteria: [
      { field: 'hasAcceptedQuote', test: 'truthy', label: 'Quote accepted by customer' },
      { field: 'termMonths', test: 'gt', value: 0, label: 'Contract term set' },
    ],
  },
  closed_won: {
    key: 'closed_won',
    ordinal: 6,
    displayNumber: 6,
    label: 'Closed Won',
    description:
      'Signed. Booking, subscription and the next renewal are created automatically on entry.',
    defaultProbabilityBps: 10_000,
    isClosed: true,
    isWon: true,
    isParked: false,
    /**
     * These are entry requirements for the win, not paperwork for its own sake:
     * closing won triggers the booking, the subscription and the renewal, so the
     * commercial terms have to exist before any of that can be generated.
     */
    exitCriteria: [
      { field: 'hasAcceptedQuote', test: 'truthy', label: 'Customer has accepted a quote' },
      { field: 'productCount', test: 'count_gte', value: 1, label: 'Products on the deal' },
      { field: 'arrCents', test: 'gt', value: 0, label: 'ARR is quantified' },
      { field: 'termMonths', test: 'gt', value: 0, label: 'Contract term is set' },
    ],
  },
  re_nurture: {
    key: 're_nurture',
    ordinal: 7,
    displayNumber: 7,
    label: 'Re-Nurture',
    description:
      'No decision now but the need is real. Parked out of pipeline with a recycle date and a reason.',
    defaultProbabilityBps: 0,
    isClosed: false,
    isWon: false,
    isParked: true,
    exitCriteria: [
      { field: 'reNurtureUntil', test: 'present', label: 'Recycle date set' },
      { field: 'lossReason', test: 'present', label: 'Reason for pause recorded' },
    ],
  },
  closed_lost: {
    key: 'closed_lost',
    ordinal: 8,
    displayNumber: 8,
    label: 'Closed Lost',
    description: 'Lost or cancelled. Reason and competitor captured for win/loss analysis.',
    defaultProbabilityBps: 0,
    isClosed: true,
    isWon: false,
    isParked: false,
    exitCriteria: [
      { field: 'lossReason', test: 'present', label: 'Loss reason recorded' },
    ],
  },
};

export const OPEN_STAGES: StageKey[] = STAGE_KEYS.filter(
  (k) => !STAGES[k].isClosed && !STAGES[k].isParked,
);

export const FORECASTABLE_STAGES = OPEN_STAGES;

export function stage(key: StageKey): StageDefinition {
  return STAGES[key];
}

export function stageLabel(key: StageKey): string {
  return `${STAGES[key].displayNumber} - ${STAGES[key].label}`;
}

/**
 * Which stages a deal may move to from here.
 *
 * Forward movement is one step at a time so stages cannot be skipped; any open
 * stage may jump straight to a terminal or parked outcome, and a parked deal can
 * be revived back into discovery.
 */
export function allowedTransitions(from: StageKey, type: OpportunityType): StageKey[] {
  const def = STAGES[from];

  if (from === 'closed_won') return [];
  if (from === 'closed_lost') return ['re_nurture'];
  if (from === 're_nurture') return ['discovery', 'closed_lost'];

  const terminal: StageKey[] = ['closed_won', 're_nurture', 'closed_lost'];

  // Churn opportunities exist to record a loss; they never progress to won.
  if (type === 'churn') return ['closed_lost', 're_nurture'];

  const forward = STAGE_KEYS.filter(
    (k) => STAGES[k].ordinal === def.ordinal + 1 && !STAGES[k].isClosed && !STAGES[k].isParked,
  );
  const backward = STAGE_KEYS.filter(
    (k) =>
      STAGES[k].ordinal < def.ordinal && !STAGES[k].isClosed && !STAGES[k].isParked,
  );

  return [...forward, ...backward, ...terminal].filter((k) => k !== from);
}

/**
 * The shape the gate evaluates. Assembled by the opportunity service from the
 * record plus counts of its related rows.
 */
export type StageGateInput = Record<string, unknown> & {
  contactRoleCount?: number;
  productCount?: number;
  hasDecisionMaker?: boolean;
  hasEconomicBuyer?: boolean;
  hasApprovedQuote?: boolean;
  hasAcceptedQuote?: boolean;
  hasMutualActionPlan?: boolean;
};

export type GateResult = {
  allowed: boolean;
  /** Criteria that are not yet satisfied. */
  failures: { label: string; field: string }[];
  /** True when the transition itself is illegal, which an override cannot fix. */
  illegalTransition: boolean;
};

function testCriterion(input: StageGateInput, c: ExitCriterion): boolean {
  const v = input[c.field];
  switch (c.test) {
    case 'present':
      if (Array.isArray(v)) return v.length > 0;
      return v !== null && v !== undefined && v !== '';
    case 'truthy':
      return Boolean(v);
    case 'gt':
      return typeof v === 'number' && v > Number(c.value);
    case 'gte':
      return typeof v === 'number' && v >= Number(c.value);
    case 'count_gte':
      return typeof v === 'number' && v >= Number(c.value);
    case 'in':
      return Array.isArray(c.value) && (c.value as unknown[]).includes(v);
    default:
      return true;
  }
}

/**
 * Gates a stage change. Exit criteria of the stage being *left* must be met, and
 * entry into a terminal stage must satisfy that stage's own criteria (a loss
 * needs a reason; a pause needs a recycle date).
 */
export function evaluateStageGate(
  from: StageKey,
  to: StageKey,
  type: OpportunityType,
  input: StageGateInput,
): GateResult {
  if (from === to) {
    return { allowed: true, failures: [], illegalTransition: false };
  }

  if (!allowedTransitions(from, type).includes(to)) {
    return {
      allowed: false,
      failures: [
        {
          label: `${stageLabel(from)} cannot move directly to ${stageLabel(to)}`,
          field: 'stage',
        },
      ],
      illegalTransition: true,
    };
  }

  const failures: { label: string; field: string }[] = [];
  const target = STAGES[to];
  const isTerminalOrParked = target.isClosed || target.isParked;

  /**
   * Exit criteria of the stage being left apply only when advancing to another
   * open stage. Recording an outcome is never gated on the previous stage's
   * paperwork — demanding an approved quote before a rep may mark a deal lost
   * only teaches people to log losses inaccurately, which costs more than the
   * missing field. Terminal and parked stages enforce their own criteria instead,
   * and those are the ones that actually protect the booking.
   */
  const advancingWithinPipeline =
    !isTerminalOrParked && target.ordinal > STAGES[from].ordinal;

  if (advancingWithinPipeline) {
    for (const c of STAGES[from].exitCriteria) {
      if (!testCriterion(input, c)) failures.push({ label: c.label, field: c.field });
    }
  }

  if (isTerminalOrParked) {
    for (const c of target.exitCriteria) {
      if (!testCriterion(input, c)) failures.push({ label: c.label, field: c.field });
    }
  }

  return { allowed: failures.length === 0, failures, illegalTransition: false };
}

/** Stage-weighted value used by the computed side of the forecast. */
export function weightedValue(amountCents: number, stageKey: StageKey): number {
  return Math.round((amountCents * STAGES[stageKey].defaultProbabilityBps) / 10_000);
}
