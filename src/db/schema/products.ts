import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { auditCols, bps, createdAt, money, pk, ts } from './_helpers';
import {
  approvalStatusEnum,
  billingFrequencyEnum,
  billingModelEnum,
  lineActionEnum,
  productTypeEnum,
  quoteStatusEnum,
} from './enums';

export const products = pgTable(
  'products',
  {
    id: pk('prd'),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    family: text('family').notNull(),
    type: productTypeEnum('type').notNull(),
    billingModel: billingModelEnum('billing_model').notNull().default('per_user'),
    /** seat | tenant | gb | api_call | transaction | engagement */
    unitOfMeasure: text('unit_of_measure').notNull().default('seat'),
    isRecurring: boolean('is_recurring').notNull().default(true),
    /** Tier ranking within a family so upgrade/downgrade paths are computable. */
    editionRank: integer('edition_rank'),
    /** subscription | services | usage | support — drives revenue category. */
    revenueCategory: text('revenue_category').notNull().default('subscription'),
    requiresProductIds: jsonb('requires_product_ids').notNull().default([]),
    excludesProductIds: jsonb('excludes_product_ids').notNull().default([]),
    /** Entitlement template applied when this product is provisioned. */
    entitlementTemplate: jsonb('entitlement_template'),
    defaultTermMonths: integer('default_term_months').notNull().default(12),
    /** Maximum discount any seller may apply without deal desk, in bps. */
    maxDiscountBps: bps('max_discount_bps').notNull().default(2000),
    active: boolean('active').notNull().default(true),
    description: text('description'),
    ...auditCols,
  },
  (t) => [index('prd_family_idx').on(t.family), index('prd_type_idx').on(t.type)],
);

export const productBundles = pgTable(
  'product_bundles',
  {
    id: pk('bndl'),
    bundleProductId: text('bundle_product_id').notNull(),
    componentProductId: text('component_product_id').notNull(),
    quantity: integer('quantity').notNull().default(1),
    isOptional: boolean('is_optional').notNull().default(false),
    /** Allocation of the bundle price to this component, for revenue reporting. */
    allocationBps: bps('allocation_bps').notNull().default(0),
    ...auditCols,
  },
  (t) => [index('bndl_bundle_idx').on(t.bundleProductId)],
);

export const priceBooks = pgTable(
  'price_books',
  {
    id: pk('pbk'),
    name: text('name').notNull(),
    currency: text('currency').notNull().default('USD'),
    /** NA | EMEA | APAC | LATAM | GLOBAL */
    market: text('market').notNull().default('GLOBAL'),
    /** standard | partner | nonprofit | promotional | geographic */
    kind: text('kind').notNull().default('standard'),
    isDefault: boolean('is_default').notNull().default(false),
    partnerTier: text('partner_tier'),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    active: boolean('active').notNull().default(true),
    ...auditCols,
  },
  (t) => [index('pbk_currency_idx').on(t.currency, t.market)],
);

/**
 * A price book entry is scoped by quantity band and term so volume tiers and
 * multi-year pricing are data, not code. The pricing engine picks the most
 * specific matching entry.
 */
export const priceBookEntries = pgTable(
  'price_book_entries',
  {
    id: pk('pbe'),
    priceBookId: text('price_book_id').notNull(),
    productId: text('product_id').notNull(),
    listUnitCents: money('list_unit_cents').notNull(),
    minQuantity: integer('min_quantity').notNull().default(1),
    maxQuantity: integer('max_quantity'),
    termMonths: integer('term_months').notNull().default(12),
    /** Per-year discount applied automatically for multi-year commitments. */
    multiYearDiscountBps: bps('multi_year_discount_bps').notNull().default(0),
    /** Usage products: included volume before overage applies. */
    includedVolume: integer('included_volume'),
    overageUnitCents: money('overage_unit_cents'),
    active: boolean('active').notNull().default(true),
    ...auditCols,
  },
  (t) => [
    index('pbe_book_idx').on(t.priceBookId, t.productId),
    index('pbe_product_idx').on(t.productId),
  ],
);

/**
 * The discount approval matrix. Rows are evaluated in `sequence` order and every
 * row whose threshold is exceeded contributes an approval step, producing an
 * escalating chain rather than a single approver.
 */
export const discountPolicies = pgTable(
  'discount_policies',
  {
    id: pk('dpol'),
    name: text('name').notNull(),
    sequence: integer('sequence').notNull(),
    /** Inclusive lower bound of discount that triggers this approver, in bps. */
    thresholdBps: bps('threshold_bps').notNull(),
    approverRoleKey: text('approver_role_key').notNull(),
    /** Optional narrower scope. */
    appliesToProductFamily: text('applies_to_product_family'),
    appliesToOpportunityType: text('applies_to_opportunity_type'),
    minAmountCents: money('min_amount_cents'),
    /** Non-standard terms always route here regardless of discount. */
    triggersOnNonStandardTerms: boolean('triggers_on_non_standard_terms')
      .notNull()
      .default(false),
    slaHours: integer('sla_hours').notNull().default(24),
    escalateToRoleKey: text('escalate_to_role_key'),
    active: boolean('active').notNull().default(true),
    ...auditCols,
  },
  (t) => [index('dpol_seq_idx').on(t.sequence)],
);

