import { pgEnum } from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ pipeline */

/**
 * The nine configured opportunity stages. Stored as the literal stage key so
 * reports and the MCP layer read naturally; ordinal position and exit criteria
 * live in `src/domain/stages.ts`.
 */
export const opportunityStageEnum = pgEnum('opportunity_stage', [
  'srl',
  'discovery',
  'solution_design',
  'proposal',
  'negotiation',
  'contract',
  'closed_won',
  're_nurture',
  'closed_lost',
]);

export const opportunityTypeEnum = pgEnum('opportunity_type', [
  'new_logo',
  'upsell',
  'cross_sell',
  'renewal',
  'contraction',
  'churn',
]);

export const forecastCategoryEnum = pgEnum('forecast_category', [
  'commit',
  'best_case',
  'pipeline',
  'omitted',
  'closed',
]);

export const revenueTypeEnum = pgEnum('revenue_type', [
  'new',
  'expansion',
  'renewal',
  'total',
]);

/* ------------------------------------------------------------------ accounts */

export const accountTypeEnum = pgEnum('account_type', [
  'global',
  'regional',
  'subsidiary',
  'division',
  'site',
]);

export const accountRelationshipTypeEnum = pgEnum('account_relationship_type', [
  'parent',
  'sold_to',
  'bill_to',
  'ship_to',
  'partner',
  'end_customer',
  'reseller',
  'distributor',
]);

export const lifecycleStageEnum = pgEnum('lifecycle_stage', [
  'prospect',
  'evaluating',
  'onboarding',
  'adopting',
  'established',
  'at_risk',
  'churned',
]);

export const customerTierEnum = pgEnum('customer_tier', [
  'strategic',
  'enterprise',
  'mid_market',
  'smb',
  'self_serve',
]);

export const coverageModelEnum = pgEnum('coverage_model', [
  'named',
  'pooled',
  'digital',
  'partner_led',
]);

export const contactRoleEnum = pgEnum('contact_role', [
  'decision_maker',
  'champion',
  'administrator',
  'user',
  'procurement',
  'executive_sponsor',
  'technical_evaluator',
  'legal',
  'finance',
  'influencer',
]);

export const stanceEnum = pgEnum('stance', [
  'champion',
  'supporter',
  'neutral',
  'skeptic',
  'blocker',
]);

export const sentimentEnum = pgEnum('sentiment', [
  'very_negative',
  'negative',
  'neutral',
  'positive',
  'very_positive',
]);

export const strengthEnum = pgEnum('relationship_strength', [
  'none',
  'weak',
  'moderate',
  'strong',
  'trusted_advisor',
]);

/* ------------------------------------------------------------------- go-to-market */

export const teamTypeEnum = pgEnum('team_type', [
  'sales',
  'bdr',
  'customer_success',
  'support',
  'renewals',
  'channel',
  'marketing',
  'deal_desk',
  'executive',
  'specialist',
]);

export const territoryTypeEnum = pgEnum('territory_type', [
  'geographic',
  'named_account',
  'industry',
  'overlay',
  'segment',
]);

export const ownerRoleEnum = pgEnum('owner_role', [
  'account_executive',
  'bdr',
  'customer_success_manager',
  'support_engineer',
  'renewal_manager',
  'channel_manager',
  'solutions_engineer',
  'executive_sponsor',
]);

export const leadStatusEnum = pgEnum('lead_status', [
  'new',
  'working',
  'mql',
  'accepted',
  'rejected',
  'nurture',
  'converted',
  'disqualified',
]);

export const campaignTypeEnum = pgEnum('campaign_type', [
  'webinar',
  'event',
  'content',
  'paid_search',
  'paid_social',
  'email',
  'outbound',
  'partner',
  'referral',
  'product_led',
  'field',
]);

export const responseTypeEnum = pgEnum('response_type', [
  'form_fill',
  'event_registration',
  'event_attendance',
  'content_download',
  'webinar_attendance',
  'chat',
  'intent_surge',
  'inbound_call',
  'outbound_reply',
  'partner_referral',
  'demo_request',
  'trial_signup',
]);

export const attributionModelEnum = pgEnum('attribution_model', [
  'first_touch',
  'last_touch',
  'linear',
  'time_decay',
  'opportunity_creation',
  'w_shaped',
]);

/* ----------------------------------------------------------------- commercial */

