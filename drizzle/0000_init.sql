CREATE TYPE "public"."account_relationship_type" AS ENUM('parent', 'sold_to', 'bill_to', 'ship_to', 'partner', 'end_customer', 'reseller', 'distributor');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('global', 'regional', 'subsidiary', 'division', 'site');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('email', 'call', 'meeting', 'note', 'demo', 'chat', 'sales_engagement', 'support_interaction', 'business_review');--> statement-breakpoint
CREATE TYPE "public"."ai_insight_kind" AS ENUM('opportunity_risk', 'forecast_risk', 'renewal_likelihood', 'churn_signal', 'expansion_signal', 'next_best_action', 'missing_data', 'duplicate', 'relationship_gap', 'meeting_prep', 'summary');--> statement-breakpoint
CREATE TYPE "public"."amendment_type" AS ENUM('upsell', 'cross_sell', 'contraction', 'renewal', 'cancellation', 'price_change', 'co_term_add', 'true_up');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'recalled', 'escalated', 'auto_approved');--> statement-breakpoint
CREATE TYPE "public"."arr_movement_type" AS ENUM('new', 'expansion', 'uplift', 'contraction', 'churn', 'renewal');--> statement-breakpoint
CREATE TYPE "public"."attribution_model" AS ENUM('first_touch', 'last_touch', 'linear', 'time_decay', 'opportunity_creation', 'w_shaped');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'login', 'logout', 'approve', 'reject', 'convert', 'book', 'export', 'override', 'ai_action');--> statement-breakpoint
CREATE TYPE "public"."billing_frequency" AS ENUM('monthly', 'quarterly', 'semi_annual', 'annual', 'upfront');--> statement-breakpoint
CREATE TYPE "public"."billing_model" AS ENUM('per_user', 'flat_fee', 'usage_based', 'tiered', 'platform_fee', 'one_time');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('webinar', 'event', 'content', 'paid_search', 'paid_social', 'email', 'outbound', 'partner', 'referral', 'product_led', 'field');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('new', 'open', 'pending_customer', 'escalated', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."case_type" AS ENUM('question', 'defect', 'incident', 'feature_request', 'onboarding', 'billing', 'professional_services');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('decision_maker', 'champion', 'administrator', 'user', 'procurement', 'executive_sponsor', 'technical_evaluator', 'legal', 'finance', 'influencer');--> statement-breakpoint
CREATE TYPE "public"."coverage_model" AS ENUM('named', 'pooled', 'digital', 'partner_led');--> statement-breakpoint
CREATE TYPE "public"."customer_tier" AS ENUM('strategic', 'enterprise', 'mid_market', 'smb', 'self_serve');--> statement-breakpoint
CREATE TYPE "public"."deal_registration_status" AS ENUM('submitted', 'approved', 'rejected', 'expired', 'converted', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."forecast_category" AS ENUM('commit', 'best_case', 'pipeline', 'omitted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."generic_status" AS ENUM('not_started', 'in_progress', 'blocked', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."health_band" AS ENUM('critical', 'poor', 'fair', 'good', 'excellent');--> statement-breakpoint
CREATE TYPE "public"."integration_direction" AS ENUM('inbound', 'outbound', 'bidirectional');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'working', 'mql', 'accepted', 'rejected', 'nurture', 'converted', 'disqualified');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_stage" AS ENUM('prospect', 'evaluating', 'onboarding', 'adopting', 'established', 'at_risk', 'churned');--> statement-breakpoint
CREATE TYPE "public"."line_action" AS ENUM('add', 'remove', 'increase', 'decrease', 'renew', 'price_change', 'no_change');--> statement-breakpoint
CREATE TYPE "public"."opportunity_stage" AS ENUM('srl', 'discovery', 'solution_design', 'proposal', 'negotiation', 'contract', 'closed_won', 're_nurture', 'closed_lost');--> statement-breakpoint
CREATE TYPE "public"."opportunity_type" AS ENUM('new_logo', 'upsell', 'cross_sell', 'renewal', 'contraction', 'churn');--> statement-breakpoint
CREATE TYPE "public"."owner_role" AS ENUM('account_executive', 'bdr', 'customer_success_manager', 'support_engineer', 'renewal_manager', 'channel_manager', 'solutions_engineer', 'executive_sponsor');--> statement-breakpoint
CREATE TYPE "public"."partner_tier" AS ENUM('registered', 'silver', 'gold', 'platinum', 'distributor', 'oem');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('platform', 'edition', 'module', 'add_on', 'usage', 'service', 'support', 'bundle');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'in_approval', 'approved', 'rejected', 'presented', 'accepted', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."renewal_status" AS ENUM('not_started', 'in_progress', 'quoted', 'committed', 'renewed', 'churned', 'contracted', 'auto_renewed');--> statement-breakpoint
CREATE TYPE "public"."response_type" AS ENUM('form_fill', 'event_registration', 'event_attendance', 'content_download', 'webinar_attendance', 'chat', 'intent_surge', 'inbound_call', 'outbound_reply', 'partner_referral', 'demo_request', 'trial_signup');--> statement-breakpoint
CREATE TYPE "public"."revenue_type" AS ENUM('new', 'expansion', 'renewal', 'total');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'retrying', 'dead_letter', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('very_negative', 'negative', 'neutral', 'positive', 'very_positive');--> statement-breakpoint
CREATE TYPE "public"."stance" AS ENUM('champion', 'supporter', 'neutral', 'skeptic', 'blocker');--> statement-breakpoint
CREATE TYPE "public"."relationship_strength" AS ENUM('none', 'weak', 'moderate', 'strong', 'trusted_advisor');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending', 'active', 'suspended', 'cancelled', 'expired', 'renewed');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'waiting', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."team_type" AS ENUM('sales', 'bdr', 'customer_success', 'support', 'renewals', 'channel', 'marketing', 'deal_desk', 'executive', 'specialist');--> statement-breakpoint
CREATE TYPE "public"."territory_type" AS ENUM('geographic', 'named_account', 'industry', 'overlay', 'segment');--> statement-breakpoint
CREATE TYPE "public"."usage_signal_type" AS ENUM('product_qualified_lead', 'expansion_signal', 'churn_risk', 'threshold_breach', 'adoption_stall', 'admin_inactivity');--> statement-breakpoint
CREATE TYPE "public"."workflow_trigger" AS ENUM('on_create', 'on_update', 'on_field_change', 'scheduled', 'time_based', 'manual');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"record_id" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"user_id" text,
	"source" text DEFAULT 'ui' NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_ids" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"record_id" text NOT NULL,
	"system" text NOT NULL,
	"external_id" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text DEFAULT 'USD' NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"level" "priority" DEFAULT 'medium' NOT NULL,
	"link" text,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_history" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"record_id" text NOT NULL,
	"role" "owner_role" NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotas" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"team_id" text,
	"territory_id" text,
	"fiscal_period" text NOT NULL,
	"period_type" text DEFAULT 'quarter' NOT NULL,
	"metric" text DEFAULT 'new_arr' NOT NULL,
	"target_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_security" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discount_authority_bps" integer DEFAULT 0 NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "team_type" NOT NULL,
	"parent_team_id" text,
	"manager_id" text,
	"region" text,
	"segment" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "territories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "territory_type" NOT NULL,
	"parent_territory_id" text,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "territory_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"territory_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "owner_role" NOT NULL,
	"is_temporary_coverage" boolean DEFAULT false NOT NULL,
	"covering_for_user_id" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"password_hash" text NOT NULL,
	"role_id" text NOT NULL,
	"team_id" text,
	"manager_id" text,
	"region" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_integration_user" boolean DEFAULT false NOT NULL,
	"routing_weight" integer DEFAULT 1 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "account_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"from_account_id" text NOT NULL,
	"to_account_id" text NOT NULL,
	"type" "account_relationship_type" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "account_team" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "owner_role" NOT NULL,
	"access_level" text DEFAULT 'read' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"type" "account_type" DEFAULT 'global' NOT NULL,
	"parent_account_id" text,
	"ultimate_parent_account_id" text,
	"hierarchy_depth" integer DEFAULT 0 NOT NULL,
	"domain" text,
	"website" text,
	"phone" text,
	"region" text,
	"country" text,
	"state" text,
	"city" text,
	"industry" text,
	"sub_industry" text,
	"employee_count" integer,
	"size_band" text,
	"annual_revenue_cents" bigint,
	"tier" "customer_tier" DEFAULT 'mid_market' NOT NULL,
	"coverage_model" "coverage_model" DEFAULT 'named' NOT NULL,
	"potential_arr_cents" bigint,
	"potential_band" text,
	"lifecycle_stage" "lifecycle_stage" DEFAULT 'prospect' NOT NULL,
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_partner" boolean DEFAULT false NOT NULL,
	"is_competitor" boolean DEFAULT false NOT NULL,
	"customer_since" date,
	"churned_at" date,
	"currency" text DEFAULT 'USD' NOT NULL,
	"current_arr_cents" bigint DEFAULT 0 NOT NULL,
	"open_pipeline_cents" bigint DEFAULT 0 NOT NULL,
	"health_score" integer,
	"health_band" "health_band",
	"health_trend" integer,
	"sentiment" "sentiment",
	"nps_score" integer,
	"csat_score" integer,
	"renewal_risk_level" text,
	"owner_id" text,
	"account_executive_id" text,
	"bdr_id" text,
	"csm_id" text,
	"renewal_manager_id" text,
	"support_owner_id" text,
	"channel_manager_id" text,
	"executive_sponsor_id" text,
	"territory_id" text,
	"original_source" text,
	"original_source_detail" text,
	"latest_source" text,
	"original_campaign_id" text,
	"description" text,
	"privacy_regime" text DEFAULT 'none' NOT NULL,
	"data_retention_until" date,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"billing_contact_id" text,
	"payment_terms" text DEFAULT 'net_30' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_status" text DEFAULT 'current' NOT NULL,
	"dunning_status" text,
	"outstanding_cents" bigint DEFAULT 0 NOT NULL,
	"past_due_cents" bigint DEFAULT 0 NOT NULL,
	"tax_id" text,
	"purchase_order_required" boolean DEFAULT false NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"external_billing_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "buying_committee_members" (
	"id" text PRIMARY KEY NOT NULL,
	"committee_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"role" "contact_role" NOT NULL,
	"stance" "stance" DEFAULT 'neutral' NOT NULL,
	"influence_level" integer DEFAULT 3 NOT NULL,
	"is_economic_buyer" boolean DEFAULT false NOT NULL,
	"engagement_score" integer DEFAULT 0 NOT NULL,
	"last_engaged_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "buying_committees" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"opportunity_id" text,
	"name" text NOT NULL,
	"coverage_bps" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"lead_id" text,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"legal_basis" text DEFAULT 'consent' NOT NULL,
	"region" text,
	"source" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"from_contact_id" text NOT NULL,
	"to_contact_id" text NOT NULL,
	"type" text NOT NULL,
	"strength" "relationship_strength" DEFAULT 'moderate' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"mobile" text,
	"title" text,
	"department" text,
	"seniority" text,
	"role_type" "contact_role" DEFAULT 'user' NOT NULL,
	"reports_to_contact_id" text,
	"relationship_strength" "relationship_strength" DEFAULT 'none' NOT NULL,
	"sentiment" "sentiment" DEFAULT 'neutral' NOT NULL,
	"engagement_score" integer DEFAULT 0 NOT NULL,
	"last_engaged_at" timestamp with time zone,
	"last_customer_response_at" timestamp with time zone,
	"next_meeting_at" timestamp with time zone,
	"influence_level" integer DEFAULT 3 NOT NULL,
	"is_champion" boolean DEFAULT false NOT NULL,
	"has_left_company" boolean DEFAULT false NOT NULL,
	"departed_at" date,
	"fit_score" integer DEFAULT 0 NOT NULL,
	"intent_score" integer DEFAULT 0 NOT NULL,
	"total_score" integer DEFAULT 0 NOT NULL,
	"grade" text,
	"original_source" text,
	"latest_source" text,
	"original_campaign_id" text,
	"email_opt_in" boolean DEFAULT true NOT NULL,
	"do_not_call" boolean DEFAULT false NOT NULL,
	"privacy_regime" text DEFAULT 'none' NOT NULL,
	"owner_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_billing_contact" boolean DEFAULT false NOT NULL,
	"country" text,
	"timezone" text,
	"linkedin_url" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "attribution_touches" (
	"id" text PRIMARY KEY NOT NULL,
	"model" "attribution_model" NOT NULL,
	"campaign_id" text,
	"campaign_response_id" text,
	"source_category" text DEFAULT 'marketing' NOT NULL,
	"contact_id" text,
	"account_id" text,
	"opportunity_id" text,
	"subscription_id" text,
	"credit_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"weight_bps" integer NOT NULL,
	"credited_pipeline_cents" bigint DEFAULT 0 NOT NULL,
	"credited_arr_cents" bigint DEFAULT 0 NOT NULL,
	"credited_revenue_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_members" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"lead_id" text,
	"contact_id" text,
	"account_id" text,
	"status" text DEFAULT 'targeted' NOT NULL,
	"has_responded" boolean DEFAULT false NOT NULL,
	"first_responded_at" timestamp with time zone,
	"last_responded_at" timestamp with time zone,
	"response_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "campaign_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_member_id" text,
	"lead_id" text,
	"contact_id" text,
	"account_id" text,
	"type" "response_type" NOT NULL,
	"channel" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"score_value" integer DEFAULT 0 NOT NULL,
	"detail" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "campaign_type" NOT NULL,
	"channel" text,
	"parent_campaign_id" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"end_date" date,
	"budget_cents" bigint DEFAULT 0 NOT NULL,
	"actual_cost_cents" bigint DEFAULT 0 NOT NULL,
	"attribution_window_days" integer DEFAULT 90 NOT NULL,
	"target_segment" text,
	"target_region" text,
	"owner_id" text,
	"is_partner_campaign" boolean DEFAULT false NOT NULL,
	"partner_account_id" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"company" text,
	"title" text,
	"website" text,
	"country" text,
	"state" text,
	"region" text,
	"industry" text,
	"employee_count" integer,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'form' NOT NULL,
	"source_detail" text,
	"campaign_id" text,
	"fit_score" integer DEFAULT 0 NOT NULL,
	"intent_score" integer DEFAULT 0 NOT NULL,
	"engagement_score" integer DEFAULT 0 NOT NULL,
	"behavioral_score" integer DEFAULT 0 NOT NULL,
	"negative_score" integer DEFAULT 0 NOT NULL,
	"total_score" integer DEFAULT 0 NOT NULL,
	"grade" text,
	"score_decayed_at" timestamp with time zone,
	"mql_at" timestamp with time zone,
	"owner_id" text,
	"territory_id" text,
	"routing_rule_id" text,
	"assigned_at" timestamp with time zone,
	"sla_minutes" integer,
	"sla_due_at" timestamp with time zone,
	"first_touched_at" timestamp with time zone,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"disposition" text,
	"nurture_reason" text,
	"sequence_enrolled_at" timestamp with time zone,
	"sequence_name" text,
	"converted_at" timestamp with time zone,
	"converted_contact_id" text,
	"converted_account_id" text,
	"converted_opportunity_id" text,
	"matched_contact_id" text,
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"duplicate_of_lead_id" text,
	"email_opt_in" boolean DEFAULT true NOT NULL,
	"privacy_regime" text DEFAULT 'none' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"object_type" text DEFAULT 'lead' NOT NULL,
	"strategy" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assignee_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignee_team_id" text,
	"territory_id" text,
	"round_robin_cursor" integer DEFAULT 0 NOT NULL,
	"sla_minutes" integer DEFAULT 60 NOT NULL,
	"escalate_to_user_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "mutual_action_plan_items" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"owner_side" text DEFAULT 'vendor' NOT NULL,
	"owner_user_id" text,
	"owner_contact_id" text,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"status" "generic_status" DEFAULT 'not_started' NOT NULL,
	"is_blocker" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "mutual_action_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "generic_status" DEFAULT 'in_progress' NOT NULL,
	"target_go_live_date" date,
	"shared_with_customer_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"account_id" text NOT NULL,
	"type" "opportunity_type" DEFAULT 'new_logo' NOT NULL,
	"stage" "opportunity_stage" DEFAULT 'srl' NOT NULL,
	"forecast_category" "forecast_category" DEFAULT 'pipeline' NOT NULL,
	"probability_bps" integer DEFAULT 1000 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"tcv_cents" bigint DEFAULT 0 NOT NULL,
	"arr_cents" bigint DEFAULT 0 NOT NULL,
	"new_arr_cents" bigint DEFAULT 0 NOT NULL,
	"expansion_arr_cents" bigint DEFAULT 0 NOT NULL,
	"uplift_arr_cents" bigint DEFAULT 0 NOT NULL,
	"contraction_arr_cents" bigint DEFAULT 0 NOT NULL,
	"churn_arr_cents" bigint DEFAULT 0 NOT NULL,
	"term_months" integer DEFAULT 12 NOT NULL,
	"close_date" date NOT NULL,
	"original_close_date" date,
	"push_count" integer DEFAULT 0 NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_step" text,
	"next_meeting_at" timestamp with time zone,
	"close_plan" text,
	"competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"incumbent_product" text,
	"stage_override_reason" text,
	"is_closed" boolean DEFAULT false NOT NULL,
	"is_won" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"loss_reason" text,
	"loss_reason_detail" text,
	"competitor_won_to" text,
	"re_nurture_until" date,
	"owner_id" text NOT NULL,
	"team_id" text,
	"territory_id" text,
	"subscription_id" text,
	"renewal_id" text,
	"prior_opportunity_id" text,
	"is_renewal" boolean DEFAULT false NOT NULL,
	"is_auto_created" boolean DEFAULT false NOT NULL,
	"expected_renewal_arr_cents" bigint,
	"renewal_risk_level" "risk_level",
	"is_co_termed" boolean DEFAULT false NOT NULL,
	"co_term_end_date" date,
	"created_source" text,
	"original_source" text,
	"latest_source" text,
	"primary_campaign_id" text,
	"partner_account_id" text,
	"deal_registration_id" text,
	"channel_motion" text DEFAULT 'direct' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "opportunity_contact_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"role" "contact_role" NOT NULL,
	"stance" "stance" DEFAULT 'neutral' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"influence_level" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "opportunity_products" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"product_id" text NOT NULL,
	"action" "line_action" DEFAULT 'add' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"list_unit_cents" bigint DEFAULT 0 NOT NULL,
	"net_unit_cents" bigint DEFAULT 0 NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"term_months" integer DEFAULT 12 NOT NULL,
	"start_date" date,
	"end_date" date,
	"arr_cents" bigint DEFAULT 0 NOT NULL,
	"tcv_cents" bigint DEFAULT 0 NOT NULL,
	"ramp_schedule" jsonb,
	"replaces_subscription_item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "opportunity_team" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "owner_role" NOT NULL,
	"split_bps" integer DEFAULT 0 NOT NULL,
	"credit_type" text DEFAULT 'primary' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "stage_history" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"from_stage" "opportunity_stage",
	"to_stage" "opportunity_stage" NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone,
	"duration_days" integer,
	"amount_at_transition_cents" bigint,
	"close_date_at_transition" date,
	"user_id" text,
	"was_overridden" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"record_id" text NOT NULL,
	"kind" text DEFAULT 'discount' NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by_id" text NOT NULL,
	"justification" text,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"policy_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"total_steps" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"sla_due_at" timestamp with time zone,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"approver_role_key" text NOT NULL,
	"approver_user_id" text,
	"decided_by_user_id" text,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"threshold_bps" integer,
	"comments" text,
	"sla_due_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"escalated_to_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"account_id" text NOT NULL,
	"order_id" text,
	"quote_id" text,
	"parent_contract_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"term_months" integer DEFAULT 12 NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"notice_days" integer DEFAULT 60 NOT NULL,
	"notice_date" date,
	"uplift_bps" integer DEFAULT 500 NOT NULL,
	"uplift_cap_bps" integer,
	"signed_at" timestamp with time zone,
	"signed_by_contact_id" text,
	"document_url" text,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"redline_status" text,
	"governing_law" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "contracts_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "discount_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL,
	"threshold_bps" integer NOT NULL,
	"approver_role_key" text NOT NULL,
	"applies_to_product_family" text,
	"applies_to_opportunity_type" text,
	"min_amount_cents" bigint,
	"triggers_on_non_standard_terms" boolean DEFAULT false NOT NULL,
	"sla_hours" integer DEFAULT 24 NOT NULL,
	"escalate_to_role_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"billing_account_id" text NOT NULL,
	"account_id" text NOT NULL,
	"subscription_id" text,
	"order_id" text,
	"status" text DEFAULT 'issued' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"period_start" date,
	"period_end" date,
	"issued_at" date NOT NULL,
	"due_at" date,
	"paid_at" date,
	"external_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"quote_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"arr_cents" bigint DEFAULT 0 NOT NULL,
	"tcv_cents" bigint DEFAULT 0 NOT NULL,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"booked_by_id" text,
	"auto_booked" boolean DEFAULT false NOT NULL,
	"contract_id" text,
	"subscription_id" text,
	"external_erp_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "price_book_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"price_book_id" text NOT NULL,
	"product_id" text NOT NULL,
	"list_unit_cents" bigint NOT NULL,
	"min_quantity" integer DEFAULT 1 NOT NULL,
	"max_quantity" integer,
	"term_months" integer DEFAULT 12 NOT NULL,
	"multi_year_discount_bps" integer DEFAULT 0 NOT NULL,
	"included_volume" integer,
	"overage_unit_cents" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "price_books" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"market" text DEFAULT 'GLOBAL' NOT NULL,
	"kind" text DEFAULT 'standard' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"partner_tier" text,
	"effective_from" date,
	"effective_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "product_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"bundle_product_id" text NOT NULL,
	"component_product_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"allocation_bps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"family" text NOT NULL,
	"type" "product_type" NOT NULL,
	"billing_model" "billing_model" DEFAULT 'per_user' NOT NULL,
	"unit_of_measure" text DEFAULT 'seat' NOT NULL,
	"is_recurring" boolean DEFAULT true NOT NULL,
	"edition_rank" integer,
	"revenue_category" text DEFAULT 'subscription' NOT NULL,
	"requires_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excludes_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entitlement_template" jsonb,
	"default_term_months" integer DEFAULT 12 NOT NULL,
	"max_discount_bps" integer DEFAULT 2000 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"product_id" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"action" "line_action" DEFAULT 'add' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"prior_quantity" integer,
	"list_unit_cents" bigint DEFAULT 0 NOT NULL,
	"net_unit_cents" bigint DEFAULT 0 NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"program_discount_bps" integer DEFAULT 0 NOT NULL,
	"discount_reason" text,
	"term_months" integer DEFAULT 12 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"proration_factor_bps" integer DEFAULT 10000 NOT NULL,
	"arr_cents" bigint DEFAULT 0 NOT NULL,
	"annualized_arr_cents" bigint DEFAULT 0 NOT NULL,
	"prorated_amount_cents" bigint DEFAULT 0 NOT NULL,
	"tcv_cents" bigint DEFAULT 0 NOT NULL,
	"ramp_schedule" jsonb,
	"min_commit_volume" integer,
	"overage_unit_cents" bigint,
	"replaces_subscription_item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"account_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_quote_id" text,
	"is_primary" boolean DEFAULT true NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"price_book_id" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"term_months" integer DEFAULT 12 NOT NULL,
	"billing_frequency" "billing_frequency" DEFAULT 'annual' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"co_term_subscription_id" text,
	"is_co_termed" boolean DEFAULT false NOT NULL,
	"proration_factor_bps" integer DEFAULT 10000 NOT NULL,
	"list_total_cents" bigint DEFAULT 0 NOT NULL,
	"discount_total_cents" bigint DEFAULT 0 NOT NULL,
	"net_total_cents" bigint DEFAULT 0 NOT NULL,
	"effective_discount_bps" integer DEFAULT 0 NOT NULL,
	"arr_cents" bigint DEFAULT 0 NOT NULL,
	"annualized_arr_cents" bigint DEFAULT 0 NOT NULL,
	"tcv_cents" bigint DEFAULT 0 NOT NULL,
	"prorated_amount_cents" bigint DEFAULT 0 NOT NULL,
	"has_non_standard_terms" boolean DEFAULT false NOT NULL,
	"non_standard_terms_detail" text,
	"payment_terms" text DEFAULT 'net_30' NOT NULL,
	"approval_request_id" text,
	"approved_at" timestamp with time zone,
	"approved_by_id" text,
	"presented_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"expires_at" date,
	"e_sign_status" text DEFAULT 'none' NOT NULL,
	"e_sign_envelope_id" text,
	"e_sign_sent_at" timestamp with time zone,
	"e_sign_completed_at" timestamp with time zone,
	"document_url" text,
	"owner_id" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "quotes_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "arr_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"subscription_id" text,
	"amendment_id" text,
	"opportunity_id" text,
	"renewal_id" text,
	"type" "arr_movement_type" NOT NULL,
	"arr_delta_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"arr_delta_base_cents" bigint DEFAULT 0 NOT NULL,
	"effective_date" date NOT NULL,
	"fiscal_period" text NOT NULL,
	"fiscal_quarter" text NOT NULL,
	"product_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"subscription_item_id" text,
	"account_id" text NOT NULL,
	"product_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"limit_value" integer,
	"unit_of_measure" text,
	"support_level" text,
	"first_response_sla_minutes" integer,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "product_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"subscription_id" text,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"region" text,
	"version" text,
	"status" text DEFAULT 'active' NOT NULL,
	"external_tenant_id" text,
	"provisioned_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "renewals" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"account_id" text NOT NULL,
	"opportunity_id" text,
	"status" "renewal_status" DEFAULT 'not_started' NOT NULL,
	"renewal_date" date NOT NULL,
	"notice_date" date,
	"term_months" integer DEFAULT 12 NOT NULL,
	"current_arr_cents" bigint DEFAULT 0 NOT NULL,
	"renewable_arr_cents" bigint DEFAULT 0 NOT NULL,
	"co_termed_additions_arr_cents" bigint DEFAULT 0 NOT NULL,
	"uplift_bps" integer DEFAULT 500 NOT NULL,
	"uplift_arr_cents" bigint DEFAULT 0 NOT NULL,
	"expected_arr_cents" bigint DEFAULT 0 NOT NULL,
	"forecast_category" "forecast_category" DEFAULT 'pipeline' NOT NULL,
	"upside_arr_cents" bigint DEFAULT 0 NOT NULL,
	"downside_arr_cents" bigint DEFAULT 0 NOT NULL,
	"churn_risk_arr_cents" bigint DEFAULT 0 NOT NULL,
	"renewal_likelihood_bps" integer,
	"risk_level" "risk_level" DEFAULT 'low' NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"cancellation_notice_received_at" timestamp with time zone,
	"multi_year_option_offered" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"escalated_to_user_id" text,
	"escalated_at" timestamp with time zone,
	"playbook_id" text,
	"closed_arr_cents" bigint,
	"closed_at" timestamp with time zone,
	"owner_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "subscription_amendments" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"subscription_id" text NOT NULL,
	"type" "amendment_type" NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"opportunity_id" text,
	"quote_id" text,
	"order_id" text,
	"effective_date" date NOT NULL,
	"co_term_end_date" date,
	"is_co_termed" boolean DEFAULT false NOT NULL,
	"proration_factor_bps" integer DEFAULT 10000 NOT NULL,
	"remaining_days" integer,
	"delta_arr_cents" bigint DEFAULT 0 NOT NULL,
	"annualized_arr_cents" bigint DEFAULT 0 NOT NULL,
	"prorated_amount_cents" bigint DEFAULT 0 NOT NULL,
	"arr_before_cents" bigint DEFAULT 0 NOT NULL,
	"arr_after_cents" bigint DEFAULT 0 NOT NULL,
	"applied_to_renewal_opportunity_id" text,
	"applied_to_renewal_id" text,
	"applied_to_renewal_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "subscription_amendments_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "subscription_items" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"product_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"list_unit_cents" bigint DEFAULT 0 NOT NULL,
	"net_unit_cents" bigint DEFAULT 0 NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"arr_cents" bigint DEFAULT 0 NOT NULL,
	"mrr_cents" bigint DEFAULT 0 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_co_termed" boolean DEFAULT false NOT NULL,
	"proration_factor_bps" integer DEFAULT 10000 NOT NULL,
	"annualized_arr_cents" bigint DEFAULT 0 NOT NULL,
	"min_commit_volume" integer,
	"included_volume" integer,
	"overage_unit_cents" bigint,
	"ramp_schedule" jsonb,
	"added_by_amendment_id" text,
	"removed_by_amendment_id" text,
	"removed_at" timestamp with time zone,
	"source_quote_line_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"account_id" text NOT NULL,
	"contract_id" text,
	"billing_account_id" text,
	"predecessor_subscription_id" text,
	"successor_subscription_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"term_months" integer DEFAULT 12 NOT NULL,
	"billing_frequency" "billing_frequency" DEFAULT 'annual' NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"notice_days" integer DEFAULT 60 NOT NULL,
	"notice_date" date,
	"uplift_bps" integer DEFAULT 500 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"original_arr_cents" bigint DEFAULT 0 NOT NULL,
	"original_tcv_cents" bigint DEFAULT 0 NOT NULL,
	"current_arr_cents" bigint DEFAULT 0 NOT NULL,
	"current_mrr_cents" bigint DEFAULT 0 NOT NULL,
	"current_tcv_cents" bigint DEFAULT 0 NOT NULL,
	"remaining_contract_value_cents" bigint DEFAULT 0 NOT NULL,
	"co_termed_additions_arr_cents" bigint DEFAULT 0 NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	"cancellation_effective_date" date,
	"cancellation_reason" text,
	"churned_at" date,
	"renewal_owner_id" text,
	"csm_id" text,
	"partner_account_id" text,
	"originating_opportunity_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "subscriptions_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "business_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"success_plan_id" text,
	"type" text DEFAULT 'QBR' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"held_at" timestamp with time zone,
	"attendee_contact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attendee_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"executive_attended" boolean DEFAULT false NOT NULL,
	"outcomes" text,
	"sentiment" "sentiment",
	"deck_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "calls_to_action" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"subscription_id" text,
	"renewal_id" text,
	"risk_id" text,
	"playbook_run_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "generic_status" DEFAULT 'not_started' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "health_models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"segment" text,
	"tier" text,
	"lifecycle_stage" text,
	"weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "health_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"model_id" text NOT NULL,
	"as_of_date" date NOT NULL,
	"overall" integer NOT NULL,
	"band" "health_band" NOT NULL,
	"confidence_bps" integer DEFAULT 10000 NOT NULL,
	"previous_overall" integer,
	"delta" integer DEFAULT 0 NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"playbook_id" text NOT NULL,
	"object_type" text NOT NULL,
	"record_id" text NOT NULL,
	"account_id" text,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"owner_id" text,
	"steps_total" integer DEFAULT 0 NOT NULL,
	"steps_completed" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "playbooks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"trigger" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"subscription_id" text,
	"renewal_id" text,
	"opportunity_id" text,
	"type" text NOT NULL,
	"severity" "risk_level" DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"mitigation_plan" text,
	"save_play_id" text,
	"arr_at_risk_cents" bigint DEFAULT 0 NOT NULL,
	"owner_id" text,
	"identified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_date" date,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"escalated_to_user_id" text,
	"escalated_at" timestamp with time zone,
	"detected_by" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "success_plan_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"objective_id" text,
	"name" text NOT NULL,
	"phase" text,
	"sequence" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"status" "generic_status" DEFAULT 'not_started' NOT NULL,
	"owner_id" text,
	"is_value_milestone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "success_plan_objectives" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"name" text NOT NULL,
	"desired_outcome" text,
	"metric" text,
	"target_value" text,
	"current_value" text,
	"status" "generic_status" DEFAULT 'not_started' NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"linked_product_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "success_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"subscription_id" text,
	"name" text NOT NULL,
	"status" "generic_status" DEFAULT 'in_progress' NOT NULL,
	"lifecycle_stage" "lifecycle_stage" DEFAULT 'onboarding' NOT NULL,
	"csm_id" text,
	"executive_sponsor_contact_id" text,
	"our_executive_sponsor_id" text,
	"start_date" date,
	"target_go_live_date" date,
	"actual_go_live_date" date,
	"time_to_value_days" integer,
	"onboarding_progress_bps" integer DEFAULT 0 NOT NULL,
	"sentiment" "sentiment" DEFAULT 'neutral' NOT NULL,
	"reference_status" text DEFAULT 'none' NOT NULL,
	"renewal_readiness_bps" integer,
	"last_reviewed_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "usage_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"subscription_id" text,
	"product_id" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"grain" text DEFAULT 'monthly' NOT NULL,
	"licensed_users" integer DEFAULT 0 NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"new_users" integer DEFAULT 0 NOT NULL,
	"churned_users" integer DEFAULT 0 NOT NULL,
	"utilisation_bps" integer DEFAULT 0 NOT NULL,
	"logins" integer DEFAULT 0 NOT NULL,
	"feature_adoption_bps" integer DEFAULT 0 NOT NULL,
	"features_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage_volume" integer DEFAULT 0 NOT NULL,
	"commitment_volume" integer,
	"consumption_bps" integer,
	"overage_volume" integer DEFAULT 0 NOT NULL,
	"admin_actions" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone,
	"days_since_last_activity" integer,
	"trend_bps" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"subscription_id" text,
	"product_id" text,
	"contact_id" text,
	"type" "usage_signal_type" NOT NULL,
	"strength" integer DEFAULT 50 NOT NULL,
	"detail" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"actioned_at" timestamp with time zone,
	"actioned_by_id" text,
	"created_opportunity_id" text,
	"created_risk_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"author_user_id" text,
	"author_contact_id" text,
	"body" text NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_first_response" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"account_id" text NOT NULL,
	"contact_id" text,
	"subscription_id" text,
	"product_id" text,
	"product_instance_id" text,
	"opportunity_id" text,
	"subject" text NOT NULL,
	"description" text,
	"type" "case_type" DEFAULT 'question' NOT NULL,
	"status" "case_status" DEFAULT 'new' NOT NULL,
	"severity" integer DEFAULT 3 NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"channel" text DEFAULT 'portal' NOT NULL,
	"owner_id" text,
	"team_id" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	"entitlement_id" text,
	"entitlement_verified" boolean DEFAULT false NOT NULL,
	"support_level" text,
	"sla_first_response_due_at" timestamp with time zone,
	"sla_resolution_due_at" timestamp with time zone,
	"sla_first_response_breached" boolean DEFAULT false NOT NULL,
	"sla_resolution_breached" boolean DEFAULT false NOT NULL,
	"time_to_first_response_minutes" integer,
	"time_to_resolution_minutes" integer,
	"is_escalated" boolean DEFAULT false NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"escalated_to_user_id" text,
	"escalated_at" timestamp with time zone,
	"executive_visible" boolean DEFAULT false NOT NULL,
	"defect_id" text,
	"is_professional_services" boolean DEFAULT false NOT NULL,
	"services_hours_remaining" integer,
	"sentiment" "sentiment",
	"csat_score" integer,
	"resolution_summary" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "cases_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "product_defects" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"product_id" text,
	"severity" integer DEFAULT 3 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"is_known_limitation" boolean DEFAULT false NOT NULL,
	"affected_versions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_in_version" text,
	"target_fix_date" date,
	"resolved_at" timestamp with time zone,
	"linked_case_count" integer DEFAULT 0 NOT NULL,
	"arr_impacted_cents" bigint DEFAULT 0 NOT NULL,
	"external_issue_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "product_defects_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "deal_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"partner_account_id" text NOT NULL,
	"partner_contact_id" text,
	"end_customer_account_id" text,
	"end_customer_name" text NOT NULL,
	"end_customer_domain" text,
	"end_customer_country" text,
	"opportunity_id" text,
	"status" "deal_registration_status" DEFAULT 'submitted' NOT NULL,
	"estimated_arr_cents" bigint DEFAULT 0 NOT NULL,
	"product_families" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_close_date" date,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_id" text,
	"rejection_reason" text,
	"protection_days" integer DEFAULT 90 NOT NULL,
	"protection_ends_at" date,
	"approved_margin_bps" integer,
	"conflict_with_opportunity_id" text,
	"conflict_with_registration_id" text,
	"conflict_resolution" text,
	"conflict_resolved_by_id" text,
	"conflict_resolved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "deal_registrations_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "partner_lead_distributions" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_account_id" text NOT NULL,
	"lead_id" text,
	"opportunity_id" text,
	"partner_contact_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"sla_hours" integer DEFAULT 48 NOT NULL,
	"sla_due_at" timestamp with time zone,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "partner_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"tier" "partner_tier" DEFAULT 'registered' NOT NULL,
	"program_status" text DEFAULT 'active' NOT NULL,
	"partner_type" text DEFAULT 'reseller' NOT NULL,
	"competencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"territories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"authorised_product_families" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"margin_bps" integer DEFAULT 2000 NOT NULL,
	"referral_fee_bps" integer DEFAULT 1000 NOT NULL,
	"price_book_id" text,
	"renewal_ownership" text DEFAULT 'vendor' NOT NULL,
	"certification_status" text DEFAULT 'none' NOT NULL,
	"certified_engineers" integer DEFAULT 0 NOT NULL,
	"enablement_status" text DEFAULT 'not_started' NOT NULL,
	"last_training_at" date,
	"agreement_url" text,
	"agreement_signed_at" date,
	"agreement_expires_at" date,
	"sourced_arr_cents" bigint DEFAULT 0 NOT NULL,
	"influenced_arr_cents" bigint DEFAULT 0 NOT NULL,
	"managed_arr_cents" bigint DEFAULT 0 NOT NULL,
	"deals_registered" integer DEFAULT 0 NOT NULL,
	"deals_won" integer DEFAULT 0 NOT NULL,
	"scorecard" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel_manager_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "partner_profiles_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "activity_type" NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_minutes" integer,
	"account_id" text,
	"contact_id" text,
	"lead_id" text,
	"opportunity_id" text,
	"case_id" text,
	"subscription_id" text,
	"renewal_id" text,
	"campaign_id" text,
	"participant_contact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"participant_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"sentiment" "sentiment",
	"sentiment_score_bps" integer,
	"summary" text,
	"recording_url" text,
	"transcript" text,
	"objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"competitor_mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commitments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_steps" text,
	"is_customer_response" boolean DEFAULT false NOT NULL,
	"contact_role" "contact_role",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"owner_id" text NOT NULL,
	"account_id" text,
	"contact_id" text,
	"lead_id" text,
	"opportunity_id" text,
	"case_id" text,
	"renewal_id" text,
	"risk_id" text,
	"approval_request_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"workflow_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "arr_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"as_of_date" date NOT NULL,
	"account_id" text NOT NULL,
	"subscription_id" text,
	"arr_cents" bigint DEFAULT 0 NOT NULL,
	"cohort_month" text,
	"tier" text,
	"region" text,
	"industry" text,
	"product_families" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"forecast_id" text,
	"fiscal_period" text NOT NULL,
	"as_of_date" date NOT NULL,
	"level" text NOT NULL,
	"owner_id" text,
	"revenue_type" text DEFAULT 'total' NOT NULL,
	"submitted_cents" bigint DEFAULT 0 NOT NULL,
	"commit_cents" bigint DEFAULT 0 NOT NULL,
	"best_case_cents" bigint DEFAULT 0 NOT NULL,
	"pipeline_cents" bigint DEFAULT 0 NOT NULL,
	"closed_won_cents" bigint DEFAULT 0 NOT NULL,
	"change_since_prior_cents" bigint DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecasts" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text DEFAULT 'rep' NOT NULL,
	"owner_id" text,
	"team_id" text,
	"territory_id" text,
	"product_family" text,
	"segment" text,
	"fiscal_period" text NOT NULL,
	"period_type" text DEFAULT 'quarter' NOT NULL,
	"revenue_type" "revenue_type" DEFAULT 'total' NOT NULL,
	"metric" text DEFAULT 'arr' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"quota_cents" bigint DEFAULT 0 NOT NULL,
	"closed_won_cents" bigint DEFAULT 0 NOT NULL,
	"commit_cents" bigint DEFAULT 0 NOT NULL,
	"best_case_cents" bigint DEFAULT 0 NOT NULL,
	"pipeline_cents" bigint DEFAULT 0 NOT NULL,
	"omitted_cents" bigint DEFAULT 0 NOT NULL,
	"weighted_cents" bigint DEFAULT 0 NOT NULL,
	"judgment_cents" bigint DEFAULT 0 NOT NULL,
	"manager_adjustment_cents" bigint DEFAULT 0 NOT NULL,
	"submitted_cents" bigint DEFAULT 0 NOT NULL,
	"coverage_bps" integer,
	"parent_forecastid" text,
	"is_submitted" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_id" text,
	"commentary" text,
	"deal_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"swaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "pipeline_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"as_of_date" date NOT NULL,
	"opportunity_id" text NOT NULL,
	"account_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"stage" "opportunity_stage" NOT NULL,
	"forecast_category" "forecast_category" NOT NULL,
	"type" text NOT NULL,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"arr_cents" bigint DEFAULT 0 NOT NULL,
	"close_date" date NOT NULL,
	"probability_bps" integer DEFAULT 0 NOT NULL,
	"days_in_stage" integer DEFAULT 0 NOT NULL,
	"fiscal_period" text NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"is_won" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "ai_insight_kind" NOT NULL,
	"object_type" text NOT NULL,
	"record_id" text NOT NULL,
	"account_id" text,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"confidence_bps" integer DEFAULT 5000 NOT NULL,
	"severity" "priority" DEFAULT 'medium' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_action" text,
	"proposed_change" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"model" text DEFAULT 'spoton-heuristics-v1' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"dismiss_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_quality_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"record_id" text NOT NULL,
	"rule_id" text,
	"rule" text NOT NULL,
	"field" text,
	"severity" text DEFAULT 'warning' NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_id" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"record_a_id" text NOT NULL,
	"record_b_id" text NOT NULL,
	"score_bps" integer NOT NULL,
	"matched_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"cross_object" boolean DEFAULT false NOT NULL,
	"other_object_type" text,
	"resolved_by_id" text,
	"resolved_at" timestamp with time zone,
	"survivor_record_id" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"system" text NOT NULL,
	"direction" "integration_direction" DEFAULT 'bidirectional' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"is_mock" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"integration_user_id" text,
	"webhook_url" text,
	"sync_cursor" text,
	"last_sync_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"events_sent" integer DEFAULT 0 NOT NULL,
	"events_failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"direction" "integration_direction" NOT NULL,
	"event_type" text NOT NULL,
	"object_type" text,
	"record_id" text,
	"external_id" text,
	"idempotency_key" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response" jsonb,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"lineage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"object_type" text NOT NULL,
	"kind" text DEFAULT 'table' NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aggregates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_id" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "sla_timers" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"record_id" text NOT NULL,
	"name" text NOT NULL,
	"target_minutes" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"breached_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"paused_minutes" integer DEFAULT 0 NOT NULL,
	"owner_id" text,
	"escalated_to_user_id" text,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"field" text,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applies_from_stage" text,
	"message" text NOT NULL,
	"severity" text DEFAULT 'error' NOT NULL,
	"overridable" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"object_type" text NOT NULL,
	"trigger" "workflow_trigger" NOT NULL,
	"watch_field" text,
	"entry_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"exit_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"offset_days" integer,
	"offset_from_field" text,
	"sla_minutes" integer,
	"owner_user_id" text NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"exception_queue" text DEFAULT 'default' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"definition_id" text NOT NULL,
	"object_type" text NOT NULL,
	"record_id" text NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"scheduled_for" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"error" text,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triggered_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_record_idx" ON "audit_log" USING btree ("object_type","record_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_unique_idx" ON "external_ids" USING btree ("system","object_type","external_id");--> statement-breakpoint
CREATE INDEX "ext_record_idx" ON "external_ids" USING btree ("object_type","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_unique_idx" ON "fx_rates" USING btree ("from_currency","to_currency","effective_from");--> statement-breakpoint
CREATE INDEX "ntf_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "own_record_idx" ON "ownership_history" USING btree ("object_type","record_id");--> statement-breakpoint
CREATE INDEX "quotas_period_idx" ON "quotas" USING btree ("fiscal_period");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tass_territory_idx" ON "territory_assignments" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "tass_user_idx" ON "territory_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_team_idx" ON "users" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "arel_from_idx" ON "account_relationships" USING btree ("from_account_id");--> statement-breakpoint
CREATE INDEX "arel_to_idx" ON "account_relationships" USING btree ("to_account_id");--> statement-breakpoint
CREATE INDEX "atm_account_idx" ON "account_team" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "atm_user_idx" ON "account_team" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "accounts_parent_idx" ON "accounts" USING btree ("parent_account_id");--> statement-breakpoint
CREATE INDEX "accounts_owner_idx" ON "accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "accounts_name_idx" ON "accounts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "accounts_tier_idx" ON "accounts" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "bill_account_idx" ON "billing_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "bmem_committee_idx" ON "buying_committee_members" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "bcom_account_idx" ON "buying_committees" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "bcom_opp_idx" ON "buying_committees" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "cons_contact_idx" ON "consent_records" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "crel_from_idx" ON "contact_relationships" USING btree ("from_contact_id");--> statement-breakpoint
CREATE INDEX "contacts_account_idx" ON "contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contacts_owner_idx" ON "contacts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "attr_model_idx" ON "attribution_touches" USING btree ("model");--> statement-breakpoint
CREATE INDEX "attr_opp_idx" ON "attribution_touches" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "attr_campaign_idx" ON "attribution_touches" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "cmem_campaign_idx" ON "campaign_members" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "cmem_lead_idx" ON "campaign_members" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "cmem_contact_idx" ON "campaign_members" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "crsp_campaign_idx" ON "campaign_responses" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "crsp_contact_idx" ON "campaign_responses" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "crsp_lead_idx" ON "campaign_responses" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "crsp_occurred_idx" ON "campaign_responses" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "cmp_type_idx" ON "campaigns" USING btree ("type");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_score_idx" ON "leads" USING btree ("total_score");--> statement-breakpoint
CREATE INDEX "rrul_object_idx" ON "routing_rules" USING btree ("object_type","priority");--> statement-breakpoint
CREATE INDEX "mapi_plan_idx" ON "mutual_action_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "map_opp_idx" ON "mutual_action_plans" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "opp_account_idx" ON "opportunities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "opp_stage_idx" ON "opportunities" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "opp_owner_idx" ON "opportunities" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "opp_close_idx" ON "opportunities" USING btree ("close_date");--> statement-breakpoint
CREATE INDEX "opp_sub_idx" ON "opportunities" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "ocr_opp_idx" ON "opportunity_contact_roles" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "oppp_opp_idx" ON "opportunity_products" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "otm_opp_idx" ON "opportunity_team" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "sthx_opp_idx" ON "stage_history" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "apr_record_idx" ON "approval_requests" USING btree ("object_type","record_id");--> statement-breakpoint
CREATE INDEX "apr_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "aprs_request_idx" ON "approval_steps" USING btree ("request_id","sequence");--> statement-breakpoint
CREATE INDEX "aprs_approver_idx" ON "approval_steps" USING btree ("approver_user_id");--> statement-breakpoint
CREATE INDEX "ctr_account_idx" ON "contracts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ctr_end_idx" ON "contracts" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "dpol_seq_idx" ON "discount_policies" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "inv_account_idx" ON "invoices" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "inv_sub_idx" ON "invoices" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "ord_account_idx" ON "orders" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "pbe_book_idx" ON "price_book_entries" USING btree ("price_book_id","product_id");--> statement-breakpoint
CREATE INDEX "pbe_product_idx" ON "price_book_entries" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "pbk_currency_idx" ON "price_books" USING btree ("currency","market");--> statement-breakpoint
CREATE INDEX "bndl_bundle_idx" ON "product_bundles" USING btree ("bundle_product_id");--> statement-breakpoint
CREATE INDEX "prd_family_idx" ON "products" USING btree ("family");--> statement-breakpoint
CREATE INDEX "prd_type_idx" ON "products" USING btree ("type");--> statement-breakpoint
CREATE INDEX "qln_quote_idx" ON "quote_lines" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "qte_opp_idx" ON "quotes" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "qte_account_idx" ON "quotes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "qte_status_idx" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "arrm_account_idx" ON "arr_movements" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "arrm_period_idx" ON "arr_movements" USING btree ("fiscal_period");--> statement-breakpoint
CREATE INDEX "arrm_type_idx" ON "arr_movements" USING btree ("type");--> statement-breakpoint
CREATE INDEX "arrm_sub_idx" ON "arr_movements" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "ent_sub_idx" ON "entitlements" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "ent_account_idx" ON "entitlements" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "pinst_account_idx" ON "product_instances" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "rnw_sub_idx" ON "renewals" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "rnw_date_idx" ON "renewals" USING btree ("renewal_date");--> statement-breakpoint
CREATE INDEX "rnw_account_idx" ON "renewals" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "rnw_status_idx" ON "renewals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "amd_sub_idx" ON "subscription_amendments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "amd_effective_idx" ON "subscription_amendments" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "amd_renewal_opp_idx" ON "subscription_amendments" USING btree ("applied_to_renewal_opportunity_id");--> statement-breakpoint
CREATE INDEX "subi_sub_idx" ON "subscription_items" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "subi_product_idx" ON "subscription_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sub_account_idx" ON "subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sub_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sub_end_idx" ON "subscriptions" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "brev_account_idx" ON "business_reviews" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "cta_account_idx" ON "calls_to_action" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "cta_owner_idx" ON "calls_to_action" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "hmod_segment_idx" ON "health_models" USING btree ("segment");--> statement-breakpoint
CREATE INDEX "hsc_account_idx" ON "health_scores" USING btree ("account_id","as_of_date");--> statement-breakpoint
CREATE INDEX "hsc_date_idx" ON "health_scores" USING btree ("as_of_date");--> statement-breakpoint
CREATE INDEX "prun_record_idx" ON "playbook_runs" USING btree ("object_type","record_id");--> statement-breakpoint
CREATE INDEX "pbook_type_idx" ON "playbooks" USING btree ("type");--> statement-breakpoint
CREATE INDEX "risk_account_idx" ON "risks" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "risk_status_idx" ON "risks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "smil_plan_idx" ON "success_plan_milestones" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "sobj_plan_idx" ON "success_plan_objectives" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "splan_account_idx" ON "success_plans" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "usg_account_idx" ON "usage_metrics" USING btree ("account_id","period_start");--> statement-breakpoint
CREATE INDEX "usg_product_idx" ON "usage_metrics" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "usig_account_idx" ON "usage_signals" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "usig_type_idx" ON "usage_signals" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "ccmt_case_idx" ON "case_comments" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_account_idx" ON "cases" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "case_status_idx" ON "cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "case_owner_idx" ON "cases" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "case_opened_idx" ON "cases" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX "case_severity_idx" ON "cases" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "dfct_product_idx" ON "product_defects" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "dreg_partner_idx" ON "deal_registrations" USING btree ("partner_account_id");--> statement-breakpoint
CREATE INDEX "dreg_status_idx" ON "deal_registrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dreg_customer_idx" ON "deal_registrations" USING btree ("end_customer_account_id");--> statement-breakpoint
CREATE INDEX "pdist_partner_idx" ON "partner_lead_distributions" USING btree ("partner_account_id");--> statement-breakpoint
CREATE INDEX "pprof_tier_idx" ON "partner_profiles" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "act_account_idx" ON "activities" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "act_contact_idx" ON "activities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "act_opp_idx" ON "activities" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "act_occurred_idx" ON "activities" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "act_type_idx" ON "activities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "task_owner_idx" ON "tasks" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "task_account_idx" ON "tasks" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "task_due_idx" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "asnap_date_idx" ON "arr_snapshots" USING btree ("as_of_date");--> statement-breakpoint
CREATE INDEX "asnap_account_idx" ON "arr_snapshots" USING btree ("account_id","as_of_date");--> statement-breakpoint
CREATE INDEX "asnap_cohort_idx" ON "arr_snapshots" USING btree ("cohort_month");--> statement-breakpoint
CREATE INDEX "fsnap_period_idx" ON "forecast_snapshots" USING btree ("fiscal_period","as_of_date");--> statement-breakpoint
CREATE INDEX "fsnap_owner_idx" ON "forecast_snapshots" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "fcst_period_idx" ON "forecasts" USING btree ("fiscal_period","level");--> statement-breakpoint
CREATE INDEX "fcst_owner_idx" ON "forecasts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "psnap_date_idx" ON "pipeline_snapshots" USING btree ("as_of_date");--> statement-breakpoint
CREATE INDEX "psnap_opp_idx" ON "pipeline_snapshots" USING btree ("opportunity_id","as_of_date");--> statement-breakpoint
CREATE INDEX "psnap_period_idx" ON "pipeline_snapshots" USING btree ("fiscal_period");--> statement-breakpoint
CREATE INDEX "ains_record_idx" ON "ai_insights" USING btree ("object_type","record_id");--> statement-breakpoint
CREATE INDEX "ains_kind_idx" ON "ai_insights" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "ains_account_idx" ON "ai_insights" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "dqi_record_idx" ON "data_quality_issues" USING btree ("object_type","record_id");--> statement-breakpoint
CREATE INDEX "dqi_status_idx" ON "data_quality_issues" USING btree ("status","severity");--> statement-breakpoint
CREATE INDEX "dup_object_idx" ON "duplicate_candidates" USING btree ("object_type","status");--> statement-breakpoint
CREATE INDEX "dup_a_idx" ON "duplicate_candidates" USING btree ("record_a_id");--> statement-breakpoint
CREATE INDEX "icon_category_idx" ON "integration_connections" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ievt_conn_idx" ON "integration_events" USING btree ("connection_id","status");--> statement-breakpoint
CREATE INDEX "ievt_record_idx" ON "integration_events" USING btree ("object_type","record_id");--> statement-breakpoint
CREATE INDEX "ievt_status_idx" ON "integration_events" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "rpt_object_idx" ON "saved_reports" USING btree ("object_type");--> statement-breakpoint
CREATE INDEX "sla_record_idx" ON "sla_timers" USING btree ("object_type","record_id");--> statement-breakpoint
CREATE INDEX "sla_status_idx" ON "sla_timers" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "vrul_object_idx" ON "validation_rules" USING btree ("object_type");--> statement-breakpoint
CREATE INDEX "wfd_object_idx" ON "workflow_definitions" USING btree ("object_type","trigger");--> statement-breakpoint
CREATE INDEX "wfr_def_idx" ON "workflow_runs" USING btree ("definition_id","status");--> statement-breakpoint
CREATE INDEX "wfr_record_idx" ON "workflow_runs" USING btree ("object_type","record_id");--> statement-breakpoint
CREATE INDEX "wfr_status_idx" ON "workflow_runs" USING btree ("status");