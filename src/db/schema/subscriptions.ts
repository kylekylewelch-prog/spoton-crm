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
  amendmentTypeEnum,
  arrMovementTypeEnum,
  billingFrequencyEnum,
  forecastCategoryEnum,
  renewalStatusEnum,
  riskLevelEnum,
  subscriptionStatusEnum,
} from './enums';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: pk('sub'),
    number: text('number').notNull().unique(),
    accountId: text('account_id').notNull(),
    contractId: text('contract_id'),
    billingAccountId: text('billing_account_id'),
    /** Set when this subscription was produced by renewing another. */
    predecessorSubscriptionId: text('predecessor_subscription_id'),
    successorSubscriptionId: text('successor_subscription_id'),
    /** Incremented by every amendment so the version chain is explicit. */
    version: integer('version').notNull().default(1),

    status: subscriptionStatusEnum('status').notNull().default('active'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    termMonths: integer('term_months').notNull().default(12),
    billingFrequency: billingFrequencyEnum('billing_frequency').notNull().default('annual'),
    autoRenew: boolean('auto_renew').notNull().default(true),
    /** Deadline for the customer to give non-renewal notice. */
    noticeDays: integer('notice_days').notNull().default(60),
    noticeDate: date('notice_date'),
    upliftBps: bps('uplift_bps').notNull().default(500),

    currency: text('currency').notNull().default('USD'),
    /** Value at original signature — never mutated, for original-vs-current. */
    originalArrCents: money('original_arr_cents').notNull().default(0),
    originalTcvCents: money('original_tcv_cents').notNull().default(0),
    /** Live run rate, recomputed from active items after every amendment. */
    currentArrCents: money('current_arr_cents').notNull().default(0),
    currentMrrCents: money('current_mrr_cents').notNull().default(0),
    currentTcvCents: money('current_tcv_cents').notNull().default(0),
    /** TCV still ahead of today — remaining contract value. */
    remainingContractValueCents: money('remaining_contract_value_cents')
      .notNull()
      .default(0),

    /**
     * Full-year value of mid-term additions that were co-termed onto this
     * subscription. Carried into the next renewal's renewable ARR so a
     * part-year upsell renews at its full annual rate.
     */
    coTermedAdditionsArrCents: money('co_termed_additions_arr_cents')
      .notNull()
      .default(0),

    cancellationRequestedAt: ts('cancellation_requested_at'),
    cancellationEffectiveDate: date('cancellation_effective_date'),
    cancellationReason: text('cancellation_reason'),
    churnedAt: date('churned_at'),

    renewalOwnerId: text('renewal_owner_id'),
    csmId: text('csm_id'),
    /** Partner that owns the renewal, when sold indirectly. */
    partnerAccountId: text('partner_account_id'),
    originatingOpportunityId: text('originating_opportunity_id'),
    notes: text('notes'),
    ...auditCols,
  },
  (t) => [
    index('sub_account_idx').on(t.accountId),
    index('sub_status_idx').on(t.status),
    index('sub_end_idx').on(t.endDate),
  ],
);

export const subscriptionItems = pgTable(
  'subscription_items',
  {
    id: pk('subi'),
    subscriptionId: text('subscription_id').notNull(),
    productId: text('product_id').notNull(),
    /** active | pending | removed — removed items are retained for history. */
    status: text('status').notNull().default('active'),
    quantity: integer('quantity').notNull().default(1),
    listUnitCents: money('list_unit_cents').notNull().default(0),
    netUnitCents: money('net_unit_cents').notNull().default(0),
    discountBps: bps('discount_bps').notNull().default(0),
    arrCents: money('arr_cents').notNull().default(0),
    mrrCents: money('mrr_cents').notNull().default(0),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    /** True for items added mid-term and snapped to the parent end date. */
    isCoTermed: boolean('is_co_termed').notNull().default(false),
    prorationFactorBps: bps('proration_factor_bps').notNull().default(10000),
    /** Annual run rate ignoring the short first period. */
    annualizedArrCents: money('annualized_arr_cents').notNull().default(0),

    minCommitVolume: integer('min_commit_volume'),
    includedVolume: integer('included_volume'),
    overageUnitCents: money('overage_unit_cents'),
    rampSchedule: jsonb('ramp_schedule'),

    addedByAmendmentId: text('added_by_amendment_id'),
    removedByAmendmentId: text('removed_by_amendment_id'),
    removedAt: ts('removed_at'),
    sourceQuoteLineId: text('source_quote_line_id'),
    ...auditCols,
  },
  (t) => [
    index('subi_sub_idx').on(t.subscriptionId),
    index('subi_product_idx').on(t.productId),
  ],
);

