import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { auditCols, createdAt, money, pk, ts } from './_helpers';
import {
  caseStatusEnum,
  caseTypeEnum,
  priorityEnum,
  sentimentEnum,
} from './enums';

/**
 * Service tickets. Support data is first-class here rather than a linked
 * afterthought: severity, SLA state, escalation and defect linkage all feed the
 * health model, renewal risk and opportunity inspection.
 */
export const cases = pgTable(
  'cases',
  {
    id: pk('case'),
    number: text('number').notNull().unique(),
    accountId: text('account_id').notNull(),
    contactId: text('contact_id'),
    subscriptionId: text('subscription_id'),
    productId: text('product_id'),
    productInstanceId: text('product_instance_id'),
    opportunityId: text('opportunity_id'),

    subject: text('subject').notNull(),
    description: text('description'),
    type: caseTypeEnum('type').notNull().default('question'),
    status: caseStatusEnum('status').notNull().default('new'),
    /** 1 = production down, 4 = cosmetic. */
    severity: integer('severity').notNull().default(3),
    priority: priorityEnum('priority').notNull().default('medium'),
    /** email | portal | phone | chat | api | in_app */
    channel: text('channel').notNull().default('portal'),

    ownerId: text('owner_id'),
    teamId: text('team_id'),

    openedAt: ts('opened_at').notNull().defaultNow(),
    firstResponseAt: ts('first_response_at'),
    resolvedAt: ts('resolved_at'),
    closedAt: ts('closed_at'),
    reopenCount: integer('reopen_count').notNull().default(0),

    /** SLA targets resolved from the account's support entitlement. */
    entitlementId: text('entitlement_id'),
    entitlementVerified: boolean('entitlement_verified').notNull().default(false),
    supportLevel: text('support_level'),
    slaFirstResponseDueAt: ts('sla_first_response_due_at'),
    slaResolutionDueAt: ts('sla_resolution_due_at'),
    slaFirstResponseBreached: boolean('sla_first_response_breached')
      .notNull()
      .default(false),
    slaResolutionBreached: boolean('sla_resolution_breached').notNull().default(false),
    timeToFirstResponseMinutes: integer('time_to_first_response_minutes'),
    timeToResolutionMinutes: integer('time_to_resolution_minutes'),

    isEscalated: boolean('is_escalated').notNull().default(false),
    escalationLevel: integer('escalation_level').notNull().default(0),
    escalatedToUserId: text('escalated_to_user_id'),
    escalatedAt: ts('escalated_at'),
    executiveVisible: boolean('executive_visible').notNull().default(false),

    defectId: text('defect_id'),
    /** Professional-services work outstanding, tracked for renewal readiness. */
    isProfessionalServices: boolean('is_professional_services').notNull().default(false),
    servicesHoursRemaining: integer('services_hours_remaining'),

    sentiment: sentimentEnum('sentiment'),
    csatScore: integer('csat_score'),
    resolutionSummary: text('resolution_summary'),
    tags: jsonb('tags').notNull().default([]),
    ...auditCols,
  },
  (t) => [
    index('case_account_idx').on(t.accountId),
    index('case_status_idx').on(t.status),
    index('case_owner_idx').on(t.ownerId),
    index('case_opened_idx').on(t.openedAt),
    index('case_severity_idx').on(t.severity),
  ],
);

export const caseComments = pgTable(
  'case_comments',
  {
    id: pk('ccmt'),
    caseId: text('case_id').notNull(),
    authorUserId: text('author_user_id'),
    authorContactId: text('author_contact_id'),
    body: text('body').notNull(),
    /** Internal notes are excluded from customer-visible timelines. */
    isPublic: boolean('is_public').notNull().default(true),
    isFirstResponse: boolean('is_first_response').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('ccmt_case_idx').on(t.caseId)],
);

export const productDefects = pgTable(
  'product_defects',
  {
    id: pk('dfct'),
    key: text('key').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),
    productId: text('product_id'),
    severity: integer('severity').notNull().default(3),
    status: text('status').notNull().default('open'),
    /** Known limitation vs. bug — both matter in a renewal conversation. */
    isKnownLimitation: boolean('is_known_limitation').notNull().default(false),
    affectedVersions: jsonb('affected_versions').notNull().default([]),
    resolvedInVersion: text('resolved_in_version'),
    targetFixDate: date('target_fix_date'),
    resolvedAt: ts('resolved_at'),
    linkedCaseCount: integer('linked_case_count').notNull().default(0),
    arrImpactedCents: money('arr_impacted_cents').notNull().default(0),
    externalIssueKey: text('external_issue_key'),
    ...auditCols,
  },
  (t) => [index('dfct_product_idx').on(t.productId)],
);
