import { describe, expect, it } from 'vitest';
import {
  distributeEvenly,
  matchesCriteria,
  resolveTerritory,
  route,
  territoryOwner,
  type RoutingRule,
  type Territory,
  type TerritoryAssignment,
} from '@/domain/routing';

const ASOF = '2026-07-25';

describe('criteria matching', () => {
  const record = { region: 'EMEA', employeeCount: 500, industry: 'Software', tier: 'enterprise' };

  it('matches scalars by equality', () => {
    expect(matchesCriteria(record, { region: 'EMEA' })).toBe(true);
    expect(matchesCriteria(record, { region: 'NA' })).toBe(false);
  });

  it('matches arrays by membership', () => {
    expect(matchesCriteria(record, { region: ['NA', 'EMEA'] })).toBe(true);
    expect(matchesCriteria(record, { region: ['APAC'] })).toBe(false);
  });

  it('matches numeric ranges', () => {
    expect(matchesCriteria(record, { employeeCount: { gte: 250, lte: 1000 } })).toBe(true);
    expect(matchesCriteria(record, { employeeCount: { gte: 1000 } })).toBe(false);
    expect(matchesCriteria(record, { employeeCount: { gt: 499 } })).toBe(true);
  });

  it('requires every criterion to hold', () => {
    expect(matchesCriteria(record, { region: 'EMEA', industry: 'Software' })).toBe(true);
    expect(matchesCriteria(record, { region: 'EMEA', industry: 'Retail' })).toBe(false);
  });

  it('treats empty criteria as a match', () => {
    expect(matchesCriteria(record, {})).toBe(true);
  });
});

describe('territory resolution', () => {
  const territories: Territory[] = [
    { id: 'terr_emea_ent', name: 'EMEA Enterprise', type: 'geographic', priority: 10, criteria: { region: 'EMEA', tier: 'enterprise' } },
    { id: 'terr_emea', name: 'EMEA All', type: 'geographic', priority: 50, criteria: { region: 'EMEA' } },
    { id: 'terr_na', name: 'North America', type: 'geographic', priority: 50, criteria: { region: 'NA' } },
  ];

  it('picks the highest-priority matching territory', () => {
    expect(resolveTerritory({ region: 'EMEA', tier: 'enterprise' }, territories)?.id).toBe(
      'terr_emea_ent',
    );
    expect(resolveTerritory({ region: 'EMEA', tier: 'smb' }, territories)?.id).toBe('terr_emea');
  });

  it('returns null when nothing matches', () => {
    expect(resolveTerritory({ region: 'LATAM' }, territories)).toBeNull();
  });
});

describe('effective-dated territory ownership', () => {
  const assignments: TerritoryAssignment[] = [
    { territoryId: 'terr_1', userId: 'usr_old', role: 'account_executive', effectiveFrom: '2025-01-01', effectiveTo: '2026-03-31' },
    { territoryId: 'terr_1', userId: 'usr_new', role: 'account_executive', effectiveFrom: '2026-04-01', effectiveTo: null },
  ];

  it('returns the owner in force on the given date', () => {
    expect(territoryOwner('terr_1', 'account_executive', assignments, '2026-02-01')?.userId).toBe(
      'usr_old',
    );
    expect(territoryOwner('terr_1', 'account_executive', assignments, ASOF)?.userId).toBe('usr_new');
  });

  it('returns null outside every assignment window', () => {
    expect(territoryOwner('terr_1', 'account_executive', assignments, '2024-06-01')).toBeNull();
  });

  /** Coverage matters: a lead arriving during leave must not sit unassigned. */
  it('prefers temporary coverage while it is in force', () => {
    const withCoverage: TerritoryAssignment[] = [
      ...assignments,
      {
        territoryId: 'terr_1',
        userId: 'usr_cover',
        role: 'account_executive',
        effectiveFrom: '2026-07-20',
        effectiveTo: '2026-08-10',
        isTemporaryCoverage: true,
        coveringForUserId: 'usr_new',
      },
    ];
    const owner = territoryOwner('terr_1', 'account_executive', withCoverage, ASOF);
    expect(owner?.userId).toBe('usr_cover');
    expect(owner?.isCoverage).toBe(true);
    expect(owner?.coveringForUserId).toBe('usr_new');
  });
});

