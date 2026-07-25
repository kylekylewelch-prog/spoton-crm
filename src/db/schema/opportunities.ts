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
  contactRoleEnum,
  forecastCategoryEnum,
  genericStatusEnum,
  lineActionEnum,
  opportunityStageEnum,
  opportunityTypeEnum,
  ownerRoleEnum,
  riskLevelEnum,
  stanceEnum,
} from './enums';

export const opportunities = pgTable(
  'opportunities',
  {
    id: pk('opp'),
    name: text('name').notNull(),
    accountId: text('account_id').notNull(),
    /** The sales process is selected by type — each has its own stage gates. */
    type: opportunityTypeEnum('type').notNull().default('new_logo'),
    stage: opportunityStageEnum('stage').notNull().default('srl'),
    forecastCategory: forecastCategoryEnum('forecast_category').notNull().default('pipeline'),
    probabilityBps: bps('probability_bps').notNull().default(1000),

    // --- amounts. Transaction value and revenue movement are separate: one
    //     expansion deal can simultaneously add ARR, uplift price, and remove
    //     a product, and each component reports differently. ----------------
    currency: text('currency').notNull().default('USD'),
    amountCents: money('amount_cents').notNull().default(0),
    tcvCents: money('tcv_cents').notNull().default(0),
    arrCents: money('arr_cents').notNull().default(0),
    newArrCents: money('new_arr_cents').notNull().default(0),
    expansionArrCents: money('expansion_arr_cents').notNull().default(0),
    upliftArrCents: money('uplift_arr_cents').notNull().default(0),
    contractionArrCents: money('contraction_arr_cents').notNull().default(0),
    churnArrCents: money('churn_arr_cents').notNull().default(0),
    termMonths: integer('term_months').notNull().default(12),

    closeDate: date('close_date').notNull(),
    originalCloseDate: date('original_close_date'),
    /** Incremented every time close date moves out — the slippage counter. */
    pushCount: integer('push_count').notNull().default(0),

    // --- process state ----------------------------------------------------
    stageEnteredAt: ts('stage_entered_at').notNull().defaultNow(),
    nextStep: text('next_step'),
    nextMeetingAt: ts('next_meeting_at'),
    closePlan: text('close_plan'),
    competitors: jsonb('competitors').notNull().default([]),
    incumbentProduct: text('incumbent_product'),
    /** Recorded when a user overrides a blocked stage transition. */
    stageOverrideReason: text('stage_override_reason'),

    isClosed: boolean('is_closed').notNull().default(false),
    isWon: boolean('is_won').notNull().default(false),
    closedAt: ts('closed_at'),
    lossReason: text('loss_reason'),
    lossReasonDetail: text('loss_reason_detail'),
    competitorWonTo: text('competitor_won_to'),
    reNurtureUntil: date('re_nurture_until'),

    // --- ownership --------------------------------------------------------
    ownerId: text('owner_id').notNull(),
    teamId: text('team_id'),
    territoryId: text('territory_id'),

    // --- renewal / subscription linkage -----------------------------------
    /** Set on renewal and mid-term change opportunities. */
    subscriptionId: text('subscription_id'),
    renewalId: text('renewal_id'),
    priorOpportunityId: text('prior_opportunity_id'),
    isRenewal: boolean('is_renewal').notNull().default(false),
    isAutoCreated: boolean('is_auto_created').notNull().default(false),
    expectedRenewalArrCents: money('expected_renewal_arr_cents'),
    renewalRiskLevel: riskLevelEnum('renewal_risk_level'),
    /** True when this deal's term was snapped to an existing subscription. */
    isCoTermed: boolean('is_co_termed').notNull().default(false),
    coTermEndDate: date('co_term_end_date'),

    // --- attribution ------------------------------------------------------
    createdSource: text('created_source'),
    originalSource: text('original_source'),
    latestSource: text('latest_source'),
    primaryCampaignId: text('primary_campaign_id'),
    partnerAccountId: text('partner_account_id'),
    dealRegistrationId: text('deal_registration_id'),
    /** direct | partner_sourced | partner_influenced */
    channelMotion: text('channel_motion').notNull().default('direct'),

    description: text('description'),
    ...auditCols,
  },
  (t) => [
    index('opp_account_idx').on(t.accountId),
    index('opp_stage_idx').on(t.stage),
    index('opp_owner_idx').on(t.ownerId),
    index('opp_close_idx').on(t.closeDate),
    index('opp_sub_idx').on(t.subscriptionId),
  ],
);

