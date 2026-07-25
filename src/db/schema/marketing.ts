import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { auditCols, bps, createdAt, money, pk, ts } from './_helpers';
import {
  attributionModelEnum,
  campaignTypeEnum,
  leadStatusEnum,
  responseTypeEnum,
} from './enums';

export const leads = pgTable(
  'leads',
  {
    id: pk('lead'),
    firstName: text('first_name'),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    company: text('company'),
    title: text('title'),
    website: text('website'),
    country: text('country'),
    state: text('state'),
    region: text('region'),
    industry: text('industry'),
    employeeCount: integer('employee_count'),

    status: leadStatusEnum('status').notNull().default('new'),
    /** form | event | intent | chat | partner | outbound | referral | trial */
    source: text('source').notNull().default('form'),
    sourceDetail: text('source_detail'),
    campaignId: text('campaign_id'),

    // --- scoring: four independent dimensions plus decay and penalties ----
    fitScore: integer('fit_score').notNull().default(0),
    intentScore: integer('intent_score').notNull().default(0),
    engagementScore: integer('engagement_score').notNull().default(0),
    behavioralScore: integer('behavioral_score').notNull().default(0),
    negativeScore: integer('negative_score').notNull().default(0),
    totalScore: integer('total_score').notNull().default(0),
    grade: text('grade'),
    scoreDecayedAt: ts('score_decayed_at'),
    mqlAt: ts('mql_at'),

    // --- routing and SLA --------------------------------------------------
    ownerId: text('owner_id'),
    territoryId: text('territory_id'),
    routingRuleId: text('routing_rule_id'),
    assignedAt: ts('assigned_at'),
    slaMinutes: integer('sla_minutes'),
    slaDueAt: ts('sla_due_at'),
    firstTouchedAt: ts('first_touched_at'),
    slaBreached: boolean('sla_breached').notNull().default(false),
    acceptedAt: ts('accepted_at'),
    rejectedAt: ts('rejected_at'),
    rejectionReason: text('rejection_reason'),
    /** Why the lead stopped progressing: budget, timing, no_fit, competitor... */
    disposition: text('disposition'),
    nurtureReason: text('nurture_reason'),
    sequenceEnrolledAt: ts('sequence_enrolled_at'),
    sequenceName: text('sequence_name'),

    // --- conversion (engagement history survives via campaign_responses) --
    convertedAt: ts('converted_at'),
    convertedContactId: text('converted_contact_id'),
    convertedAccountId: text('converted_account_id'),
    convertedOpportunityId: text('converted_opportunity_id'),
    /** Set when the inbound record matched an existing contact instead. */
    matchedContactId: text('matched_contact_id'),
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    duplicateOfLeadId: text('duplicate_of_lead_id'),

    emailOptIn: boolean('email_opt_in').notNull().default(true),
    privacyRegime: text('privacy_regime').notNull().default('none'),
    description: text('description'),
    ...auditCols,
  },
  (t) => [
    index('leads_status_idx').on(t.status),
    index('leads_owner_idx').on(t.ownerId),
    index('leads_email_idx').on(t.email),
    index('leads_score_idx').on(t.totalScore),
  ],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: pk('cmp'),
    name: text('name').notNull(),
    type: campaignTypeEnum('type').notNull(),
    channel: text('channel'),
    parentCampaignId: text('parent_campaign_id'),
    status: text('status').notNull().default('planned'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    budgetCents: money('budget_cents').notNull().default(0),
    actualCostCents: money('actual_cost_cents').notNull().default(0),
    /** Days after a response during which credit may still be assigned. */
    attributionWindowDays: integer('attribution_window_days').notNull().default(90),
    targetSegment: text('target_segment'),
    targetRegion: text('target_region'),
    ownerId: text('owner_id'),
    isPartnerCampaign: boolean('is_partner_campaign').notNull().default(false),
    partnerAccountId: text('partner_account_id'),
    description: text('description'),
    ...auditCols,
  },
  (t) => [index('cmp_type_idx').on(t.type)],
);

/**
 * Membership is the enrolment record; `campaignResponses` holds the individual
 * interactions. Keeping them apart is what lets engagement history survive a
 * lead conversion — responses point at both the lead and, once converted, the
 * contact, so nothing is orphaned or duplicated.
 */