export const quotes = pgTable(
  'quotes',
  {
    id: pk('qte'),
    number: text('number').notNull().unique(),
    opportunityId: text('opportunity_id').notNull(),
    accountId: text('account_id').notNull(),
    version: integer('version').notNull().default(1),
    supersedesQuoteId: text('supersedes_quote_id'),
    isPrimary: boolean('is_primary').notNull().default(true),
    status: quoteStatusEnum('status').notNull().default('draft'),

    priceBookId: text('price_book_id').notNull(),
    currency: text('currency').notNull().default('USD'),
    termMonths: integer('term_months').notNull().default(12),
    billingFrequency: billingFrequencyEnum('billing_frequency').notNull().default('annual'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),

    /** Mid-term change: term is snapped to this subscription's end date. */
    coTermSubscriptionId: text('co_term_subscription_id'),
    isCoTermed: boolean('is_co_termed').notNull().default(false),
    /** Fraction of a full year actually billed, in bps (co-term proration). */
    prorationFactorBps: bps('proration_factor_bps').notNull().default(10000),

    listTotalCents: money('list_total_cents').notNull().default(0),
    discountTotalCents: money('discount_total_cents').notNull().default(0),
    netTotalCents: money('net_total_cents').notNull().default(0),
    /** Blended discount across all lines — what the approval matrix evaluates. */
    effectiveDiscountBps: bps('effective_discount_bps').notNull().default(0),
    arrCents: money('arr_cents').notNull().default(0),
    /** Full-year value of this change, added to the next renewal. */
    annualizedArrCents: money('annualized_arr_cents').notNull().default(0),
    tcvCents: money('tcv_cents').notNull().default(0),
    /** Amount actually invoiced now, after co-term proration. */
    proratedAmountCents: money('prorated_amount_cents').notNull().default(0),

    hasNonStandardTerms: boolean('has_non_standard_terms').notNull().default(false),
    nonStandardTermsDetail: text('non_standard_terms_detail'),
    paymentTerms: text('payment_terms').notNull().default('net_30'),
    approvalRequestId: text('approval_request_id'),
    approvedAt: ts('approved_at'),
    approvedById: text('approved_by_id'),

    presentedAt: ts('presented_at'),
    acceptedAt: ts('accepted_at'),
    expiresAt: date('expires_at'),
    /** none | sent | viewed | signed | declined | voided */
    eSignStatus: text('e_sign_status').notNull().default('none'),
    eSignEnvelopeId: text('e_sign_envelope_id'),
    eSignSentAt: ts('e_sign_sent_at'),
    eSignCompletedAt: ts('e_sign_completed_at'),
    documentUrl: text('document_url'),

    ownerId: text('owner_id').notNull(),
    notes: text('notes'),
    ...auditCols,
  },
  (t) => [
    index('qte_opp_idx').on(t.opportunityId),
    index('qte_account_idx').on(t.accountId),
    index('qte_status_idx').on(t.status),
  ],
);

export const quoteLines = pgTable(
  'quote_lines',
  {
    id: pk('qln'),
    quoteId: text('quote_id').notNull(),
    productId: text('product_id').notNull(),
    sequence: integer('sequence').notNull().default(0),
    action: lineActionEnum('action').notNull().default('add'),
    quantity: integer('quantity').notNull().default(1),
    priorQuantity: integer('prior_quantity'),

    listUnitCents: money('list_unit_cents').notNull().default(0),
    netUnitCents: money('net_unit_cents').notNull().default(0),
    discountBps: bps('discount_bps').notNull().default(0),
    /** Discount already granted by the price book (partner/nonprofit/volume). */
    programDiscountBps: bps('program_discount_bps').notNull().default(0),
    discountReason: text('discount_reason'),

    termMonths: integer('term_months').notNull().default(12),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    prorationFactorBps: bps('proration_factor_bps').notNull().default(10000),

    /** Annual run rate this line contributes once fully in effect. */
    arrCents: money('arr_cents').notNull().default(0),
    annualizedArrCents: money('annualized_arr_cents').notNull().default(0),
    proratedAmountCents: money('prorated_amount_cents').notNull().default(0),
    tcvCents: money('tcv_cents').notNull().default(0),

    rampSchedule: jsonb('ramp_schedule'),
    minCommitVolume: integer('min_commit_volume'),
    overageUnitCents: money('overage_unit_cents'),
    replacesSubscriptionItemId: text('replaces_subscription_item_id'),
    ...auditCols,
  },
  (t) => [index('qln_quote_idx').on(t.quoteId)],
);

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: pk('apr'),
    objectType: text('object_type').notNull(),
    recordId: text('record_id').notNull(),
    /** discount | non_standard_terms | renewal_uplift_waiver | churn | credit */
    kind: text('kind').notNull().default('discount'),
    status: approvalStatusEnum('status').notNull().default('pending'),
    requestedById: text('requested_by_id').notNull(),
    justification: text('justification'),
    /** Amount and discount at submission, frozen for the audit trail. */
    amountCents: money('amount_cents').notNull().default(0),
    discountBps: bps('discount_bps').notNull().default(0),
    /** The exact policy rows that produced this chain, captured at submission. */
    policySnapshot: jsonb('policy_snapshot').notNull().default([]),
    currentStep: integer('current_step').notNull().default(1),
    totalSteps: integer('total_steps').notNull().default(1),
    submittedAt: ts('submitted_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
    slaDueAt: ts('sla_due_at'),
    slaBreached: boolean('sla_breached').notNull().default(false),
    ...auditCols,
  },
  (t) => [
    index('apr_record_idx').on(t.objectType, t.recordId),
    index('apr_status_idx').on(t.status),
  ],
);

