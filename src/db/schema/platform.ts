import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { auditCols, bps, createdAt, pk, ts } from './_helpers';
import {
  aiInsightKindEnum,
  integrationDirectionEnum,
  priorityEnum,
  runStatusEnum,
  workflowTriggerEnum,
} from './enums';

/**
 * Every workflow has a named owner, explicit entry and exit criteria, an
 * exception path and a measurable SLA — enforced by the columns being non-null,
 * not by convention.
 */
export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    id: pk('wfd'),
    name: text('name').notNull(),
    description: text('description'),
    objectType: text('object_type').notNull(),
    trigger: workflowTriggerEnum('trigger').notNull(),
    /** Field whose change fires an on_field_change workflow. */
    watchField: text('watch_field'),
    /** Predicate against the record, e.g. { stage: 'closed_won' }. */
    entryCriteria: jsonb('entry_criteria').notNull().default({}),
    exitCriteria: jsonb('exit_criteria').notNull().default({}),
    /** Ordered action list: [{ type: 'create_task', ... }]. */
    actions: jsonb('actions').notNull().default([]),
    /** Delay for time-based workflows, relative to a date field on the record. */
    offsetDays: integer('offset_days'),
    offsetFromField: text('offset_from_field'),
    slaMinutes: integer('sla_minutes'),
    ownerUserId: text('owner_user_id').notNull(),
    maxAttempts: integer('max_attempts').notNull().default(3),
    /** Failures land here for human triage rather than vanishing. */
    exceptionQueue: text('exception_queue').notNull().default('default'),
    active: boolean('active').notNull().default(true),
    ...auditCols,
  },
  (t) => [index('wfd_object_idx').on(t.objectType, t.trigger)],
);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: pk('wfr'),
    definitionId: text('definition_id').notNull(),
    objectType: text('object_type').notNull(),
    recordId: text('record_id').notNull(),
    status: runStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    durationMs: integer('duration_ms'),
    scheduledFor: ts('scheduled_for'),
    nextRetryAt: ts('next_retry_at'),
    error: text('error'),
    /** Step-by-step trace, so a run is explainable after the fact. */
    log: jsonb('log').notNull().default([]),
    triggeredBy: text('triggered_by').notNull().default('system'),
    createdAt: createdAt(),
  },
  (t) => [
    index('wfr_def_idx').on(t.definitionId, t.status),
    index('wfr_record_idx').on(t.objectType, t.recordId),
    index('wfr_status_idx').on(t.status),
  ],
);

export const slaTimers = pgTable(
  'sla_timers',
  {
    id: pk('sla'),
    objectType: text('object_type').notNull(),
    recordId: text('record_id').notNull(),
    /** lead_first_touch | case_first_response | approval_decision | ... */
    name: text('name').notNull(),
    targetMinutes: integer('target_minutes').notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    dueAt: ts('due_at').notNull(),
    stoppedAt: ts('stopped_at'),
    breachedAt: ts('breached_at'),
    /** running | met | breached | cancelled | paused */
    status: text('status').notNull().default('running'),
    pausedMinutes: integer('paused_minutes').notNull().default(0),
    ownerId: text('owner_id'),
    escalatedToUserId: text('escalated_to_user_id'),
    escalatedAt: ts('escalated_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sla_record_idx').on(t.objectType, t.recordId),
    index('sla_status_idx').on(t.status, t.dueAt),
  ],
);

/* --------------------------------------------------------------- integrations */

export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: pk('icon'),
    name: text('name').notNull(),
    /** marketing_automation | sales_engagement | call_intelligence | cpq |
     *  e_signature | erp | billing | payments | customer_success | support |
     *  product_telemetry | iam | data_warehouse | bi | partner_portal | chat */
    category: text('category').notNull(),
    system: text('system').notNull(),
    direction: integrationDirectionEnum('direction').notNull().default('bidirectional'),
    /** connected | degraded | error | disabled */
    status: text('status').notNull().default('connected'),
    /** True when running against the built-in simulator rather than a live API. */
    isMock: boolean('is_mock').notNull().default(true),
    config: jsonb('config').notNull().default({}),
    /** Dedicated integration principal, so machine writes are attributable. */
    integrationUserId: text('integration_user_id'),
    webhookUrl: text('webhook_url'),
    /** Cursor for change-data capture. */
    syncCursor: text('sync_cursor'),
    lastSyncAt: ts('last_sync_at'),
    lastSuccessAt: ts('last_success_at'),
    lastErrorAt: ts('last_error_at'),
    lastError: text('last_error'),
    eventsSent: integer('events_sent').notNull().default(0),
    eventsFailed: integer('events_failed').notNull().default(0),
    ...auditCols,
  },
  (t) => [index('icon_category_idx').on(t.category)],
);

/**
 * The integration outbox/inbox. Every inbound and outbound message is a durable
 * row with attempt count, next retry time and a dead-letter terminal state, so
 * nothing is silently lost and every sync is replayable.
 */
