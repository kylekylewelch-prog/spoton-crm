import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { auditCols, bps, createdAt, money, pk, ts } from './_helpers';
import {
  auditActionEnum,
  ownerRoleEnum,
  priorityEnum,
  teamTypeEnum,
  territoryTypeEnum,
} from './enums';

/* ---------------------------------------------------------------- identity */

export const roles = pgTable('roles', {
  id: pk('role'),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  /** Object-level grants: { accounts: ['read','write'], quotes: ['read'] }. */
  permissions: jsonb('permissions').notNull().default({}),
  /** Field-level security: { 'accounts.arr_cents': 'hidden' }. */
  fieldSecurity: jsonb('field_security').notNull().default({}),
  /** Approval authority ceiling in basis points of discount. */
  discountAuthorityBps: bps('discount_authority_bps').notNull().default(0),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: createdAt(),
});

export const teams = pgTable('teams', {
  id: pk('team'),
  name: text('name').notNull(),
  type: teamTypeEnum('type').notNull(),
  parentTeamId: text('parent_team_id'),
  managerId: text('manager_id'),
  region: text('region'),
  segment: text('segment'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: pk('usr'),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    title: text('title'),
    passwordHash: text('password_hash').notNull(),
    roleId: text('role_id').notNull(),
    teamId: text('team_id'),
    managerId: text('manager_id'),
    region: text('region'),
    timezone: text('timezone').notNull().default('UTC'),
    active: boolean('active').notNull().default(true),
    isIntegrationUser: boolean('is_integration_user').notNull().default(false),
    /** Round-robin fairness counter used by the lead routing engine. */
    routingWeight: integer('routing_weight').notNull().default(1),
    lastLoginAt: ts('last_login_at'),
    ...auditCols,
  },
  (t) => [index('users_team_idx').on(t.teamId), index('users_role_idx').on(t.roleId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: pk('sess'),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/* ------------------------------------------------------- coverage & capacity */

export const territories = pgTable('territories', {
  id: pk('terr'),
  name: text('name').notNull(),
  type: territoryTypeEnum('type').notNull(),
  parentTerritoryId: text('parent_territory_id'),
  /** Match rules evaluated by the routing engine, e.g. { region: ['EMEA'] }. */
  criteria: jsonb('criteria').notNull().default({}),
  priority: integer('priority').notNull().default(100),
  active: boolean('active').notNull().default(true),
  ...auditCols,
});

/**
 * Effective-dated coverage. Ownership is never a bare pointer on the record:
 * every assignment carries a date range so historical attainment, quota credit
 * and compensation stay reconstructable after a territory change.
 */
export const territoryAssignments = pgTable(
  'territory_assignments',
  {
    id: pk('tass'),
    territoryId: text('territory_id').notNull(),
    userId: text('user_id').notNull(),
    role: ownerRoleEnum('role').notNull(),
    isTemporaryCoverage: boolean('is_temporary_coverage').notNull().default(false),
    coveringForUserId: text('covering_for_user_id'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    notes: text('notes'),
    ...auditCols,
  },
  (t) => [
    index('tass_territory_idx').on(t.territoryId),
    index('tass_user_idx').on(t.userId),
  ],
);

export const quotas = pgTable(
  'quotas',
  {
    id: pk('quota'),
    userId: text('user_id'),
    teamId: text('team_id'),
    territoryId: text('territory_id'),
    fiscalPeriod: text('fiscal_period').notNull(),
    periodType: text('period_type').notNull().default('quarter'),
    metric: text('metric').notNull().default('new_arr'),
    targetCents: money('target_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    ...auditCols,
  },
  (t) => [index('quotas_period_idx').on(t.fiscalPeriod)],
);

/**
 * Effective-dated ownership history for any record. Written by the ownership
 * service on every owner change so "who owned this when" is answerable.
 */
export const ownershipHistory = pgTable(
  'ownership_history',
  {
    id: pk('own'),
    objectType: text('object_type').notNull(),
    recordId: text('record_id').notNull(),
    role: ownerRoleEnum('role').notNull(),
    userId: text('user_id').notNull(),
    teamId: text('team_id'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('own_record_idx').on(t.objectType, t.recordId)],
);

/* -------------------------------------------------------------- governance */

export const auditLog = pgTable(
  'audit_log',
  {
    id: pk('aud'),
    objectType: text('object_type').notNull(),
    recordId: text('record_id').notNull(),
    action: auditActionEnum('action').notNull(),
    field: text('field'),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    userId: text('user_id'),
    /** 'ui' | 'api' | 'mcp' | 'workflow' | 'integration' | 'seed' */
    source: text('source').notNull().default('ui'),
    /** Free-form explanation — mandatory for overrides and AI-initiated writes. */
    reason: text('reason'),
    metadata: jsonb('metadata'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_record_idx').on(t.objectType, t.recordId),
    index('audit_at_idx').on(t.at),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: pk('ntf'),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    level: priorityEnum('level').notNull().default('medium'),
    link: text('link'),
    channel: text('channel').notNull().default('in_app'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('ntf_user_idx').on(t.userId)],
);

export const fxRates = pgTable(
  'fx_rates',
  {
    id: pk('fx'),
    fromCurrency: text('from_currency').notNull(),
    toCurrency: text('to_currency').notNull().default('USD'),
    rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('fx_unique_idx').on(t.fromCurrency, t.toCurrency, t.effectiveFrom),
  ],
);

/** Stable third-party keys, so integrations never match on name or email. */
export const externalIds = pgTable(
  'external_ids',
  {
    id: pk('ext'),
    objectType: text('object_type').notNull(),
    recordId: text('record_id').notNull(),
    system: text('system').notNull(),
    externalId: text('external_id').notNull(),
    lastSyncedAt: ts('last_synced_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ext_unique_idx').on(t.system, t.objectType, t.externalId),
    index('ext_record_idx').on(t.objectType, t.recordId),
  ],
);
