import { type IsoDate } from './dates';

/**
 * Assignment and SLA routing.
 *
 * Routing is rule-driven and deterministic: given the same rules, the same record
 * and the same cursor, the same person is always assigned. That matters for
 * testing, for disputes about who owned a lead, and for the round-robin actually
 * being fair rather than approximately fair.
 */

export type RoutingRule = {
  id: string;
  name: string;
  objectType: string;
  strategy: 'territory' | 'round_robin' | 'priority' | 'named_account' | 'partner';
  priority: number;
  criteria: Record<string, unknown>;
  assigneeUserIds: string[];
  assigneeTeamId?: string | null;
  territoryId?: string | null;
  roundRobinCursor: number;
  slaMinutes: number;
  escalateToUserId?: string | null;
  active?: boolean;
};

export type RoutableRecord = Record<string, unknown> & {
  id: string;
  /** Set when the record already resolves to an owned account. */
  accountOwnerId?: string | null;
  partnerAccountId?: string | null;
  totalScore?: number;
};

export type Territory = {
  id: string;
  name: string;
  type: string;
  criteria: Record<string, unknown>;
  priority: number;
  active?: boolean;
};

export type TerritoryAssignment = {
  territoryId: string;
  userId: string;
  role: string;
  effectiveFrom: IsoDate;
  effectiveTo?: IsoDate | null;
  isTemporaryCoverage?: boolean;
  coveringForUserId?: string | null;
};

/**
 * Matches a criteria object against a record. A criterion value may be a scalar
 * (equality), an array (membership), or a `{ gte, lte }` range.
 */