/**
 * Every change to a live subscription is an amendment. Mid-term additions
 * record both what is billed now (`proratedAmountCents`) and what the change is
 * worth on a full-year basis (`annualizedArrCents`); the latter is what the
 * renewal picks up, via `appliedToRenewalOpportunityId`.
 */
export const subscriptionAmendments = pgTable(
  'subscription_amendments',
  {
    id: pk('amd'),
    number: text('number').notNull().unique(),
    subscriptionId: text('subscription_id').notNull(),
    type: amendmentTypeEnum('type').notNull(),
    status: text('status').notNull().default('applied'),
    opportunityId: text('opportunity_id'),
    quoteId: text('quote_id'),
    orderId: text('order_id'),

    effectiveDate: date('effective_date').notNull(),
    /** End date inherited from the parent subscription when co-termed. */
    coTermEndDate: date('co_term_end_date'),
    isCoTermed: boolean('is_co_termed').notNull().default(false),
    prorationFactorBps: bps('proration_factor_bps').notNull().default(10000),
    remainingDays: integer('remaining_days'),

    /** Net change to the live run rate at the effective date. */
    deltaArrCents: money('delta_arr_cents').notNull().default(0),
    /** Full-year value of the change — carried into the renewal. */
    annualizedArrCents: money('annualized_arr_cents').notNull().default(0),
    /** Cash invoiced for the stub period. */
    proratedAmountCents: money('prorated_amount_cents').notNull().default(0),
    arrBeforeCents: money('arr_before_cents').notNull().default(0),
    arrAfterCents: money('arr_after_cents').notNull().default(0),

    /** The renewal opportunity this change was rolled forward into. */
    appliedToRenewalOpportunityId: text('applied_to_renewal_opportunity_id'),
    appliedToRenewalId: text('applied_to_renewal_id'),
    appliedToRenewalAt: ts('applied_to_renewal_at'),

    notes: text('notes'),
    ...auditCols,
  },
  (t) => [
    index('amd_sub_idx').on(t.subscriptionId),
    index('amd_effective_idx').on(t.effectiveDate),
    index('amd_renewal_opp_idx').on(t.appliedToRenewalOpportunityId),
  ],
);

/**
 * The ARR ledger. Every movement is an immutable row, so the waterfall
 * (beginning → new → expansion → uplift → contraction → churn → ending) is a
 * sum rather than a reconciliation exercise, and GRR/NRR are derivable for any
 * period without snapshots.
 */