export const campaignMembers = pgTable(
  'campaign_members',
  {
    id: pk('cmem'),
    campaignId: text('campaign_id').notNull(),
    leadId: text('lead_id'),
    contactId: text('contact_id'),
    accountId: text('account_id'),
    status: text('status').notNull().default('targeted'),
    hasResponded: boolean('has_responded').notNull().default(false),
    firstRespondedAt: ts('first_responded_at'),
    lastRespondedAt: ts('last_responded_at'),
    responseCount: integer('response_count').notNull().default(0),
    ...auditCols,
  },
  (t) => [
    index('cmem_campaign_idx').on(t.campaignId),
    index('cmem_lead_idx').on(t.leadId),
    index('cmem_contact_idx').on(t.contactId),
  ],
);

export const campaignResponses = pgTable(
  'campaign_responses',
  {
    id: pk('crsp'),
    campaignId: text('campaign_id').notNull(),
    campaignMemberId: text('campaign_member_id'),
    leadId: text('lead_id'),
    contactId: text('contact_id'),
    accountId: text('account_id'),
    type: responseTypeEnum('type').notNull(),
    channel: text('channel'),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    /** Scoring weight this interaction contributed. */
    scoreValue: integer('score_value').notNull().default(0),
    detail: text('detail'),
    metadata: jsonb('metadata'),
    createdAt: createdAt(),
  },
  (t) => [
    index('crsp_campaign_idx').on(t.campaignId),
    index('crsp_contact_idx').on(t.contactId),
    index('crsp_lead_idx').on(t.leadId),
    index('crsp_occurred_idx').on(t.occurredAt),
  ],
);

/**
 * Materialised attribution credit. One row per (model, touch, target) so the
 * same journey can be reported first-touch, last-touch, linear, time-decay and
 * W-shaped without recomputation, at contact, account, opportunity and
 * subscription grain.
 */
export const attributionTouches = pgTable(
  'attribution_touches',
  {
    id: pk('attr'),
    model: attributionModelEnum('model').notNull(),
    campaignId: text('campaign_id'),
    campaignResponseId: text('campaign_response_id'),
    /** marketing | bdr | partner | sales | product */
    sourceCategory: text('source_category').notNull().default('marketing'),
    contactId: text('contact_id'),
    accountId: text('account_id'),
    opportunityId: text('opportunity_id'),
    subscriptionId: text('subscription_id'),
    /** contact_created | opportunity_created | revenue */
    creditType: text('credit_type').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    /** Share of the credit for this target, in basis points. Sums to 10000. */
    weightBps: bps('weight_bps').notNull(),
    creditedPipelineCents: money('credited_pipeline_cents').notNull().default(0),
    creditedArrCents: money('credited_arr_cents').notNull().default(0),
    creditedRevenueCents: money('credited_revenue_cents').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('attr_model_idx').on(t.model),
    index('attr_opp_idx').on(t.opportunityId),
    index('attr_campaign_idx').on(t.campaignId),
  ],
);

export const routingRules = pgTable(
  'routing_rules',
  {
    id: pk('rrul'),
    name: text('name').notNull(),
    /** lead | case | renewal | opportunity */
    objectType: text('object_type').notNull().default('lead'),
    /** territory | round_robin | priority | named_account | partner */
    strategy: text('strategy').notNull(),
    priority: integer('priority').notNull().default(100),
    criteria: jsonb('criteria').notNull().default({}),
    /** Candidate assignee pool, evaluated in order for round-robin. */
    assigneeUserIds: jsonb('assignee_user_ids').notNull().default([]),
    assigneeTeamId: text('assignee_team_id'),
    territoryId: text('territory_id'),
    /** Rotating cursor so round-robin survives process restarts. */
    roundRobinCursor: integer('round_robin_cursor').notNull().default(0),
    slaMinutes: integer('sla_minutes').notNull().default(60),
    escalateToUserId: text('escalate_to_user_id'),
    active: boolean('active').notNull().default(true),
    ...auditCols,
  },
  (t) => [index('rrul_object_idx').on(t.objectType, t.priority)],
);
