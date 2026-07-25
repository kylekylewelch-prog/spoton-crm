import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { auditCols, bps, money, pk, ts } from './_helpers';
import { dealRegistrationStatusEnum, partnerTierEnum } from './enums';

/**
 * Partner attributes hang off the partner's own account record. The commercial
 * intermediary and the end customer are always distinct accounts linked through
 * `accountRelationships`, so margin, renewal ownership and product usage never
 * get conflated.
 */
export const partnerProfiles = pgTable(
  'partner_profiles',
  {
    id: pk('pprof'),
    accountId: text('account_id').notNull().unique(),
    tier: partnerTierEnum('tier').notNull().default('registered'),
    /** applied | active | probation | suspended | terminated */
    programStatus: text('program_status').notNull().default('active'),
    /** reseller | referral | distributor | msp | si | oem */
    partnerType: text('partner_type').notNull().default('reseller'),
    competencies: jsonb('competencies').notNull().default([]),
    territories: jsonb('territories').notNull().default([]),
    authorisedProductFamilies: jsonb('authorised_product_families').notNull().default([]),

    /** Standard resale margin and referral fee, both in basis points. */
    marginBps: bps('margin_bps').notNull().default(2000),
    referralFeeBps: bps('referral_fee_bps').notNull().default(1000),
    priceBookId: text('price_book_id'),
    /** partner | vendor | shared */
    renewalOwnership: text('renewal_ownership').notNull().default('vendor'),

    certificationStatus: text('certification_status').notNull().default('none'),
    certifiedEngineers: integer('certified_engineers').notNull().default(0),
    enablementStatus: text('enablement_status').notNull().default('not_started'),
    lastTrainingAt: date('last_training_at'),

    agreementUrl: text('agreement_url'),
    agreementSignedAt: date('agreement_signed_at'),
    agreementExpiresAt: date('agreement_expires_at'),

    /** Rolling performance figures maintained by the partner scorecard job. */
    sourcedArrCents: money('sourced_arr_cents').notNull().default(0),
    influencedArrCents: money('influenced_arr_cents').notNull().default(0),
    managedArrCents: money('managed_arr_cents').notNull().default(0),
    dealsRegistered: integer('deals_registered').notNull().default(0),
    dealsWon: integer('deals_won').notNull().default(0),
    scorecard: jsonb('scorecard').notNull().default({}),

    channelManagerId: text('channel_manager_id'),
    ...auditCols,
  },
  (t) => [index('pprof_tier_idx').on(t.tier)],
);

export const dealRegistrations = pgTable(
  'deal_registrations',
  {
    id: pk('dreg'),
    number: text('number').notNull().unique(),
    partnerAccountId: text('partner_account_id').notNull(),
    partnerContactId: text('partner_contact_id'),
    /** Either an existing account or a name we have not yet created. */
    endCustomerAccountId: text('end_customer_account_id'),
    endCustomerName: text('end_customer_name').notNull(),
    endCustomerDomain: text('end_customer_domain'),
    endCustomerCountry: text('end_customer_country'),

    opportunityId: text('opportunity_id'),
    status: dealRegistrationStatusEnum('status').notNull().default('submitted'),
    estimatedArrCents: money('estimated_arr_cents').notNull().default(0),
    productFamilies: jsonb('product_families').notNull().default([]),
    expectedCloseDate: date('expected_close_date'),

    submittedAt: ts('submitted_at').notNull().defaultNow(),
    decidedAt: ts('decided_at'),
    decidedById: text('decided_by_id'),
    rejectionReason: text('rejection_reason'),
    /** Exclusivity window granted on approval. */
    protectionDays: integer('protection_days').notNull().default(90),
    protectionEndsAt: date('protection_ends_at'),
    approvedMarginBps: bps('approved_margin_bps'),

    /** Channel conflict: an existing direct or other-partner deal on the same logo. */
    conflictWithOpportunityId: text('conflict_with_opportunity_id'),
    conflictWithRegistrationId: text('conflict_with_registration_id'),
    conflictResolution: text('conflict_resolution'),
    conflictResolvedById: text('conflict_resolved_by_id'),
    conflictResolvedAt: ts('conflict_resolved_at'),

    notes: text('notes'),
    ...auditCols,
  },
  (t) => [
    index('dreg_partner_idx').on(t.partnerAccountId),
    index('dreg_status_idx').on(t.status),
    index('dreg_customer_idx').on(t.endCustomerAccountId),
  ],
);

/** Partner-facing lead handoffs, tracked so distribution is measurable. */
export const partnerLeadDistributions = pgTable(
  'partner_lead_distributions',
  {
    id: pk('pdist'),
    partnerAccountId: text('partner_account_id').notNull(),
    leadId: text('lead_id'),
    opportunityId: text('opportunity_id'),
    partnerContactId: text('partner_contact_id'),
    status: text('status').notNull().default('sent'),
    sentAt: ts('sent_at').notNull().defaultNow(),
    acceptedAt: ts('accepted_at'),
    rejectedAt: ts('rejected_at'),
    rejectionReason: text('rejection_reason'),
    slaHours: integer('sla_hours').notNull().default(48),
    slaDueAt: ts('sla_due_at'),
    slaBreached: boolean('sla_breached').notNull().default(false),
    ...auditCols,
  },
  (t) => [index('pdist_partner_idx').on(t.partnerAccountId)],
);
