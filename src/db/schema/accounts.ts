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
  accountRelationshipTypeEnum,
  accountTypeEnum,
  contactRoleEnum,
  coverageModelEnum,
  customerTierEnum,
  healthBandEnum,
  lifecycleStageEnum,
  ownerRoleEnum,
  sentimentEnum,
  stanceEnum,
  strengthEnum,
} from './enums';

export const accounts = pgTable(
  'accounts',
  {
    id: pk('acc'),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    /** Position in the corporate hierarchy. */
    type: accountTypeEnum('type').notNull().default('global'),
    parentAccountId: text('parent_account_id'),
    ultimateParentAccountId: text('ultimate_parent_account_id'),
    hierarchyDepth: integer('hierarchy_depth').notNull().default(0),
    domain: text('domain'),
    website: text('website'),
    phone: text('phone'),

    // --- segmentation -----------------------------------------------------
    region: text('region'),
    country: text('country'),
    state: text('state'),
    city: text('city'),
    industry: text('industry'),
    subIndustry: text('sub_industry'),
    employeeCount: integer('employee_count'),
    /** smb | mid_market | enterprise | strategic — derived from employees/revenue. */
    sizeBand: text('size_band'),
    annualRevenueCents: money('annual_revenue_cents'),
    tier: customerTierEnum('tier').notNull().default('mid_market'),
    coverageModel: coverageModelEnum('coverage_model').notNull().default('named'),
    /** Total addressable spend for whitespace analysis. */
    potentialArrCents: money('potential_arr_cents'),
    potentialBand: text('potential_band'),

    // --- lifecycle & commercial state -------------------------------------
    lifecycleStage: lifecycleStageEnum('lifecycle_stage').notNull().default('prospect'),
    isCustomer: boolean('is_customer').notNull().default(false),
    isPartner: boolean('is_partner').notNull().default(false),
    isCompetitor: boolean('is_competitor').notNull().default(false),
    customerSince: date('customer_since'),
    churnedAt: date('churned_at'),
    currency: text('currency').notNull().default('USD'),
    currentArrCents: money('current_arr_cents').notNull().default(0),
    openPipelineCents: money('open_pipeline_cents').notNull().default(0),

    // --- health & sentiment (denormalised for list views; source of truth in
    //     health_scores / usage_metrics) -----------------------------------
    healthScore: integer('health_score'),
    healthBand: healthBandEnum('health_band'),
    healthTrend: integer('health_trend'),
    sentiment: sentimentEnum('sentiment'),
    npsScore: integer('nps_score'),
    csatScore: integer('csat_score'),
    renewalRiskLevel: text('renewal_risk_level'),

    // --- ownership (current pointers; history in ownership_history) --------
    ownerId: text('owner_id'),
    accountExecutiveId: text('account_executive_id'),
    bdrId: text('bdr_id'),
    csmId: text('csm_id'),
    renewalManagerId: text('renewal_manager_id'),
    supportOwnerId: text('support_owner_id'),
    channelManagerId: text('channel_manager_id'),
    executiveSponsorId: text('executive_sponsor_id'),
    territoryId: text('territory_id'),

    // --- attribution ------------------------------------------------------
    originalSource: text('original_source'),
    originalSourceDetail: text('original_source_detail'),
    latestSource: text('latest_source'),
    originalCampaignId: text('original_campaign_id'),

    description: text('description'),
    /** Region-specific privacy handling, e.g. 'gdpr' | 'ccpa' | 'none'. */
    privacyRegime: text('privacy_regime').notNull().default('none'),
    dataRetentionUntil: date('data_retention_until'),
    tags: jsonb('tags').notNull().default([]),
    ...auditCols,
  },
  (t) => [
    index('accounts_parent_idx').on(t.parentAccountId),
    index('accounts_owner_idx').on(t.ownerId),
    index('accounts_name_idx').on(t.name),
    index('accounts_tier_idx').on(t.tier),
  ],
);

/**
 * Non-hierarchical account-to-account relationships. A single deal routinely
 * involves a sold-to entity, a different bill-to, a reseller in the middle and
 * the end customer who actually uses the product — each of which is its own
 * account record with its own owner and its own history.
 */
export const accountRelationships = pgTable(
  'account_relationships',
  {
    id: pk('arel'),
    fromAccountId: text('from_account_id').notNull(),
    toAccountId: text('to_account_id').notNull(),
    type: accountRelationshipTypeEnum('type').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    notes: text('notes'),
    ...auditCols,
  },
  (t) => [
    index('arel_from_idx').on(t.fromAccountId),
    index('arel_to_idx').on(t.toAccountId),
  ],
);