export const productTypeEnum = pgEnum('product_type', [
  'platform',
  'edition',
  'module',
  'add_on',
  'usage',
  'service',
  'support',
  'bundle',
]);

export const billingModelEnum = pgEnum('billing_model', [
  'per_user',
  'flat_fee',
  'usage_based',
  'tiered',
  'platform_fee',
  'one_time',
]);

export const billingFrequencyEnum = pgEnum('billing_frequency', [
  'monthly',
  'quarterly',
  'semi_annual',
  'annual',
  'upfront',
]);

export const quoteStatusEnum = pgEnum('quote_status', [
  'draft',
  'in_approval',
  'approved',
  'rejected',
  'presented',
  'accepted',
  'expired',
  'superseded',
]);

export const lineActionEnum = pgEnum('line_action', [
  'add',
  'remove',
  'increase',
  'decrease',
  'renew',
  'price_change',
  'no_change',
]);

export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'recalled',
  'escalated',
  'auto_approved',
]);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'pending',
  'active',
  'suspended',
  'cancelled',
  'expired',
  'renewed',
]);

export const amendmentTypeEnum = pgEnum('amendment_type', [
  'upsell',
  'cross_sell',
  'contraction',
  'renewal',
  'cancellation',
  'price_change',
  'co_term_add',
  'true_up',
]);

export const arrMovementTypeEnum = pgEnum('arr_movement_type', [
  'new',
  'expansion',
  'uplift',
  'contraction',
  'churn',
  'renewal',
]);

export const renewalStatusEnum = pgEnum('renewal_status', [
  'not_started',
  'in_progress',
  'quoted',
  'committed',
  'renewed',
  'churned',
  'contracted',
  'auto_renewed',
]);

export const riskLevelEnum = pgEnum('risk_level', ['low', 'medium', 'high', 'critical']);

/* -------------------------------------------------------------------- service */

export const caseStatusEnum = pgEnum('case_status', [
  'new',
  'open',
  'pending_customer',
  'escalated',
  'resolved',
  'closed',
]);

export const caseTypeEnum = pgEnum('case_type', [
  'question',
  'defect',
  'incident',
  'feature_request',
  'onboarding',
  'billing',
  'professional_services',
]);

/* ------------------------------------------------------------------- platform */

export const auditActionEnum = pgEnum('audit_action', [
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'approve',
  'reject',
  'convert',
  'book',
  'export',
  'override',
  'ai_action',
]);

export const workflowTriggerEnum = pgEnum('workflow_trigger', [
  'on_create',
  'on_update',
  'on_field_change',
  'scheduled',
  'time_based',
  'manual',
]);

export const runStatusEnum = pgEnum('run_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'retrying',
  'dead_letter',
  'skipped',
]);

export const integrationDirectionEnum = pgEnum('integration_direction', [
  'inbound',
  'outbound',
  'bidirectional',
]);

export const activityTypeEnum = pgEnum('activity_type', [
  'email',
  'call',
  'meeting',
  'note',
  'demo',
  'chat',
  'sales_engagement',
  'support_interaction',
  'business_review',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'open',
  'in_progress',
  'waiting',
  'completed',
  'cancelled',
]);

export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high', 'urgent']);

export const genericStatusEnum = pgEnum('generic_status', [
  'not_started',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
]);

export const healthBandEnum = pgEnum('health_band', [
  'critical',
  'poor',
  'fair',
  'good',
  'excellent',
]);

export const partnerTierEnum = pgEnum('partner_tier', [
  'registered',
  'silver',
  'gold',
  'platinum',
  'distributor',
  'oem',
]);

export const dealRegistrationStatusEnum = pgEnum('deal_registration_status', [
  'submitted',
  'approved',
  'rejected',
  'expired',
  'converted',
  'conflict',
]);

export const usageSignalTypeEnum = pgEnum('usage_signal_type', [
  'product_qualified_lead',
  'expansion_signal',
  'churn_risk',
  'threshold_breach',
  'adoption_stall',
  'admin_inactivity',
]);

export const aiInsightKindEnum = pgEnum('ai_insight_kind', [
  'opportunity_risk',
  'forecast_risk',
  'renewal_likelihood',
  'churn_signal',
  'expansion_signal',
  'next_best_action',
  'missing_data',
  'duplicate',
  'relationship_gap',
  'meeting_prep',
  'summary',
]);
