import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { auditCols, bps, pk, ts } from './_helpers';
import {
  activityTypeEnum,
  contactRoleEnum,
  priorityEnum,
  sentimentEnum,
  taskStatusEnum,
} from './enums';

/**
 * The interaction ledger. Everything a human or an integration observes about a
 * customer conversation lands here, related to as many objects as apply, which
 * is what makes relationship analysis and engagement-by-buying-role possible.
 */
export const activities = pgTable(
  'activities',
  {
    id: pk('act'),
    type: activityTypeEnum('type').notNull(),
    subject: text('subject').notNull(),
    body: text('body'),
    /** inbound | outbound | internal */
    direction: text('direction').notNull().default('outbound'),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    durationMinutes: integer('duration_minutes'),

    // --- relationships (all optional; an activity may touch several) -------
    accountId: text('account_id'),
    contactId: text('contact_id'),
    leadId: text('lead_id'),
    opportunityId: text('opportunity_id'),
    caseId: text('case_id'),
    subscriptionId: text('subscription_id'),
    renewalId: text('renewal_id'),
    campaignId: text('campaign_id'),
    /** Additional participants beyond the primary contact. */
    participantContactIds: jsonb('participant_contact_ids').notNull().default([]),
    participantUserIds: jsonb('participant_user_ids').notNull().default([]),

    ownerId: text('owner_id'),
    /** manual | email_sync | calendar_sync | call_intelligence | sequence | ai */
    source: text('source').notNull().default('manual'),
    externalId: text('external_id'),

    // --- conversation intelligence ---------------------------------------
    sentiment: sentimentEnum('sentiment'),
    /** -10000..10000 bps, finer grained than the banded sentiment. */
    sentimentScoreBps: bps('sentiment_score_bps'),
    summary: text('summary'),
    recordingUrl: text('recording_url'),
    transcript: text('transcript'),
    objections: jsonb('objections').notNull().default([]),
    competitorMentions: jsonb('competitor_mentions').notNull().default([]),
    commitments: jsonb('commitments').notNull().default([]),
    nextSteps: text('next_steps'),
    /** Distinguishes "we emailed them" from "they replied". */
    isCustomerResponse: boolean('is_customer_response').notNull().default(false),
    /** Buying role of the counterparty, denormalised for engagement rollups. */
    contactRole: contactRoleEnum('contact_role'),
    ...auditCols,
  },
  (t) => [
    index('act_account_idx').on(t.accountId, t.occurredAt),
    index('act_contact_idx').on(t.contactId),
    index('act_opp_idx').on(t.opportunityId),
    index('act_occurred_idx').on(t.occurredAt),
    index('act_type_idx').on(t.type),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: pk('task'),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('open'),
    priority: priorityEnum('priority').notNull().default('medium'),
    dueDate: date('due_date'),
    completedAt: ts('completed_at'),
    ownerId: text('owner_id').notNull(),

    accountId: text('account_id'),
    contactId: text('contact_id'),
    leadId: text('lead_id'),
    opportunityId: text('opportunity_id'),
    caseId: text('case_id'),
    renewalId: text('renewal_id'),
    riskId: text('risk_id'),
    approvalRequestId: text('approval_request_id'),

    /** manual | workflow | playbook | mcp | ai | sla_escalation */
    source: text('source').notNull().default('manual'),
    workflowRunId: text('workflow_run_id'),
    ...auditCols,
  },
  (t) => [
    index('task_owner_idx').on(t.ownerId, t.status),
    index('task_account_idx').on(t.accountId),
    index('task_due_idx').on(t.dueDate),
  ],
);