export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: pk('aprs'),
    requestId: text('request_id').notNull(),
    sequence: integer('sequence').notNull(),
    approverRoleKey: text('approver_role_key').notNull(),
    approverUserId: text('approver_user_id'),
    decidedByUserId: text('decided_by_user_id'),
    status: approvalStatusEnum('status').notNull().default('pending'),
    thresholdBps: bps('threshold_bps'),
    comments: text('comments'),
    slaDueAt: ts('sla_due_at'),
    decidedAt: ts('decided_at'),
    escalatedAt: ts('escalated_at'),
    escalatedToUserId: text('escalated_to_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('aprs_request_idx').on(t.requestId, t.sequence),
    index('aprs_approver_idx').on(t.approverUserId),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: pk('ord'),
    number: text('number').notNull().unique(),
    quoteId: text('quote_id').notNull(),
    opportunityId: text('opportunity_id').notNull(),
    accountId: text('account_id').notNull(),
    status: text('status').notNull().default('booked'),
    currency: text('currency').notNull().default('USD'),
    arrCents: money('arr_cents').notNull().default(0),
    tcvCents: money('tcv_cents').notNull().default(0),
    bookedAt: ts('booked_at').notNull().defaultNow(),
    bookedById: text('booked_by_id'),
    /** True when the booking cleared automation with no human touch. */
    autoBooked: boolean('auto_booked').notNull().default(false),
    contractId: text('contract_id'),
    subscriptionId: text('subscription_id'),
    externalErpId: text('external_erp_id'),
    ...auditCols,
  },
  (t) => [index('ord_account_idx').on(t.accountId)],
);

export const contracts = pgTable(
  'contracts',
  {
    id: pk('ctr'),
    number: text('number').notNull().unique(),
    accountId: text('account_id').notNull(),
    orderId: text('order_id'),
    quoteId: text('quote_id'),
    parentContractId: text('parent_contract_id'),
    status: text('status').notNull().default('active'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    termMonths: integer('term_months').notNull().default(12),
    autoRenew: boolean('auto_renew').notNull().default(true),
    /** Days before end date by which cancellation notice must be given. */
    noticeDays: integer('notice_days').notNull().default(60),
    noticeDate: date('notice_date'),
    /** Contractual annual uplift applied at renewal, in bps. */
    upliftBps: bps('uplift_bps').notNull().default(500),
    upliftCapBps: bps('uplift_cap_bps'),
    signedAt: ts('signed_at'),
    signedByContactId: text('signed_by_contact_id'),
    documentUrl: text('document_url'),
    /** Negotiated deviations from standard paper, tracked individually. */
    exceptions: jsonb('exceptions').notNull().default([]),
    redlineStatus: text('redline_status'),
    governingLaw: text('governing_law'),
    ...auditCols,
  },
  (t) => [
    index('ctr_account_idx').on(t.accountId),
    index('ctr_end_idx').on(t.endDate),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: pk('inv'),
    number: text('number').notNull().unique(),
    billingAccountId: text('billing_account_id').notNull(),
    accountId: text('account_id').notNull(),
    subscriptionId: text('subscription_id'),
    orderId: text('order_id'),
    status: text('status').notNull().default('issued'),
    currency: text('currency').notNull().default('USD'),
    amountCents: money('amount_cents').notNull().default(0),
    taxCents: money('tax_cents').notNull().default(0),
    paidCents: money('paid_cents').notNull().default(0),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    issuedAt: date('issued_at').notNull(),
    dueAt: date('due_at'),
    paidAt: date('paid_at'),
    externalInvoiceId: text('external_invoice_id'),
    ...auditCols,
  },
  (t) => [
    index('inv_account_idx').on(t.accountId),
    index('inv_sub_idx').on(t.subscriptionId),
  ],
);