export function matchesCriteria(
  record: Record<string, unknown>,
  criteria: Record<string, unknown>,
): boolean {
  for (const [field, expected] of Object.entries(criteria)) {
    const actual = record[field];

    if (Array.isArray(expected)) {
      if (!expected.includes(actual as never)) return false;
      continue;
    }
    if (expected && typeof expected === 'object') {
      const range = expected as { gte?: number; lte?: number; gt?: number; lt?: number };
      const n = Number(actual);
      if (Number.isNaN(n)) return false;
      if (range.gte !== undefined && !(n >= range.gte)) return false;
      if (range.gt !== undefined && !(n > range.gt)) return false;
      if (range.lte !== undefined && !(n <= range.lte)) return false;
      if (range.lt !== undefined && !(n < range.lt)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

/** Highest-priority active territory whose criteria match. */
export function resolveTerritory(
  record: Record<string, unknown>,
  territories: Territory[],
): Territory | null {
  const matched = territories
    .filter((t) => t.active !== false && matchesCriteria(record, t.criteria))
    .sort((a, b) => a.priority - b.priority);
  return matched[0] ?? null;
}

/**
 * Current owner of a territory for a role, honouring effective dates and
 * temporary coverage. Coverage wins while it is in force, which is what makes
 * holiday and leave handling correct rather than a manual reassignment exercise.
 */
export function territoryOwner(
  territoryId: string,
  role: string,
  assignments: TerritoryAssignment[],
  asOf: IsoDate,
): { userId: string; isCoverage: boolean; coveringForUserId: string | null } | null {
  const active = assignments.filter(
    (a) =>
      a.territoryId === territoryId &&
      a.role === role &&
      a.effectiveFrom <= asOf &&
      (!a.effectiveTo || a.effectiveTo >= asOf),
  );
  if (active.length === 0) return null;

  const coverage = active.find((a) => a.isTemporaryCoverage);
  const chosen = coverage ?? active[0];
  return {
    userId: chosen.userId,
    isCoverage: Boolean(chosen.isTemporaryCoverage),
    coveringForUserId: chosen.coveringForUserId ?? null,
  };
}

export type RoutingDecision = {
  ownerId: string | null;
  ruleId: string | null;
  ruleName: string | null;
  territoryId: string | null;
  slaMinutes: number;
  /** Updated cursor to persist back onto the rule. */
  nextCursor: number | null;
  reason: string;
  escalateToUserId: string | null;
};

/**
 * Routes a record.
 *
 * Rules are evaluated in priority order and the first match wins. Named-account
 * routing takes precedence over everything else by convention — if an account
 * already has an owner, a new lead on that logo goes to them rather than into the
 * round-robin, because splitting a logo across reps is how deals get lost.
 */
export function route(
  record: RoutableRecord,
  rules: RoutingRule[],
  ctx: {
    territories?: Territory[];
    assignments?: TerritoryAssignment[];
    asOf: IsoDate;
    /** Users unavailable right now (inactive, at capacity, on leave). */
    unavailableUserIds?: string[];
  },
): RoutingDecision {
  const unavailable = new Set(ctx.unavailableUserIds ?? []);
  const applicable = rules
    .filter((r) => r.active !== false && matchesCriteria(record, r.criteria))
    .sort((a, b) => a.priority - b.priority);

  for (const rule of applicable) {
    switch (rule.strategy) {
      case 'named_account': {
        if (record.accountOwnerId && !unavailable.has(record.accountOwnerId)) {
          return {
            ownerId: record.accountOwnerId,
            ruleId: rule.id,
            ruleName: rule.name,
            territoryId: null,
            slaMinutes: rule.slaMinutes,
            nextCursor: null,
            reason: 'Account already owned — routed to the existing account owner',
            escalateToUserId: rule.escalateToUserId ?? null,
          };
        }
        break;
      }

      case 'partner': {
        if (record.partnerAccountId) {
          const candidate = rule.assigneeUserIds.find((u) => !unavailable.has(u));
          if (candidate) {
            return {
              ownerId: candidate,
              ruleId: rule.id,
              ruleName: rule.name,
              territoryId: null,
              slaMinutes: rule.slaMinutes,
              nextCursor: null,
              reason: 'Partner-sourced record routed to the channel team',
              escalateToUserId: rule.escalateToUserId ?? null,
            };
          }
        }
        break;
      }

      case 'territory': {
        const territory =
          rule.territoryId
            ? (ctx.territories ?? []).find((t) => t.id === rule.territoryId) ?? null
            : resolveTerritory(record, ctx.territories ?? []);
        if (territory) {
          const owner = territoryOwner(
            territory.id,
            'account_executive',
            ctx.assignments ?? [],
            ctx.asOf,
          );
          if (owner && !unavailable.has(owner.userId)) {
            return {
              ownerId: owner.userId,
              ruleId: rule.id,
              ruleName: rule.name,
              territoryId: territory.id,
              slaMinutes: rule.slaMinutes,
              nextCursor: null,
              reason: owner.isCoverage
                ? `Territory ${territory.name} — temporary coverage in effect`
                : `Matched territory ${territory.name}`,
              escalateToUserId: rule.escalateToUserId ?? null,
            };
          }
        }
        break;
      }

      case 'priority': {
        // Highest-scoring records go to the first (most senior) available rep.
        const pool = rule.assigneeUserIds.filter((u) => !unavailable.has(u));
        if (pool.length > 0) {
          const isHighPriority = (record.totalScore ?? 0) >= 80;
          const ownerId = isHighPriority ? pool[0] : pool[pool.length - 1];
          return {
            ownerId,
            ruleId: rule.id,
            ruleName: rule.name,
            territoryId: null,
            slaMinutes: isHighPriority
              ? Math.max(5, Math.round(rule.slaMinutes / 4))
              : rule.slaMinutes,
            nextCursor: null,
            reason: isHighPriority
              ? 'High-scoring record fast-tracked with a compressed SLA'
              : 'Standard priority routing',
            escalateToUserId: rule.escalateToUserId ?? null,
          };
        }
        break;
      }

      case 'round_robin': {
        const pool = rule.assigneeUserIds.filter((u) => !unavailable.has(u));
        if (pool.length > 0) {
          const idx = rule.roundRobinCursor % pool.length;
          return {
            ownerId: pool[idx],
            ruleId: rule.id,
            ruleName: rule.name,
            territoryId: null,
            slaMinutes: rule.slaMinutes,
            nextCursor: rule.roundRobinCursor + 1,
            reason: `Round-robin position ${idx + 1} of ${pool.length}`,
            escalateToUserId: rule.escalateToUserId ?? null,
          };
        }
        break;
      }
    }
  }

  return {
    ownerId: null,
    ruleId: null,
    ruleName: null,
    territoryId: null,
    slaMinutes: 60,
    nextCursor: null,
    reason: 'No routing rule matched — held in the unassigned queue',
    escalateToUserId: null,
  };
}

/**
 * Balances a set of records across a pool in one pass, keeping the distribution
 * even. Used for bulk imports where routing one at a time would let ordering
 * skew the split.
 */
export function distributeEvenly<T extends { id: string }>(
  records: T[],
  userIds: string[],
  startCursor = 0,
): { record: T; ownerId: string }[] {
  if (userIds.length === 0) return [];
  return records.map((record, i) => ({
    record,
    ownerId: userIds[(startCursor + i) % userIds.length],
  }));
}