export const accountTeam = pgTable(
  'account_team',
  {
    id: pk('atm'),
    accountId: text('account_id').notNull(),
    userId: text('user_id').notNull(),
    role: ownerRoleEnum('role').notNull(),
    accessLevel: text('access_level').notNull().default('read'),
    isPrimary: boolean('is_primary').notNull().default(false),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    ...auditCols,
  },
  (t) => [
    index('atm_account_idx').on(t.accountId),
    index('atm_user_idx').on(t.userId),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: pk('con'),
    accountId: text('account_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    mobile: text('mobile'),
    title: text('title'),
    department: text('department'),
    seniority: text('seniority'),
    roleType: contactRoleEnum('role_type').notNull().default('user'),
    reportsToContactId: text('reports_to_contact_id'),

    // --- relationship intelligence ---------------------------------------
    relationshipStrength: strengthEnum('relationship_strength').notNull().default('none'),
    sentiment: sentimentEnum('sentiment').notNull().default('neutral'),
    /** 0-100 rolling engagement index maintained by the scoring engine. */
    engagementScore: integer('engagement_score').notNull().default(0),
    lastEngagedAt: ts('last_engaged_at'),
    lastCustomerResponseAt: ts('last_customer_response_at'),
    nextMeetingAt: ts('next_meeting_at'),
    influenceLevel: integer('influence_level').notNull().default(3),
    isChampion: boolean('is_champion').notNull().default(false),
    hasLeftCompany: boolean('has_left_company').notNull().default(false),
    departedAt: date('departed_at'),

    // --- scoring (contacts can enter sales workflows without a lead) ------
    fitScore: integer('fit_score').notNull().default(0),
    intentScore: integer('intent_score').notNull().default(0),
    totalScore: integer('total_score').notNull().default(0),
    grade: text('grade'),

    // --- attribution & consent -------------------------------------------
    originalSource: text('original_source'),
    latestSource: text('latest_source'),
    originalCampaignId: text('original_campaign_id'),
    emailOptIn: boolean('email_opt_in').notNull().default(true),
    doNotCall: boolean('do_not_call').notNull().default(false),
    privacyRegime: text('privacy_regime').notNull().default('none'),

    ownerId: text('owner_id'),
    isActive: boolean('is_active').notNull().default(true),
    isPrimary: boolean('is_primary').notNull().default(false),
    isBillingContact: boolean('is_billing_contact').notNull().default(false),
    country: text('country'),
    timezone: text('timezone'),
    linkedinUrl: text('linkedin_url'),
    description: text('description'),
    ...auditCols,
  },
  (t) => [
    index('contacts_account_idx').on(t.accountId),
    index('contacts_email_idx').on(t.email),
    index('contacts_owner_idx').on(t.ownerId),
  ],
);

export const contactRelationships = pgTable(
  'contact_relationships',
  {
    id: pk('crel'),
    fromContactId: text('from_contact_id').notNull(),
    toContactId: text('to_contact_id').notNull(),
    /** reports_to | peer | influences | mentors | blocks */
    type: text('type').notNull(),
    strength: strengthEnum('strength').notNull().default('moderate'),
    notes: text('notes'),
    ...auditCols,
  },
  (t) => [index('crel_from_idx').on(t.fromContactId)],
);

/**
 * Stakeholder maps. A committee can hang off an account (the standing buying
 * centre) or a specific opportunity (the deal-specific committee).
 */
export const buyingCommittees = pgTable(
  'buying_committees',
  {
    id: pk('bcom'),
    accountId: text('account_id'),
    opportunityId: text('opportunity_id'),
    name: text('name').notNull(),
    /** Share of identified roles that have a mapped contact, in bps. */
    coverageBps: bps('coverage_bps').notNull().default(0),
    notes: text('notes'),
    ...auditCols,
  },
  (t) => [
    index('bcom_account_idx').on(t.accountId),
    index('bcom_opp_idx').on(t.opportunityId),
  ],
);

export const buyingCommitteeMembers = pgTable(
  'buying_committee_members',
  {
    id: pk('bmem'),
    committeeId: text('committee_id').notNull(),
    contactId: text('contact_id').notNull(),
    role: contactRoleEnum('role').notNull(),
    stance: stanceEnum('stance').notNull().default('neutral'),
    influenceLevel: integer('influence_level').notNull().default(3),
    isEconomicBuyer: boolean('is_economic_buyer').notNull().default(false),
    engagementScore: integer('engagement_score').notNull().default(0),
    lastEngagedAt: ts('last_engaged_at'),
    notes: text('notes'),
    ...auditCols,
  },
  (t) => [index('bmem_committee_idx').on(t.committeeId)],
);

export const billingAccounts = pgTable(
  'billing_accounts',
  {
    id: pk('bill'),
    accountId: text('account_id').notNull(),
    name: text('name').notNull(),
    billingContactId: text('billing_contact_id'),
    /** net_30 | net_45 | net_60 | prepaid */
    paymentTerms: text('payment_terms').notNull().default('net_30'),
    currency: text('currency').notNull().default('USD'),
    /** current | late | delinquent | on_hold */
    paymentStatus: text('payment_status').notNull().default('current'),
    dunningStatus: text('dunning_status'),
    outstandingCents: money('outstanding_cents').notNull().default(0),
    pastDueCents: money('past_due_cents').notNull().default(0),
    taxId: text('tax_id'),
    purchaseOrderRequired: boolean('purchase_order_required').notNull().default(false),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    externalBillingId: text('external_billing_id'),
    ...auditCols,
  },
  (t) => [index('bill_account_idx').on(t.accountId)],
);

export const consentRecords = pgTable(
  'consent_records',
  {
    id: pk('cons'),
    contactId: text('contact_id'),
    leadId: text('lead_id'),
    /** email | phone | sms | postal | profiling */
    channel: text('channel').notNull(),
    status: text('status').notNull(),
    /** consent | contract | legitimate_interest */
    legalBasis: text('legal_basis').notNull().default('consent'),
    region: text('region'),
    source: text('source'),
    capturedAt: ts('captured_at').notNull().defaultNow(),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [index('cons_contact_idx').on(t.contactId)],
);
