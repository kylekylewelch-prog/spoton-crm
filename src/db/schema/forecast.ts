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
  forecastCategoryEnum,
  opportunityStageEnum,
  revenueTypeEnum,
} from './enums';

/**
 * A forecast is a submission, not a live query. Rep, manager, region and company
 * levels each get a row per period and revenue type, and once submitted the
 * numbers are frozen — that is what makes bias, accuracy and movement since last
 * submission measurable rather than anecdotal.
 */
export const forecasts = pgTable(
  'forecasts',
  {
    id: pk('fcst'),
    /** rep | manager | region | product | company */
    level: text('level').notNull().default('rep'),
    ownerId: text('owner_id'),
    teamId: text('team_id'),
    territoryId: text('territory_id'),
    productFamily: text('product_family'),
    segment: text('segment'),

    fiscalPeriod: text('fiscal_period').notNull(),
    /** month | quarter | year */
    periodType: text('period_type').notNull().default('quarter'),
    revenueType: revenueTypeEnum('revenue_type').notNull().default('total'),
    /** arr | bookings | revenue | units | consumption */
    metric: text('metric').notNull().default('arr'),
    currency: text('currency').notNull().default('USD'),

    quotaCents: money('quota_cents').notNull().default(0),
    closedWonCents: money('closed_won_cents').notNull().default(0),
    commitCents: money('commit_cents').notNull().default(0),
    bestCaseCents: money('best_case_cents').notNull().default(0),
    pipelineCents: money('pipeline_cents').notNull().default(0),
    omittedCents: money('omitted_cents').notNull().default(0),
    /** Stage-probability weighted roll-up, computed not judged. */
    weightedCents: money('weighted_cents').notNull().default(0),
    /** The human number. */
    judgmentCents: money('judgment_cents').notNull().default(0),
    managerAdjustmentCents: money('manager_adjustment_cents').notNull().default(0),
    /** judgment + adjustment — the submitted call. */
    submittedCents: money('submitted_cents').notNull().default(0),
    /** Open pipeline divided by remaining gap, in bps. */
    coverageBps: bps('coverage_bps'),

    parentForecastId: text('parent_forecastid'),
    isSubmitted: boolean('is_submitted').notNull().default(false),
    submittedAt: ts('submitted_at'),
    submittedById: text('submitted_by_id'),
    commentary: text('commentary'),
    /** Deal-level judgement overrides: { opportunityId: 'commit' }. */
    dealOverrides: jsonb('deal_overrides').notNull().default({}),
    /** One-for-one swaps recorded when a commit deal is replaced. */
    swaps: jsonb('swaps').notNull().default([]),
    ...auditCols,
  },
  (t) => [
    index('fcst_period_idx').on(t.fiscalPeriod, t.level),
    index('fcst_owner_idx').on(t.ownerId),
  ],
);

/** Immutable copy of a submission, so history survives later edits. */
export const forecastSnapshots = pgTable(
  'forecast_snapshots',
  {
    id: pk('fsnap'),
    forecastId: text('forecast_id'),
    fiscalPeriod: text('fiscal_period').notNull(),
    asOfDate: date('as_of_date').notNull(),
    level: text('level').notNull(),
    ownerId: text('owner_id'),
    revenueType: text('revenue_type').notNull().default('total'),
    submittedCents: money('submitted_cents').notNull().default(0),
    commitCents: money('commit_cents').notNull().default(0),
    bestCaseCents: money('best_case_cents').notNull().default(0),
    pipelineCents: money('pipeline_cents').notNull().default(0),
    closedWonCents: money('closed_won_cents').notNull().default(0),
    /** Delta versus the previous snapshot for the same period. */
    changeSincePriorCents: money('change_since_prior_cents').notNull().default(0),
    payload: jsonb('payload').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('fsnap_period_idx').on(t.fiscalPeriod, t.asOfDate),
    index('fsnap_owner_idx').on(t.ownerId),
  ],
);

/**
 * Nightly per-opportunity snapshot. Pipeline aging, stage progression, slippage
 * and push analysis all read from here — current-state tables cannot answer
 * "what did this deal look like three weeks ago".
 */
export const pipelineSnapshots = pgTable(
  'pipeline_snapshots',
  {
    id: pk('psnap'),
    asOfDate: date('as_of_date').notNull(),
    opportunityId: text('opportunity_id').notNull(),
    accountId: text('account_id').notNull(),
    ownerId: text('owner_id').notNull(),
    stage: opportunityStageEnum('stage').notNull(),
    forecastCategory: forecastCategoryEnum('forecast_category').notNull(),
    type: text('type').notNull(),
    amountCents: money('amount_cents').notNull().default(0),
    arrCents: money('arr_cents').notNull().default(0),
    closeDate: date('close_date').notNull(),
    probabilityBps: bps('probability_bps').notNull().default(0),
    daysInStage: integer('days_in_stage').notNull().default(0),
    fiscalPeriod: text('fiscal_period').notNull(),
    isClosed: boolean('is_closed').notNull().default(false),
    isWon: boolean('is_won').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('psnap_date_idx').on(t.asOfDate),
    index('psnap_opp_idx').on(t.opportunityId, t.asOfDate),
    index('psnap_period_idx').on(t.fiscalPeriod),
  ],
);

/** Point-in-time ARR by account, for cohort and retention analysis. */
export const arrSnapshots = pgTable(
  'arr_snapshots',
  {
    id: pk('asnap'),
    asOfDate: date('as_of_date').notNull(),
    accountId: text('account_id').notNull(),
    subscriptionId: text('subscription_id'),
    arrCents: money('arr_cents').notNull().default(0),
    /** Month the account first became a customer, e.g. '2024-03'. */
    cohortMonth: text('cohort_month'),
    tier: text('tier'),
    region: text('region'),
    industry: text('industry'),
    productFamilies: jsonb('product_families').notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    index('asnap_date_idx').on(t.asOfDate),
    index('asnap_account_idx').on(t.accountId, t.asOfDate),
    index('asnap_cohort_idx').on(t.cohortMonth),
  ],
);