export const arrMovements = pgTable(
  'arr_movements',
  {
    id: pk('arr'),
    accountId: text('account_id').notNull(),
    subscriptionId: text('subscription_id'),
    amendmentId: text('amendment_id'),
    opportunityId: text('opportunity_id'),
    renewalId: text('renewal_id'),
    type: arrMovementTypeEnum('type').notNull(),
    /** Signed: expansion and new are positive, contraction and churn negative. */
    arrDeltaCents: money('arr_delta_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    /** Reporting currency amount at the effective-date FX rate. */
    arrDeltaBaseCents: money('arr_delta_base_cents').notNull().default(0),
    effectiveDate: date('effective_date').notNull(),
    fiscalPeriod: text('fiscal_period').notNull(),
    fiscalQuarter: text('fiscal_quarter').notNull(),
    productId: text('product_id'),
    note: text('note'),
    createdAt: createdAt(),
    createdById: text('created_by_id'),
  },
  (t) => [
    index('arrm_account_idx').on(t.accountId),
    index('arrm_period_idx').on(t.fiscalPeriod),
    index('arrm_type_idx').on(t.type),
    index('arrm_sub_idx').on(t.subscriptionId),
  ],
);

export const entitlements = pgTable(
  'entitlements',
  {
    id: pk('ent'),
    subscriptionId: text('subscription_id').notNull(),
    subscriptionItemId: text('subscription_item_id'),
    accountId: text('account_id').notNull(),
    productId: text('product_id').notNull(),
    featureKey: text('feature_key').notNull(),
    limitValue: integer('limit_value'),
    unitOfMeasure: text('unit_of_measure'),
    /** Support entitlement level, when this row grants support. */
    supportLevel: text('support_level'),
    firstResponseSlaMinutes: integer('first_response_sla_minutes'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: text('status').notNull().default('active'),
    ...auditCols,
  },
  (t) => [
    index('ent_sub_idx').on(t.subscriptionId),
    index('ent_account_idx').on(t.accountId),
  ],
);

export const productInstances = pgTable(
  'product_instances',
  {
    id: pk('pinst'),
    accountId: text('account_id').notNull(),
    subscriptionId: text('subscription_id'),
    productId: text('product_id').notNull(),
    name: text('name').notNull(),
    /** production | sandbox | staging */
    environment: text('environment').notNull().default('production'),
    region: text('region'),
    version: text('version'),
    status: text('status').notNull().default('active'),
    externalTenantId: text('external_tenant_id'),
    provisionedAt: ts('provisioned_at'),
    lastHeartbeatAt: ts('last_heartbeat_at'),
    ...auditCols,
  },
  (t) => [index('pinst_account_idx').on(t.accountId)],
);

/**
 * The renewal record is the operating object for the renewals team: one row per
 * subscription term ending, created automatically when the originating deal is
 * won, and paired 1:1 with a renewal opportunity.
 */
export const renewals = pgTable(
  'renewals',
  {
    id: pk('rnw'),
    subscriptionId: text('subscription_id').notNull(),
    accountId: text('account_id').notNull(),
    opportunityId: text('opportunity_id'),
    status: renewalStatusEnum('status').notNull().default('not_started'),
    renewalDate: date('renewal_date').notNull(),
    noticeDate: date('notice_date'),
    term: integer('term_months').notNull().default(12),

    /** ARR live on the subscription today. */
    currentArrCents: money('current_arr_cents').notNull().default(0),
    /**
     * What is actually up for renewal: current ARR plus the annualised value of
     * co-termed mid-term additions, less anything already noticed for
     * cancellation.
     */
    renewableArrCents: money('renewable_arr_cents').notNull().default(0),
    coTermedAdditionsArrCents: money('co_termed_additions_arr_cents')
      .notNull()
      .default(0),
    upliftBps: bps('uplift_bps').notNull().default(500),
    upliftArrCents: money('uplift_arr_cents').notNull().default(0),
    /** The renewals team's number. */
    expectedArrCents: money('expected_arr_cents').notNull().default(0),
    forecastCategory: forecastCategoryEnum('forecast_category').notNull().default('pipeline'),
    /** Scenario planning. */
    upsideArrCents: money('upside_arr_cents').notNull().default(0),
    downsideArrCents: money('downside_arr_cents').notNull().default(0),
    churnRiskArrCents: money('churn_risk_arr_cents').notNull().default(0),
    /** Model output, 0-10000 bps. */
    renewalLikelihoodBps: bps('renewal_likelihood_bps'),

    riskLevel: riskLevelEnum('risk_level').notNull().default('low'),
    autoRenew: boolean('auto_renew').notNull().default(true),
    cancellationNoticeReceivedAt: ts('cancellation_notice_received_at'),
    multiYearOptionOffered: boolean('multi_year_option_offered').notNull().default(false),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    escalatedToUserId: text('escalated_to_user_id'),
    escalatedAt: ts('escalated_at'),
    playbookId: text('playbook_id'),

    closedArrCents: money('closed_arr_cents'),
    closedAt: ts('closed_at'),
    ownerId: text('owner_id'),
    notes: text('notes'),
    ...auditCols,
  },
  (t) => [
    index('rnw_sub_idx').on(t.subscriptionId),
    index('rnw_date_idx').on(t.renewalDate),
    index('rnw_account_idx').on(t.accountId),
    index('rnw_status_idx').on(t.status),
  ],
);
