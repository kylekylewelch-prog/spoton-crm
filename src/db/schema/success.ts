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
  genericStatusEnum,
  healthBandEnum,
  lifecycleStageEnum,
  priorityEnum,
  riskLevelEnum,
  runStatusEnum,
  sentimentEnum,
  usageSignalTypeEnum,
} from './enums';

export const successPlans = pgTable(
  'success_plans',
  {
    id: pk('splan'),
    accountId: text('account_id').notNull(),
    subscriptionId: text('subscription_id'),
    name: text('name').notNull(),
    status: genericStatusEnum('status').notNull().default('in_progress'),
    lifecycleStage: lifecycleStageEnum('lifecycle_stage').notNull().default('onboarding'),
    csmId: text('csm_id'),
    executiveSponsorContactId: text('executive_sponsor_contact_id'),
    ourExecutiveSponsorId: text('our_executive_sponsor_id'),
    startDate: date('start_date'),
    targetGoLiveDate: date('target_go_live_date'),
    actualGoLiveDate: date('actual_go_live_date'),
    /** Days from contract start to first realised value. */
    timeToValueDays: integer('time_to_value_days'),
    onboardingProgressBps: bps('onboarding_progress_bps').notNull().default(0),
    sentiment: sentimentEnum('sentiment').notNull().default('neutral'),
    /** none | willing | referenceable | public_advocate */
    referenceStatus: text('reference_status').notNull().default('none'),
    renewalReadinessBps: bps('renewal_readiness_bps'),
    lastReviewedAt: ts('last_reviewed_at'),
    nextReviewAt: ts('next_review_at'),
    notes: text('notes'),
    ...auditCols,
  },
  (t) => [index('splan_account_idx').on(t.accountId)],
);

export const successPlanObjectives = pgTable(
  'success_plan_objectives',
  {
    id: pk('sobj'),
    planId: text('plan_id').notNull(),
    name: text('name').notNull(),
    desiredOutcome: text('desired_outcome'),
    /** The customer's own success metric, in their words. */
    metric: text('metric'),
    targetValue: text('target_value'),
    currentValue: text('current_value'),
    status: genericStatusEnum('status').notNull().default('not_started'),
    dueDate: date('due_date'),
    completedAt: ts('completed_at'),
    linkedProductId: text('linked_product_id'),
    ...auditCols,
  },
  (t) => [index('sobj_plan_idx').on(t.planId)],
);

export const successPlanMilestones = pgTable(
  'success_plan_milestones',
  {
    id: pk('smil'),
    planId: text('plan_id').notNull(),
    objectiveId: text('objective_id'),
    name: text('name').notNull(),
    /** kickoff | configuration | integration | training | go_live | adoption */
    phase: text('phase'),
    sequence: integer('sequence').notNull().default(0),
    dueDate: date('due_date'),
    completedAt: ts('completed_at'),
    status: genericStatusEnum('status').notNull().default('not_started'),
    ownerId: text('owner_id'),
    isValueMilestone: boolean('is_value_milestone').notNull().default(false),
    ...auditCols,
  },
  (t) => [index('smil_plan_idx').on(t.planId)],
);

export const playbooks = pgTable(
  'playbooks',
  {
    id: pk('pbook'),
    name: text('name').notNull(),
    /** renewal | risk | onboarding | expansion | save | escalation */
    type: text('type').notNull(),
    description: text('description'),
    /** Entry criteria evaluated against the target record. */
    trigger: jsonb('trigger').notNull().default({}),
    /** Ordered steps: [{ name, ownerRole, offsetDays, type }]. */
    steps: jsonb('steps').notNull().default([]),
    active: boolean('active').notNull().default(true),
    ownerId: text('owner_id'),
    ...auditCols,
  },
  (t) => [index('pbook_type_idx').on(t.type)],
);