describe('lead routing', () => {
  const territories: Territory[] = [
    { id: 'terr_emea', name: 'EMEA', type: 'geographic', priority: 10, criteria: { region: 'EMEA' } },
  ];
  const assignments: TerritoryAssignment[] = [
    { territoryId: 'terr_emea', userId: 'usr_emea_ae', role: 'account_executive', effectiveFrom: '2025-01-01', effectiveTo: null },
  ];

  const rules: RoutingRule[] = [
    { id: 'r_named', name: 'Named account', objectType: 'lead', strategy: 'named_account', priority: 10, criteria: {}, assigneeUserIds: [], roundRobinCursor: 0, slaMinutes: 30 },
    { id: 'r_partner', name: 'Partner sourced', objectType: 'lead', strategy: 'partner', priority: 20, criteria: {}, assigneeUserIds: ['usr_channel'], roundRobinCursor: 0, slaMinutes: 120 },
    { id: 'r_terr', name: 'Territory', objectType: 'lead', strategy: 'territory', priority: 30, criteria: { region: 'EMEA' }, assigneeUserIds: [], roundRobinCursor: 0, slaMinutes: 60 },
    { id: 'r_rr', name: 'Round robin', objectType: 'lead', strategy: 'round_robin', priority: 90, criteria: {}, assigneeUserIds: ['usr_a', 'usr_b', 'usr_c'], roundRobinCursor: 0, slaMinutes: 240 },
  ];

  /** A logo already owned must not be split across reps. */
  it('routes to the existing account owner before anything else', () => {
    const decision = route(
      { id: 'lead_1', region: 'EMEA', accountOwnerId: 'usr_incumbent' },
      rules,
      { territories, assignments, asOf: ASOF },
    );
    expect(decision.ownerId).toBe('usr_incumbent');
    expect(decision.ruleId).toBe('r_named');
    expect(decision.slaMinutes).toBe(30);
  });

  it('routes partner-sourced records to the channel team', () => {
    const decision = route(
      { id: 'lead_2', region: 'NA', partnerAccountId: 'acc_partner' },
      rules,
      { territories, assignments, asOf: ASOF },
    );
    expect(decision.ownerId).toBe('usr_channel');
  });

  it('falls through to territory when there is no incumbent', () => {
    const decision = route({ id: 'lead_3', region: 'EMEA' }, rules, {
      territories,
      assignments,
      asOf: ASOF,
    });
    expect(decision.ownerId).toBe('usr_emea_ae');
    expect(decision.territoryId).toBe('terr_emea');
  });

  it('falls through to round robin when no territory matches', () => {
    const decision = route({ id: 'lead_4', region: 'LATAM' }, rules, {
      territories,
      assignments,
      asOf: ASOF,
    });
    expect(decision.ownerId).toBe('usr_a');
    expect(decision.nextCursor).toBe(1);
  });

  it('advances the round robin deterministically', () => {
    const owners = [0, 1, 2, 3, 4].map(
      (cursor) =>
        route({ id: `lead_${cursor}`, region: 'LATAM' }, [{ ...rules[3], roundRobinCursor: cursor }], {
          asOf: ASOF,
        }).ownerId,
    );
    expect(owners).toEqual(['usr_a', 'usr_b', 'usr_c', 'usr_a', 'usr_b']);
  });

  it('skips unavailable assignees', () => {
    const decision = route({ id: 'lead_5', region: 'LATAM' }, [rules[3]], {
      asOf: ASOF,
      unavailableUserIds: ['usr_a'],
    });
    expect(decision.ownerId).toBe('usr_b');
  });

  it('skips an unavailable account owner and routes onward', () => {
    const decision = route(
      { id: 'lead_6', region: 'EMEA', accountOwnerId: 'usr_incumbent' },
      rules,
      { territories, assignments, asOf: ASOF, unavailableUserIds: ['usr_incumbent'] },
    );
    expect(decision.ownerId).toBe('usr_emea_ae');
  });

  it('compresses the SLA for a high-scoring record under priority routing', () => {
    const priorityRule: RoutingRule = {
      id: 'r_prio',
      name: 'Priority',
      objectType: 'lead',
      strategy: 'priority',
      priority: 10,
      criteria: {},
      assigneeUserIds: ['usr_senior', 'usr_junior'],
      roundRobinCursor: 0,
      slaMinutes: 240,
    };

    const hot = route({ id: 'l', totalScore: 92 }, [priorityRule], { asOf: ASOF });
    expect(hot.ownerId).toBe('usr_senior');
    expect(hot.slaMinutes).toBe(60);

    const cold = route({ id: 'l', totalScore: 20 }, [priorityRule], { asOf: ASOF });
    expect(cold.ownerId).toBe('usr_junior');
    expect(cold.slaMinutes).toBe(240);
  });

  it('holds the record in an unassigned queue when nothing matches', () => {
    const decision = route({ id: 'lead_x' }, [], { asOf: ASOF });
    expect(decision.ownerId).toBeNull();
    expect(decision.reason).toContain('unassigned');
  });
});

describe('bulk distribution', () => {
  it('spreads records evenly across the pool', () => {
    const records = [1, 2, 3, 4, 5].map((n) => ({ id: `l_${n}` }));
    const result = distributeEvenly(records, ['a', 'b']);
    expect(result.map((r) => r.ownerId)).toEqual(['a', 'b', 'a', 'b', 'a']);
  });

  it('returns nothing when the pool is empty', () => {
    expect(distributeEvenly([{ id: 'l' }], [])).toEqual([]);
  });
});