export const integrationEvents = pgTable(
  'integration_events',
  {
    id: pk('ievt'),
    connectionId: text('connection_id').notNull(),
    direction: integrationDirectionEnum('direction').notNull(),
    eventType: text('event_type').notNull(),
    objectType: text('object_type'),
    recordId: text('record_id'),
    externalId: text('external_id'),
    /** Idempotency key — a redelivered event must not double-apply. */
    idempotencyKey: text('idempotency_key'),
    payload: jsonb('payload').notNull().default({}),
    response: jsonb('response'),
    status: runStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),
    nextRetryAt: ts('next_retry_at'),
    processedAt: ts('processed_at'),
    /** Upstream provenance for data lineage. */
    lineage: jsonb('lineage').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('ievt_conn_idx').on(t.connectionId, t.status),
    index('ievt_record_idx').on(t.objectType, t.recordId),
    index('ievt_status_idx').on(t.status, t.nextRetryAt),
  ],
);

/* ------------------------------------------------------------- data quality */

export const validationRules = pgTable(
  'validation_rules',
  {
    id: pk('vrul'),
    objectType: text('object_type').notNull(),
    name: text('name').notNull(),
    /** required | format | range | cross_field | stage_gate */
    kind: text('kind').notNull(),
    field: text('field'),
    /** Rule body interpreted by the validation engine. */
    definition: jsonb('definition').notNull().default({}),
    /** Only enforced from this stage onwards, for stage_gate rules. */
    appliesFromStage: text('applies_from_stage'),
    message: text('message').notNull(),
    severity: text('severity').notNull().default('error'),
    /** Whether an admin may override a failure, with a reason. */
    overridable: boolean('overridable').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...auditCols,
  },
  (t) => [index('vrul_object_idx').on(t.objectType)],
);

export const dataQualityIssues = pgTable(
  'data_quality_issues',
  {
    id: pk('dqi'),
    objectType: text('object_type').notNull(),
    recordId: text('record_id').notNull(),
    ruleId: text('rule_id'),
    rule: text('rule').notNull(),
    field: text('field'),
    severity: text('severity').notNull().default('warning'),
    detail: text('detail').notNull(),
    status: text('status').notNull().default('open'),
    ownerId: text('owner_id'),
    detectedAt: ts('detected_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('dqi_record_idx').on(t.objectType, t.recordId),
    index('dqi_status_idx').on(t.status, t.severity),
  ],
);

export const duplicateCandidates = pgTable(
  'duplicate_candidates',
  {
    id: pk('dup'),
    objectType: text('object_type').notNull(),
    recordAId: text('record_a_id').notNull(),
    recordBId: text('record_b_id').notNull(),
    /** 0-10000 bps match confidence. */
    scoreBps: bps('score_bps').notNull(),
    matchedOn: jsonb('matched_on').notNull().default([]),
    /** open | merged | not_duplicate | ignored */
    status: text('status').notNull().default('open'),
    /** Cross-object duplicates: a lead that is really an existing contact. */
    crossObject: boolean('cross_object').notNull().default(false),
    otherObjectType: text('other_object_type'),
    resolvedById: text('resolved_by_id'),
    resolvedAt: ts('resolved_at'),
    survivorRecordId: text('survivor_record_id'),
    detectedAt: ts('detected_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('dup_object_idx').on(t.objectType, t.status),
    index('dup_a_idx').on(t.recordAId),
  ],
);

/* ------------------------------------------------------------------- AI layer */

/**
 * AI output is stored, never applied silently. Each insight carries its
 * evidence, a confidence figure and an explicit accept/dismiss decision, so a
 * material change to pricing, forecast, risk or ownership always has a human in
 * the loop and an audit row behind it.
 */
export const aiInsights = pgTable(
  'ai_insights',
  {
    id: pk('ains'),
    kind: aiInsightKindEnum('kind').notNull(),
    objectType: text('object_type').notNull(),
    recordId: text('record_id').notNull(),
    accountId: text('account_id'),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    confidenceBps: bps('confidence_bps').notNull().default(5000),
    severity: priorityEnum('severity').notNull().default('medium'),
    /** The signals that produced this insight, quoted for inspection. */
    evidence: jsonb('evidence').notNull().default([]),
    recommendedAction: text('recommended_action'),
    /** Structured proposal the user can apply with one click. */
    proposedChange: jsonb('proposed_change'),
    /** open | accepted | dismissed | superseded | applied */
    status: text('status').notNull().default('open'),
    model: text('model').notNull().default('spoton-heuristics-v1'),
    generatedAt: ts('generated_at').notNull().defaultNow(),
    decidedById: text('decided_by_id'),
    decidedAt: ts('decided_at'),
    dismissReason: text('dismiss_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ains_record_idx').on(t.objectType, t.recordId),
    index('ains_kind_idx').on(t.kind, t.status),
    index('ains_account_idx').on(t.accountId),
  ],
);

/**
 * Saved list views and reports. The report definition is data so the reporting
 * layer, the API and the MCP natural-language reporting tool all execute the
 * same thing.
 */
export const savedReports = pgTable(
  'saved_reports',
  {
    id: pk('rpt'),
    name: text('name').notNull(),
    objectType: text('object_type').notNull(),
    /** table | summary | matrix | funnel | waterfall | trend | cohort */
    kind: text('kind').notNull().default('table'),
    filters: jsonb('filters').notNull().default([]),
    columns: jsonb('columns').notNull().default([]),
    groupBy: jsonb('group_by').notNull().default([]),
    aggregates: jsonb('aggregates').notNull().default([]),
    sort: jsonb('sort').notNull().default([]),
    ownerId: text('owner_id'),
    isPublic: boolean('is_public').notNull().default(true),
    isSystem: boolean('is_system').notNull().default(false),
    description: text('description'),
    ...auditCols,
  },
  (t) => [index('rpt_object_idx').on(t.objectType)],
);