export const playbookRuns = pgTable(
  'playbook_runs',
  {
    id: pk('prun'),
    playbookId: text('playbook_id').notNull(),
    objectType: text('object_type').notNull(),
    recordId: text('record_id').notNull(),
    accountId: text('account_id'),
    status: runStatusEnum('status').notNull().default('running'),
    startedAt: ts('started_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
    ownerId: text('owner_id'),
    stepsTotal: integer('steps_total').notNull().default(0),
    stepsCompleted: integer('steps_completed').notNull().default(0),
    outcome: text('outcome'),
    ...auditCols,
  },
  (t) => [index('prun_record_idx').on(t.objectType, t.recordId)],
);

export const risks = pgTable(
  'risks',
  {
    id: pk('risk'),
    accountId: text('account_id').notNull(),
    subscriptionId: text('subscription_id'),
    renewalId: text('renewal_id'),
    opportunityId: text('opportunity_id'),
    /** adoption | champion_loss | budget | competitive | support | technical |
     *  executive_disengagement | consolidation | m_and_a | pricing */
    type: text('type').notNull(),
    severity: riskLevelEnum('severity').notNull().default('medium'),
    status: text('status').notNull().default('open'),
    title: text('title').notNull(),
    description: text('description'),
    mitigationPlan: text('mitigation_plan'),
    savePlayId: text('save_play_id'),
    arrAtRiskCents: money('arr_at_risk_cents').notNull().default(0),
    ownerId: text('owner_id'),
    identifiedAt: ts('identified_at').notNull().defaultNow(),
    dueDate: date('due_date'),
    resolvedAt: ts('resolved_at'),
    resolution: text('resolution'),
    escalatedToUserId: text('escalated_to_user_id'),
    escalatedAt: ts('escalated_at'),
    /** manual | health_model | usage_signal | support_trend | ai */
    detectedBy: text('detected_by').notNull().default('manual'),
    ...auditCols,
  },
  (t) => [
    index('risk_account_idx').on(t.accountId),
    index('risk_status_idx').on(t.status),
  ],
);

export const callsToAction = pgTable(
  'calls_to_action',
  {
    id: pk('cta'),
    accountId: text('account_id'),
    subscriptionId: text('subscription_id'),
    renewalId: text('renewal_id'),
    riskId: text('risk_id'),
    playbookRunId: text('playbook_run_id'),
    /** risk | expansion | adoption | onboarding | renewal | advocacy */
    type: text('type').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: genericStatusEnum('status').notNull().default('not_started'),
    priority: priorityEnum('priority').notNull().default('medium'),
    dueDate: date('due_date'),
    completedAt: ts('completed_at'),
    ownerId: text('owner_id'),
    ...auditCols,
  },
  (t) => [
    index('cta_account_idx').on(t.accountId),
    index('cta_owner_idx').on(t.ownerId),
  ],
);

export const businessReviews = pgTable(
  'business_reviews',
  {
    id: pk('brev'),
    accountId: text('account_id').notNull(),
    successPlanId: text('success_plan_id'),
    /** QBR | EBR | technical_review | roadmap_review */
    type: text('type').notNull().default('QBR'),
    status: text('status').notNull().default('scheduled'),
    scheduledAt: ts('scheduled_at'),
    heldAt: ts('held_at'),
    attendeeContactIds: jsonb('attendee_contact_ids').notNull().default([]),
    attendeeUserIds: jsonb('attendee_user_ids').notNull().default([]),
    executiveAttended: boolean('executive_attended').notNull().default(false),
    outcomes: text('outcomes'),
    sentiment: sentimentEnum('sentiment'),
    deckUrl: text('deck_url'),
    ...auditCols,
  },
  (t) => [index('brev_account_idx').on(t.accountId)],
);

/* -------------------------------------------------------------- health scoring */

export const healthModels = pgTable(
  'health_models',
  {
    id: pk('hmod'),
    name: text('name').notNull(),
    /** Which population this model applies to. */
    segment: text('segment'),
    tier: text('tier'),
    lifecycleStage: text('lifecycle_stage'),
    /**
     * Dimension weights in basis points, summing to 10000:
     * { usage, adoption, utilisation, support, payment, sentiment,
     *   engagement, implementation, contract }
     */
    weights: jsonb('weights').notNull().default({}),
    /** Band cut-offs: { excellent: 85, good: 70, fair: 55, poor: 40 }. */
    thresholds: jsonb('thresholds').notNull().default({}),
    active: boolean('active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    ...auditCols,
  },
  (t) => [index('hmod_segment_idx').on(t.segment)],
);

export const healthScores = pgTable(
  'health_scores',
  {
    id: pk('hsc'),
    accountId: text('account_id').notNull(),
    modelId: text('model_id').notNull(),
    asOfDate: date('as_of_date').notNull(),
    overall: integer('overall').notNull(),
    band: healthBandEnum('band').notNull(),
    /** 0-10000 bps: how much input data was actually available. */
    confidenceBps: bps('confidence_bps').notNull().default(10000),
    previousOverall: integer('previous_overall'),
    delta: integer('delta').notNull().default(0),
    /** Per-dimension scores, so health is explainable not just a number. */
    dimensions: jsonb('dimensions').notNull().default({}),
    /** Ranked drivers of the change: [{ dimension, delta, detail }]. */
    reasons: jsonb('reasons').notNull().default([]),
    recommendedAction: text('recommended_action'),
    createdAt: createdAt(),
  },
  (t) => [
    index('hsc_account_idx').on(t.accountId, t.asOfDate),
    index('hsc_date_idx').on(t.asOfDate),
  ],
);

/* ------------------------------------------------------- product usage signals */

export const usageMetrics = pgTable(
  'usage_metrics',
  {
    id: pk('usg'),
    accountId: text('account_id').notNull(),
    subscriptionId: text('subscription_id'),
    productId: text('product_id'),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    /** monthly | weekly | daily */
    grain: text('grain').notNull().default('monthly'),

    licensedUsers: integer('licensed_users').notNull().default(0),
    activeUsers: integer('active_users').notNull().default(0),
    newUsers: integer('new_users').notNull().default(0),
    churnedUsers: integer('churned_users').notNull().default(0),
    /** activeUsers / licensedUsers in bps — licence utilisation. */
    utilisationBps: bps('utilisation_bps').notNull().default(0),
    logins: integer('logins').notNull().default(0),
    /** Share of key features touched, in bps. */
    featureAdoptionBps: bps('feature_adoption_bps').notNull().default(0),
    featuresUsed: jsonb('features_used').notNull().default([]),
    usageVolume: integer('usage_volume').notNull().default(0),
    commitmentVolume: integer('commitment_volume'),
    /** usageVolume / commitmentVolume in bps — consumption against commit. */
    consumptionBps: bps('consumption_bps'),
    overageVolume: integer('overage_volume').notNull().default(0),
    adminActions: integer('admin_actions').notNull().default(0),
    lastActivityAt: ts('last_activity_at'),
    daysSinceLastActivity: integer('days_since_last_activity'),
    /** Period-over-period change in active users, in bps. */
    trendBps: bps('trend_bps'),
    createdAt: createdAt(),
  },
  (t) => [
    index('usg_account_idx').on(t.accountId, t.periodStart),
    index('usg_product_idx').on(t.productId),
  ],
);

export const usageSignals = pgTable(
  'usage_signals',
  {
    id: pk('usig'),
    accountId: text('account_id').notNull(),
    subscriptionId: text('subscription_id'),
    productId: text('product_id'),
    contactId: text('contact_id'),
    type: usageSignalTypeEnum('type').notNull(),
    strength: integer('strength').notNull().default(50),
    detail: text('detail').notNull(),
    /** The metric that tripped, for explainability. */
    evidence: jsonb('evidence').notNull().default({}),
    detectedAt: ts('detected_at').notNull().defaultNow(),
    status: text('status').notNull().default('open'),
    actionedAt: ts('actioned_at'),
    actionedById: text('actioned_by_id'),
    createdOpportunityId: text('created_opportunity_id'),
    createdRiskId: text('created_risk_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('usig_account_idx').on(t.accountId),
    index('usig_type_idx').on(t.type, t.status),
  ],
);