export const opportunityProducts = pgTable(
  'opportunity_products',
  {
    id: pk('oppp'),
    opportunityId: text('opportunity_id').notNull(),
    productId: text('product_id').notNull(),
    action: lineActionEnum('action').notNull().default('add'),
    quantity: integer('quantity').notNull().default(1),
    listUnitCents: money('list_unit_cents').notNull().default(0),
    netUnitCents: money('net_unit_cents').notNull().default(0),
    discountBps: bps('discount_bps').notNull().default(0),
    termMonths: integer('term_months').notNull().default(12),
    startDate: date('start_date'),
    endDate: date('end_date'),
    arrCents: money('arr_cents').notNull().default(0),
    tcvCents: money('tcv_cents').notNull().default(0),
    /** Multi-year ramps: [{ year: 1, quantity: 50, netUnitCents: 12000 }, ...] */
    rampSchedule: jsonb('ramp_schedule'),
    /** The subscription item this line replaces, for change transactions. */
    replacesSubscriptionItemId: text('replaces_subscription_item_id'),
    ...auditCols,
  },
  (t) => [index('oppp_opp_idx').on(t.opportunityId)],
);

export const opportunityContactRoles = pgTable(
  'opportunity_contact_roles',
  {
    id: pk('ocr'),
    opportunityId: text('opportunity_id').notNull(),
    contactId: text('contact_id').notNull(),
    role: contactRoleEnum('role').notNull(),
    stance: stanceEnum('stance').notNull().default('neutral'),
    isPrimary: boolean('is_primary').notNull().default(false),
    influenceLevel: integer('influence_level').notNull().default(3),
    ...auditCols,
  },
  (t) => [index('ocr_opp_idx').on(t.opportunityId)],
);

export const opportunityTeam = pgTable(
  'opportunity_team',
  {
    id: pk('otm'),
    opportunityId: text('opportunity_id').notNull(),
    userId: text('user_id').notNull(),
    role: ownerRoleEnum('role').notNull(),
    /** Revenue split in basis points; validated to total 10000 per opportunity. */
    splitBps: bps('split_bps').notNull().default(0),
    /** overlay | primary | support */
    creditType: text('credit_type').notNull().default('primary'),
    ...auditCols,
  },
  (t) => [index('otm_opp_idx').on(t.opportunityId)],
);

export const mutualActionPlans = pgTable(
  'mutual_action_plans',
  {
    id: pk('map'),
    opportunityId: text('opportunity_id').notNull(),
    name: text('name').notNull(),
    status: genericStatusEnum('status').notNull().default('in_progress'),
    targetGoLiveDate: date('target_go_live_date'),
    sharedWithCustomerAt: ts('shared_with_customer_at'),
    ...auditCols,
  },
  (t) => [index('map_opp_idx').on(t.opportunityId)],
);

export const mutualActionPlanItems = pgTable(
  'mutual_action_plan_items',
  {
    id: pk('mapi'),
    planId: text('plan_id').notNull(),
    sequence: integer('sequence').notNull().default(0),
    name: text('name').notNull(),
    /** vendor | customer */
    ownerSide: text('owner_side').notNull().default('vendor'),
    ownerUserId: text('owner_user_id'),
    ownerContactId: text('owner_contact_id'),
    dueDate: date('due_date'),
    completedAt: ts('completed_at'),
    status: genericStatusEnum('status').notNull().default('not_started'),
    isBlocker: boolean('is_blocker').notNull().default(false),
    ...auditCols,
  },
  (t) => [index('mapi_plan_idx').on(t.planId)],
);

/** Immutable stage transition ledger — the basis of velocity and conversion. */
export const stageHistory = pgTable(
  'stage_history',
  {
    id: pk('sthx'),
    opportunityId: text('opportunity_id').notNull(),
    fromStage: opportunityStageEnum('from_stage'),
    toStage: opportunityStageEnum('to_stage').notNull(),
    enteredAt: ts('entered_at').notNull().defaultNow(),
    exitedAt: ts('exited_at'),
    durationDays: integer('duration_days'),
    amountAtTransitionCents: money('amount_at_transition_cents'),
    closeDateAtTransition: date('close_date_at_transition'),
    userId: text('user_id'),
    wasOverridden: boolean('was_overridden').notNull().default(false),
    overrideReason: text('override_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('sthx_opp_idx').on(t.opportunityId)],
);
