import { eq, sql } from 'drizzle-orm';
import { getDb, getDbHandle } from './index';
import * as s from './schema';
import { runMigrations } from './migrate';
import {
  CAMPAIGN_TEMPLATES,
  CASE_SUBJECTS,
  COMPANIES,
  DISCOUNT_POLICY_MATRIX,
  FIRST_NAMES,
  INTEGRATION_CATALOGUE,
  LAST_NAMES,
  LOSS_REASONS,
  PARTNER_COMPANIES,
  PRODUCT_CATALOGUE,
  RISK_TEMPLATES,
  TITLES_BY_ROLE,
} from './seed-data';
import { hashPassword } from '@/server/auth';
import { ROLE_DEFINITIONS } from '@/server/rbac';
import { addDays, addMonths, fiscalQuarter, termEndDate, today, toIso } from '@/domain/dates';
import { mrrFromArr } from '@/domain/pricing';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '@/domain/health';
import { ratioBps } from '@/domain/money';
import type { AuditContext } from '@/server/audit';
import { createQuote, submitQuoteForApproval, decideApproval, acceptQuote } from '@/server/services/quotes';
import { changeStage } from '@/server/services/opportunities';
import { amendSubscription } from '@/server/services/subscriptions';
import { rescoreLead, routeLead } from '@/server/services/leads';
import { createCase, addComment, resolveCase, escalateCase } from '@/server/services/cases';
import { scoreAllAccounts, refreshRenewalRisk, detectSignals } from '@/server/services/health';
import { takeSnapshots } from '@/server/services/analytics';
import type { AuthenticatedUser } from '@/server/auth';

/**
 * Deterministic seed.
 *
 * Two properties matter here. First, it is reproducible: a seeded PRNG means the
 * same dataset every run, so tests can assert against it. Second, and more
 * importantly, it drives the *real services* for every commercial path — quotes go
 * through the approval chain, deals are won through the stage gate, subscriptions
 * are provisioned by the booking engine, and mid-term upsells are co-termed by the
 * amendment engine. The seed is therefore an end-to-end exercise of the business
 * logic rather than a pile of hand-written rows that might not be reachable.
 */

/** Mulberry32 — small, fast, and identical across platforms. */
function makeRng(seed = 20260725) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng();
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const pickN = <T>(arr: readonly T[], n: number): T[] => {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
};
const between = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const chance = (p: number) => rng() < p;

const TODAY = today();
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'spoton';

type Ctx = AuditContext;
const seedCtx: Ctx = { source: 'seed', user: null };

function log(step: string, detail: string) {
  console.log(`[seed] ${step.padEnd(24)} ${detail}`);
}

/* ------------------------------------------------------------------ main flow */

export async function seed(): Promise<{ summary: Record<string, number> }> {
  const db = await getDb();
  const summary: Record<string, number> = {};

  /* --- roles ------------------------------------------------------------- */
  const roleRows = await db
    .insert(s.roles)
    .values(
      ROLE_DEFINITIONS.map((r) => ({
        key: r.key,
        name: r.name,
        isAdmin: r.isAdmin,
        discountAuthorityBps: r.discountAuthorityBps,
        permissions: r.permissions,
        fieldSecurity: r.fieldSecurity,
        description: `${r.name} — seeded role definition`,
      })),
    )
    .returning();
  const roleByKey = new Map(roleRows.map((r) => [r.key, r]));
  summary.roles = roleRows.length;
  log('roles', `${roleRows.length} roles`);

  /* --- teams ------------------------------------------------------------- */
  const teamRows = await db
    .insert(s.teams)
    .values([
      { name: 'Enterprise Sales — NA', type: 'sales', region: 'NA', segment: 'enterprise' },
      { name: 'Enterprise Sales — EMEA', type: 'sales', region: 'EMEA', segment: 'enterprise' },
      { name: 'Commercial Sales — NA', type: 'sales', region: 'NA', segment: 'mid_market' },
      { name: 'Sales Development', type: 'bdr', region: 'Global' },
      { name: 'Customer Success', type: 'customer_success', region: 'Global' },
      { name: 'Renewals Desk', type: 'renewals', region: 'Global' },
      { name: 'Technical Support', type: 'support', region: 'Global' },
      { name: 'Channel & Alliances', type: 'channel', region: 'Global' },
      { name: 'Marketing', type: 'marketing', region: 'Global' },
      { name: 'Deal Desk', type: 'deal_desk', region: 'Global' },
      { name: 'Executive', type: 'executive', region: 'Global' },
    ])
    .returning();
  const teamByName = new Map(teamRows.map((t) => [t.name, t]));
  summary.teams = teamRows.length;

  /* --- users ------------------------------------------------------------- */
  const passwordHash = hashPassword(SEED_PASSWORD);
  const userSpecs = [
    { email: 'admin@spoton.dev', name: 'Avery Sandoval', title: 'Platform Administrator', role: 'admin', team: 'Executive', region: 'Global' },
    { email: 'cro@spoton.dev', name: 'Dana Whitlock', title: 'Chief Revenue Officer', role: 'cro', team: 'Executive', region: 'Global' },
    { email: 'cfo@spoton.dev', name: 'Peter Nagy', title: 'Chief Financial Officer', role: 'cfo', team: 'Executive', region: 'Global' },
    { email: 'vpsales@spoton.dev', name: 'Renata Oyelaran', title: 'VP Sales', role: 'vp_sales', team: 'Enterprise Sales — NA', region: 'NA' },
    { email: 'manager.na@spoton.dev', name: 'Colin Rafferty', title: 'Sales Manager, NA Enterprise', role: 'sales_manager', team: 'Enterprise Sales — NA', region: 'NA' },
    { email: 'manager.emea@spoton.dev', name: 'Astrid Lindqvist', title: 'Sales Manager, EMEA', role: 'sales_manager', team: 'Enterprise Sales — EMEA', region: 'EMEA' },
    { email: 'ae@spoton.dev', name: 'Marcus Whitfield', title: 'Enterprise Account Executive', role: 'account_executive', team: 'Enterprise Sales — NA', region: 'NA' },
    { email: 'ae2@spoton.dev', name: 'Priya Raman', title: 'Enterprise Account Executive', role: 'account_executive', team: 'Enterprise Sales — NA', region: 'NA' },
    { email: 'ae.emea@spoton.dev', name: 'Tomas Novak', title: 'Enterprise Account Executive, EMEA', role: 'account_executive', team: 'Enterprise Sales — EMEA', region: 'EMEA' },
    { email: 'ae.apac@spoton.dev', name: 'Yuki Tanaka', title: 'Account Executive, APAC', role: 'account_executive', team: 'Commercial Sales — NA', region: 'APAC' },
    { email: 'ae.comm@spoton.dev', name: 'Sofia Duarte', title: 'Commercial Account Executive', role: 'account_executive', team: 'Commercial Sales — NA', region: 'NA' },
    { email: 'bdr@spoton.dev', name: 'Kwame Mensah', title: 'Senior BDR', role: 'bdr', team: 'Sales Development', region: 'NA' },
    { email: 'bdr2@spoton.dev', name: 'Niamh Gallagher', title: 'BDR, EMEA', role: 'bdr', team: 'Sales Development', region: 'EMEA' },
    { email: 'csm@spoton.dev', name: 'Ingrid Halvorsen', title: 'Senior Customer Success Manager', role: 'customer_success_manager', team: 'Customer Success', region: 'Global' },
    { email: 'csm2@spoton.dev', name: 'Emeka Nwosu', title: 'Customer Success Manager', role: 'customer_success_manager', team: 'Customer Success', region: 'EMEA' },
    { email: 'vpcs@spoton.dev', name: 'Clara Moreau', title: 'VP Customer Success', role: 'vp_customer_success', team: 'Customer Success', region: 'Global' },
    { email: 'renewals@spoton.dev', name: 'Rachel Brennan', title: 'Renewal Manager', role: 'renewal_manager', team: 'Renewals Desk', region: 'Global' },
    { email: 'renewals2@spoton.dev', name: 'Idris Farouk', title: 'Renewal Manager, EMEA', role: 'renewal_manager', team: 'Renewals Desk', region: 'EMEA' },
    { email: 'renewals.dir@spoton.dev', name: 'Helena Petrov', title: 'Director of Renewals', role: 'renewal_director', team: 'Renewals Desk', region: 'Global' },
    { email: 'support@spoton.dev', name: 'Daniel Kowalski', title: 'Senior Support Engineer', role: 'support_engineer', team: 'Technical Support', region: 'Global' },
    { email: 'support2@spoton.dev', name: 'Mei Chen', title: 'Support Engineer', role: 'support_engineer', team: 'Technical Support', region: 'APAC' },
    { email: 'support.mgr@spoton.dev', name: 'Sean Doherty', title: 'Support Manager', role: 'support_manager', team: 'Technical Support', region: 'Global' },
    { email: 'support.dir@spoton.dev', name: 'Leila Nasser', title: 'Director of Support', role: 'support_director', team: 'Technical Support', region: 'Global' },
    { email: 'channel@spoton.dev', name: 'Andres Vasquez', title: 'Channel Manager', role: 'channel_manager', team: 'Channel & Alliances', region: 'Global' },
    { email: 'dealdesk@spoton.dev', name: 'Nadia Haddad', title: 'Deal Desk Lead', role: 'deal_desk', team: 'Deal Desk', region: 'Global' },
    { email: 'marketing@spoton.dev', name: 'Callum MacLeod', title: 'Marketing Operations Manager', role: 'marketing_manager', team: 'Marketing', region: 'Global' },
    { email: 'revops@spoton.dev', name: 'Zara Karimi', title: 'Revenue Operations Lead', role: 'rev_ops', team: 'Executive', region: 'Global' },
    { email: 'integration@spoton.dev', name: 'Integration Service Account', title: 'Service Account', role: 'integration', team: 'Executive', region: 'Global' },
  ];

  const userRows = await db
    .insert(s.users)
    .values(
      userSpecs.map((u) => ({
        email: u.email,
        name: u.name,
        title: u.title,
        passwordHash,
        roleId: roleByKey.get(u.role)!.id,
        teamId: teamByName.get(u.team)?.id ?? null,
        region: u.region,
        active: true,
        isIntegrationUser: u.role === 'integration',
      })),
    )
    .returning();
  const userByEmail = new Map(userRows.map((u) => [u.email, u]));
  summary.users = userRows.length;
  log('users', `${userRows.length} users (password: ${SEED_PASSWORD})`);

  const admin = userByEmail.get('admin@spoton.dev')!;
  const adminAuth: AuthenticatedUser = {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    title: admin.title,
    teamId: admin.teamId,
    managerId: null,
    region: admin.region,
    roleId: admin.roleId,
    roleKey: 'admin',
    roleName: 'System Administrator',
    isAdmin: true,
    permissions: { '*': ['*'] },
    fieldSecurity: {},
    discountAuthorityBps: 10_000,
  };
  const adminCtx: Ctx = { source: 'seed', user: { id: admin.id } };

  const aes = [
    userByEmail.get('ae@spoton.dev')!,
    userByEmail.get('ae2@spoton.dev')!,
    userByEmail.get('ae.emea@spoton.dev')!,
    userByEmail.get('ae.apac@spoton.dev')!,
    userByEmail.get('ae.comm@spoton.dev')!,
  ];
  const csms = [userByEmail.get('csm@spoton.dev')!, userByEmail.get('csm2@spoton.dev')!];
  const renewalMgrs = [
    userByEmail.get('renewals@spoton.dev')!,
    userByEmail.get('renewals2@spoton.dev')!,
  ];
  const supportEngineers = [
    userByEmail.get('support@spoton.dev')!,
    userByEmail.get('support2@spoton.dev')!,
  ];
  const bdrs = [userByEmail.get('bdr@spoton.dev')!, userByEmail.get('bdr2@spoton.dev')!];

  // Managers.
  await db
    .update(s.users)
    .set({ managerId: userByEmail.get('manager.na@spoton.dev')!.id })
    .where(eq(s.users.id, aes[0].id));
  await db
    .update(s.users)
    .set({ managerId: userByEmail.get('manager.na@spoton.dev')!.id })
    .where(eq(s.users.id, aes[1].id));

  /* --- territories and coverage ----------------------------------------- */
  const territoryRows = await db
    .insert(s.territories)
    .values([
      { name: 'North America — Enterprise', type: 'geographic', priority: 10, criteria: { region: 'NA' } },
      { name: 'EMEA — Enterprise', type: 'geographic', priority: 10, criteria: { region: 'EMEA' } },
      { name: 'APAC', type: 'geographic', priority: 10, criteria: { region: 'APAC' } },
      { name: 'Financial Services Overlay', type: 'industry', priority: 5, criteria: { industry: 'Financial Services' } },
      { name: 'Strategic Named Accounts', type: 'named_account', priority: 1, criteria: { tier: 'strategic' } },
    ])
    .returning();
  const terrByName = new Map(territoryRows.map((t) => [t.name, t]));
  summary.territories = territoryRows.length;

  const yearStart = `${TODAY.slice(0, 4)}-01-01`;
  await db.insert(s.territoryAssignments).values([
    { territoryId: terrByName.get('North America — Enterprise')!.id, userId: aes[0].id, role: 'account_executive', effectiveFrom: yearStart },
    { territoryId: terrByName.get('North America — Enterprise')!.id, userId: csms[0].id, role: 'customer_success_manager', effectiveFrom: yearStart },
    { territoryId: terrByName.get('EMEA — Enterprise')!.id, userId: aes[2].id, role: 'account_executive', effectiveFrom: yearStart },
    { territoryId: terrByName.get('EMEA — Enterprise')!.id, userId: csms[1].id, role: 'customer_success_manager', effectiveFrom: yearStart },
    { territoryId: terrByName.get('APAC')!.id, userId: aes[3].id, role: 'account_executive', effectiveFrom: yearStart },
    { territoryId: terrByName.get('Financial Services Overlay')!.id, userId: aes[1].id, role: 'account_executive', effectiveFrom: yearStart },
    { territoryId: terrByName.get('Strategic Named Accounts')!.id, userId: aes[0].id, role: 'account_executive', effectiveFrom: yearStart },
    // A closed historical assignment, so ownership history is non-trivial.
    { territoryId: terrByName.get('APAC')!.id, userId: aes[4].id, role: 'account_executive', effectiveFrom: `${Number(TODAY.slice(0, 4)) - 1}-01-01`, effectiveTo: addDays(yearStart, -1) },
    // Live temporary coverage.
    { territoryId: terrByName.get('EMEA — Enterprise')!.id, userId: aes[1].id, role: 'account_executive', effectiveFrom: addDays(TODAY, -5), effectiveTo: addDays(TODAY, 16), isTemporaryCoverage: true, coveringForUserId: aes[2].id },
  ]);

  /* --- quotas ------------------------------------------------------------ */
  const quarters = [0, 1, 2, 3].map((i) => fiscalQuarter(addMonths(`${TODAY.slice(0, 4)}-01-15`, i * 3)));
  const quotaValues: (typeof s.quotas.$inferInsert)[] = [];
  for (const q of quarters) {
    for (const ae of aes) {
      quotaValues.push({ userId: ae.id, fiscalPeriod: q, periodType: 'quarter', metric: 'new_arr', targetCents: between(60, 110) * 100_000 });
    }
    for (const rm of renewalMgrs) {
      quotaValues.push({ userId: rm.id, fiscalPeriod: q, periodType: 'quarter', metric: 'renewal_arr', targetCents: between(150, 260) * 100_000 });
    }
  }
  await db.insert(s.quotas).values(quotaValues);
  summary.quotas = quotaValues.length;

  /* --- products, price books, policies ---------------------------------- */
  const productRows = await db
    .insert(s.products)
    .values(
      PRODUCT_CATALOGUE.map((p) => ({
        sku: p.sku,
        name: p.name,
        family: p.family,
        type: p.type as never,
        billingModel: p.billingModel as never,
        unitOfMeasure: p.unitOfMeasure,
        isRecurring: p.isRecurring,
        editionRank: 'editionRank' in p ? (p.editionRank as number) : null,
        revenueCategory: p.revenueCategory,
        maxDiscountBps: p.maxDiscountBps,
        entitlementTemplate: 'entitlementTemplate' in p ? p.entitlementTemplate : null,
        active: true,
        description: p.description,
      })),
    )
    .returning();
  const productBySku = new Map(productRows.map((p) => [p.sku, p]));
  summary.products = productRows.length;

  const priceBookRows = await db
    .insert(s.priceBooks)
    .values([
      { name: 'Global Standard (USD)', currency: 'USD', market: 'GLOBAL', kind: 'standard', isDefault: true, effectiveFrom: yearStart },
      { name: 'EMEA Standard (EUR)', currency: 'EUR', market: 'EMEA', kind: 'standard', effectiveFrom: yearStart },
      { name: 'Partner — Gold', currency: 'USD', market: 'GLOBAL', kind: 'partner', partnerTier: 'gold', effectiveFrom: yearStart },
      { name: 'Nonprofit', currency: 'USD', market: 'GLOBAL', kind: 'nonprofit', effectiveFrom: yearStart },
    ])
    .returning();
  const standardBook = priceBookRows[0];
  const partnerBook = priceBookRows[2];
  const nonprofitBook = priceBookRows[3];
  summary.priceBooks = priceBookRows.length;

  // Volume tiers and multi-year discounts, expressed as data.
  const pbeValues: (typeof s.priceBookEntries.$inferInsert)[] = [];
  for (const p of PRODUCT_CATALOGUE) {
    const product = productBySku.get(p.sku)!;
    const base = p.listUnitCents;
    const isSeat = p.unitOfMeasure === 'seat';

    const bands = isSeat
      ? [
          { min: 1, max: 49, mult: 1 },
          { min: 50, max: 249, mult: 0.88 },
          { min: 250, max: 999, mult: 0.78 },
          { min: 1000, max: null as number | null, mult: 0.68 },
        ]
      : [{ min: 1, max: null as number | null, mult: 1 }];

    for (const band of bands) {
      for (const term of [12, 24, 36]) {
        pbeValues.push({
          priceBookId: standardBook.id,
          productId: product.id,
          listUnitCents: Math.round(base * band.mult),
          minQuantity: band.min,
          maxQuantity: band.max,
          termMonths: term,
          multiYearDiscountBps: term === 36 ? 1200 : term === 24 ? 700 : 0,
          includedVolume: 'includedVolume' in p ? (p.includedVolume as number) : null,
          overageUnitCents: 'overageUnitCents' in p ? (p.overageUnitCents as number) : null,
          active: true,
        });
      }
      // EUR book at a market-adjusted rate.
      pbeValues.push({
        priceBookId: priceBookRows[1].id,
        productId: product.id,
        listUnitCents: Math.round(base * band.mult * 0.94),
        minQuantity: band.min,
        maxQuantity: band.max,
        termMonths: 12,
        multiYearDiscountBps: 0,
        active: true,
      });
      // Partner book carries the margin as a standing discount.
      pbeValues.push({
        priceBookId: partnerBook.id,
        productId: product.id,
        listUnitCents: Math.round(base * band.mult * 0.75),
        minQuantity: band.min,
        maxQuantity: band.max,
        termMonths: 12,
        multiYearDiscountBps: 0,
        active: true,
      });
      pbeValues.push({
        priceBookId: nonprofitBook.id,
        productId: product.id,
        listUnitCents: Math.round(base * band.mult * 0.6),
        minQuantity: band.min,
        maxQuantity: band.max,
        termMonths: 12,
        multiYearDiscountBps: 0,
        active: true,
      });
    }
  }
  await db.insert(s.priceBookEntries).values(pbeValues);
  summary.priceBookEntries = pbeValues.length;

  // Bundles.
  await db.insert(s.productBundles).values([
    { bundleProductId: productBySku.get('SPOT-PLAT-ENT')!.id, componentProductId: productBySku.get('SPOT-MOD-RENEW')!.id, quantity: 1, allocationBps: 2500 },
    { bundleProductId: productBySku.get('SPOT-PLAT-ENT')!.id, componentProductId: productBySku.get('SPOT-MOD-SUBS')!.id, quantity: 1, allocationBps: 3500 },
    { bundleProductId: productBySku.get('SPOT-PLAT-ENT')!.id, componentProductId: productBySku.get('SPOT-ADD-AI')!.id, quantity: 1, isOptional: true, allocationBps: 4000 },
  ]);

  await db.insert(s.discountPolicies).values(
    DISCOUNT_POLICY_MATRIX.map((p) => ({
      name: p.name,
      sequence: p.sequence,
      thresholdBps: p.thresholdBps,
      approverRoleKey: p.approverRoleKey,
      triggersOnNonStandardTerms: p.triggersOnNonStandardTerms,
      slaHours: p.slaHours,
      escalateToRoleKey: p.escalateToRoleKey,
      active: true,
    })),
  );
  summary.discountPolicies = DISCOUNT_POLICY_MATRIX.length;

  /* --- health models, FX, integrations, workflows ------------------------ */
  await db.insert(s.healthModels).values([
    { name: 'Default', weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_THRESHOLDS, isDefault: true, active: true },
    {
      name: 'Strategic Accounts',
      tier: 'strategic',
      weights: { ...DEFAULT_WEIGHTS, engagement: 1600, sentiment: 1400, usage: 1400, support: 1400 },
      thresholds: { excellent: 88, good: 74, fair: 58, poor: 42 },
      active: true,
    },
    {
      name: 'Onboarding',
      lifecycleStage: 'onboarding',
      weights: { ...DEFAULT_WEIGHTS, implementation: 2500, adoption: 2000, usage: 1500, contract: 400 },
      thresholds: DEFAULT_THRESHOLDS,
      active: true,
    },
  ]);

  await db.insert(s.fxRates).values([
    { fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08000000', effectiveFrom: yearStart },
    { fromCurrency: 'GBP', toCurrency: 'USD', rate: '1.27000000', effectiveFrom: yearStart },
    { fromCurrency: 'AUD', toCurrency: 'USD', rate: '0.66000000', effectiveFrom: yearStart },
    { fromCurrency: 'USD', toCurrency: 'USD', rate: '1.00000000', effectiveFrom: yearStart },
  ]);

  const integrationUser = userByEmail.get('integration@spoton.dev')!;
  await db.insert(s.integrationConnections).values(
    INTEGRATION_CATALOGUE.map((i) => ({
      name: i.name,
      category: i.category,
      system: i.system,
      direction: i.direction as never,
      status: 'connected',
      isMock: true,
      integrationUserId: integrationUser.id,
      config: { simulated: true, note: 'Mock adapter — swap credentials to go live' },
      syncCursor: `cdc_${TODAY}_0`,
      lastSyncAt: new Date(),
      lastSuccessAt: new Date(),
    })),
  );
  summary.integrations = INTEGRATION_CATALOGUE.length;

  await db.insert(s.routingRules).values([
    { name: 'Existing account owner', objectType: 'lead', strategy: 'named_account', priority: 10, criteria: {}, assigneeUserIds: [], slaMinutes: 30, active: true },
    { name: 'Partner-sourced to channel', objectType: 'lead', strategy: 'partner', priority: 20, criteria: { source: 'partner' }, assigneeUserIds: [userByEmail.get('channel@spoton.dev')!.id], slaMinutes: 120, active: true },
    { name: 'High-intent fast track', objectType: 'lead', strategy: 'priority', priority: 25, criteria: {}, assigneeUserIds: [aes[0].id, aes[1].id, aes[4].id], slaMinutes: 240, escalateToUserId: userByEmail.get('manager.na@spoton.dev')!.id, active: true },
    { name: 'NA territory', objectType: 'lead', strategy: 'territory', priority: 30, criteria: { region: 'NA' }, territoryId: terrByName.get('North America — Enterprise')!.id, assigneeUserIds: [], slaMinutes: 60, active: true },
    { name: 'EMEA territory', objectType: 'lead', strategy: 'territory', priority: 30, criteria: { region: 'EMEA' }, territoryId: terrByName.get('EMEA — Enterprise')!.id, assigneeUserIds: [], slaMinutes: 60, active: true },
    { name: 'APAC territory', objectType: 'lead', strategy: 'territory', priority: 30, criteria: { region: 'APAC' }, territoryId: terrByName.get('APAC')!.id, assigneeUserIds: [], slaMinutes: 90, active: true },
    { name: 'Global round robin', objectType: 'lead', strategy: 'round_robin', priority: 90, criteria: {}, assigneeUserIds: aes.map((a) => a.id), slaMinutes: 480, active: true },
  ]);

  await db.insert(s.workflowDefinitions).values([
    {
      name: 'Provision on Closed Won',
      objectType: 'opportunities',
      trigger: 'on_field_change',
      watchField: 'stage',
      entryCriteria: { stage: 'closed_won' },
      exitCriteria: {},
      actions: [{ type: 'create_record', config: { object: 'subscriptions', via: 'provisionFromWonOpportunity' } }],
      ownerUserId: userByEmail.get('revops@spoton.dev')!.id,
      slaMinutes: 15,
      exceptionQueue: 'booking',
      description: 'Books the order, provisions the subscription and creates the renewal.',
      active: true,
    },
    {
      name: 'Renewal 120-day kickoff',
      objectType: 'renewals',
      trigger: 'time_based',
      offsetFromField: 'renewalDate',
      offsetDays: -120,
      entryCriteria: { status: 'not_started' },
      exitCriteria: { status: 'in_progress' },
      actions: [{ type: 'create_task', config: { title: 'Begin renewal outreach for {{accountId}}', priority: 'high' } }],
      ownerUserId: userByEmail.get('renewals.dir@spoton.dev')!.id,
      slaMinutes: 1440,
      exceptionQueue: 'renewals',
      active: true,
    },
    {
      name: 'Escalate stalled lead',
      objectType: 'leads',
      trigger: 'scheduled',
      entryCriteria: { slaBreached: true },
      exitCriteria: { status: 'accepted' },
      actions: [{ type: 'send_notification', config: { level: 'high', title: 'Lead SLA breached' } }],
      ownerUserId: userByEmail.get('manager.na@spoton.dev')!.id,
      slaMinutes: 60,
      exceptionQueue: 'demand',
      active: true,
    },
    {
      name: 'Health drop save play',
      objectType: 'accounts',
      trigger: 'on_field_change',
      watchField: 'healthBand',
      entryCriteria: { healthBand: 'critical' },
      exitCriteria: {},
      actions: [{ type: 'run_playbook', config: { playbook: 'save_play' } }],
      ownerUserId: userByEmail.get('vpcs@spoton.dev')!.id,
      slaMinutes: 480,
      exceptionQueue: 'success',
      active: true,
    },
  ]);

  await db.insert(s.playbooks).values([
    { name: 'Standard renewal', type: 'renewal', trigger: { daysToRenewal: { lte: 120 } }, steps: [{ name: 'Confirm renewal contact', offsetDays: 0 }, { name: 'Present renewal quote', offsetDays: 30 }, { name: 'Secure signature', offsetDays: 75 }], active: true, ownerId: renewalMgrs[0].id },
    { name: 'Save play', type: 'save', trigger: { riskLevel: ['high', 'critical'] }, steps: [{ name: 'Executive sponsor call', offsetDays: 2 }, { name: 'Joint remediation plan', offsetDays: 7 }, { name: 'Adoption sprint', offsetDays: 14 }], active: true, ownerId: csms[0].id },
    { name: 'Onboarding', type: 'onboarding', trigger: { lifecycleStage: 'onboarding' }, steps: [{ name: 'Kickoff', offsetDays: 3 }, { name: 'Configuration complete', offsetDays: 21 }, { name: 'Go live', offsetDays: 45 }, { name: 'First value review', offsetDays: 75 }], active: true, ownerId: csms[0].id },
    { name: 'Expansion play', type: 'expansion', trigger: { utilisationBps: { gte: 9000 } }, steps: [{ name: 'Usage review with admin', offsetDays: 0 }, { name: 'Business case', offsetDays: 10 }], active: true, ownerId: aes[0].id },
  ]);

  await db.insert(s.validationRules).values([
    { objectType: 'opportunities', name: 'Close date required', kind: 'required', field: 'closeDate', definition: {}, message: 'A close date is required', severity: 'error', active: true },
    { objectType: 'opportunities', name: 'Loss reason on closed lost', kind: 'stage_gate', field: 'lossReason', appliesFromStage: 'closed_lost', definition: {}, message: 'Record why the deal was lost', severity: 'error', active: true },
    { objectType: 'opportunities', name: 'Next step at discovery', kind: 'stage_gate', field: 'nextStep', appliesFromStage: 'discovery', definition: {}, message: 'A next step is required from Discovery onwards', severity: 'error', overridable: true, active: true },
    { objectType: 'quotes', name: 'Discount ceiling', kind: 'range', field: 'effectiveDiscountBps', definition: { max: 5000 }, message: 'Discounts above 50% require an executive exception', severity: 'error', active: true },
    { objectType: 'accounts', name: 'Region required for coverage', kind: 'required', field: 'region', definition: {}, message: 'Region drives territory assignment', severity: 'warning', active: true },
  ]);

  /* --- campaigns --------------------------------------------------------- */
  const campaignRows = await db
    .insert(s.campaigns)
    .values(
      CAMPAIGN_TEMPLATES.map((c, i) => ({
        name: c.name,
        type: c.type as never,
        channel: c.channel,
        status: 'active',
        startDate: addDays(TODAY, -270 + i * 20),
        endDate: addDays(TODAY, 60),
        budgetCents: c.budgetCents,
        actualCostCents: c.costCents,
        attributionWindowDays: 120,
        ownerId: userByEmail.get('marketing@spoton.dev')!.id,
        isPartnerCampaign: Boolean(c.isPartner),
      })),
    )
    .returning();
  summary.campaigns = campaignRows.length;

  /* --- partner accounts -------------------------------------------------- */
  const partnerAccountRows = await db
    .insert(s.accounts)
    .values(
      PARTNER_COMPANIES.map((p) => ({
        name: p.name,
        domain: p.domain,
        type: 'global' as const,
        region: p.region,
        country: p.country,
        industry: 'Professional Services',
        tier: 'mid_market' as const,
        isPartner: true,
        isCustomer: false,
        lifecycleStage: 'established' as const,
        ownerId: userByEmail.get('channel@spoton.dev')!.id,
        channelManagerId: userByEmail.get('channel@spoton.dev')!.id,
        currency: 'USD',
      })),
    )
    .returning();

  await db.insert(s.partnerProfiles).values(
    partnerAccountRows.map((a, i) => {
      const spec = PARTNER_COMPANIES[i];
      return {
        accountId: a.id,
        tier: spec.tier as never,
        partnerType: spec.partnerType,
        programStatus: 'active',
        marginBps: spec.marginBps,
        referralFeeBps: Math.round(spec.marginBps / 2),
        priceBookId: partnerBook.id,
        renewalOwnership: spec.partnerType === 'reseller' ? 'partner' : 'vendor',
        certificationStatus: 'certified',
        certifiedEngineers: between(2, 18),
        enablementStatus: 'complete',
        competencies: ['Implementation', 'Renewals', spec.partnerType === 'si' ? 'Data Migration' : 'Support'],
        territories: [spec.region],
        agreementSignedAt: addDays(TODAY, -between(200, 800)),
        agreementExpiresAt: addDays(TODAY, between(90, 500)),
        channelManagerId: userByEmail.get('channel@spoton.dev')!.id,
        scorecard: { onTimeDelivery: between(80, 99), csat: between(38, 49) / 10, pipelineContribution: between(1, 9) },
      };
    }),
  );
  summary.partners = partnerAccountRows.length;

  /* --- customer accounts ------------------------------------------------- */
  const accountValues: (typeof s.accounts.$inferInsert)[] = COMPANIES.map((c, i) => {
    const ae = aes[i % aes.length];
    const csm = csms[i % csms.length];
    const rm = renewalMgrs[i % renewalMgrs.length];
    const potentialMultiple = 1.6 + rng() * 2.4;
    const baseArr = c.tier === 'strategic' ? between(180, 420) : c.tier === 'enterprise' ? between(80, 180) : c.tier === 'mid_market' ? between(25, 80) : between(8, 25);

    return {
      name: c.name,
      legalName: `${c.name} ${c.country === 'US' ? 'Inc.' : c.country === 'GB' ? 'Ltd.' : 'GmbH'}`,
      type: 'global' as const,
      domain: c.domain,
      website: `https://www.${c.domain}`,
      region: c.region,
      country: c.country,
      state: 'state' in c ? (c.state as string) : null,
      city: c.city,
      industry: c.industry,
      employeeCount: c.employees,
      sizeBand: c.employees >= 5000 ? 'enterprise' : c.employees >= 1000 ? 'mid_market' : 'smb',
      annualRevenueCents: c.employees * between(180, 420) * 100_000,
      tier: c.tier as never,
      coverageModel: c.tier === 'strategic' || c.tier === 'enterprise' ? 'named' : 'pooled',
      potentialArrCents: Math.round(baseArr * potentialMultiple) * 100_000,
      potentialBand: potentialMultiple > 3 ? 'high' : 'medium',
      lifecycleStage: 'prospect' as const,
      currency: c.region === 'EMEA' ? 'EUR' : 'USD',
      ownerId: ae.id,
      accountExecutiveId: ae.id,
      bdrId: bdrs[i % bdrs.length].id,
      csmId: csm.id,
      renewalManagerId: rm.id,
      supportOwnerId: supportEngineers[i % supportEngineers.length].id,
      territoryId:
        c.region === 'NA'
          ? terrByName.get('North America — Enterprise')!.id
          : c.region === 'EMEA'
            ? terrByName.get('EMEA — Enterprise')!.id
            : terrByName.get('APAC')!.id,
      originalSource: pick(['form', 'event', 'outbound', 'partner', 'referral', 'intent']),
      latestSource: pick(['form', 'event', 'outbound', 'partner', 'referral']),
      originalCampaignId: pick(campaignRows).id,
      privacyRegime: c.region === 'EMEA' ? 'gdpr' : c.country === 'US' ? 'ccpa' : 'none',
      npsScore: between(-30, 80),
      csatScore: between(2, 5),
      sentiment: pick(['neutral', 'positive', 'positive', 'very_positive', 'negative']) as never,
      description: `${c.industry} organisation headquartered in ${c.city}.`,
    };
  });

  const accountRows = await db.insert(s.accounts).values(accountValues).returning();
  summary.accounts = accountRows.length + partnerAccountRows.length;
  log('accounts', `${accountRows.length} customers, ${partnerAccountRows.length} partners`);

  /* --- hierarchies and relationships ------------------------------------ */
  // Give the four largest accounts a real corporate structure.
  const parents = accountRows.slice(0, 4);
  const childValues: (typeof s.accounts.$inferInsert)[] = [];
  for (const parent of parents) {
    const regions = ['EMEA', 'APAC', 'NA'];
    for (let r = 0; r < 2; r++) {
      childValues.push({
        name: `${parent.name} — ${regions[r]}`,
        type: 'regional',
        parentAccountId: parent.id,
        ultimateParentAccountId: parent.id,
        hierarchyDepth: 1,
        domain: parent.domain,
        region: regions[r],
        country: regions[r] === 'EMEA' ? 'DE' : regions[r] === 'APAC' ? 'JP' : 'US',
        industry: parent.industry,
        employeeCount: Math.round((parent.employeeCount ?? 1000) / 3),
        tier: parent.tier,
        lifecycleStage: 'prospect',
        currency: regions[r] === 'EMEA' ? 'EUR' : 'USD',
        ownerId: parent.ownerId,
        accountExecutiveId: parent.accountExecutiveId,
        csmId: parent.csmId,
        renewalManagerId: parent.renewalManagerId,
      });
    }
  }
  const childRows = await db.insert(s.accounts).values(childValues).returning();

  const divisionValues: (typeof s.accounts.$inferInsert)[] = childRows.slice(0, 4).map((c) => ({
    name: `${c.name} — Operations Division`,
    type: 'division' as const,
    parentAccountId: c.id,
    ultimateParentAccountId: c.ultimateParentAccountId,
    hierarchyDepth: 2,
    region: c.region,
    country: c.country,
    industry: c.industry,
    tier: c.tier,
    lifecycleStage: 'prospect' as const,
    currency: c.currency,
    ownerId: c.ownerId,
    accountExecutiveId: c.accountExecutiveId,
  }));
  const divisionRows = await db.insert(s.accounts).values(divisionValues).returning();
  summary.accountHierarchyNodes = childRows.length + divisionRows.length;

  const allCustomerAccounts = [...accountRows, ...childRows, ...divisionRows];

  // Sold-to / bill-to / ship-to / reseller / end-customer relationships.
  const relValues: (typeof s.accountRelationships.$inferInsert)[] = [];
  for (const parent of parents) {
    const kids = childRows.filter((c) => c.parentAccountId === parent.id);
    for (const kid of kids) {
      relValues.push({ fromAccountId: parent.id, toAccountId: kid.id, type: 'parent', isPrimary: true, effectiveFrom: yearStart });
      relValues.push({ fromAccountId: kid.id, toAccountId: parent.id, type: 'bill_to', isPrimary: true, effectiveFrom: yearStart });
      relValues.push({ fromAccountId: kid.id, toAccountId: kid.id, type: 'ship_to', isPrimary: true, effectiveFrom: yearStart });
    }
    relValues.push({ fromAccountId: parent.id, toAccountId: parent.id, type: 'sold_to', isPrimary: true, effectiveFrom: yearStart });
  }
  // Indirect deals: the reseller is a distinct account from the end customer.
  for (let i = 0; i < 6; i++) {
    const endCustomer = accountRows[10 + i];
    const partner = partnerAccountRows[i % partnerAccountRows.length];
    relValues.push({ fromAccountId: partner.id, toAccountId: endCustomer.id, type: 'reseller', isPrimary: true, effectiveFrom: yearStart, notes: 'Partner resells to this end customer' });
    relValues.push({ fromAccountId: endCustomer.id, toAccountId: partner.id, type: 'partner', effectiveFrom: yearStart });
    relValues.push({ fromAccountId: partner.id, toAccountId: endCustomer.id, type: 'end_customer', effectiveFrom: yearStart });
  }
  relValues.push({
    fromAccountId: partnerAccountRows[2].id,
    toAccountId: partnerAccountRows[1].id,
    type: 'distributor',
    effectiveFrom: yearStart,
    notes: 'Distributor supplying this reseller',
  });
  await db.insert(s.accountRelationships).values(relValues);
  summary.accountRelationships = relValues.length;

  // Account teams.
  const teamMemberValues: (typeof s.accountTeam.$inferInsert)[] = [];
  for (const a of accountRows) {
    teamMemberValues.push({ accountId: a.id, userId: a.accountExecutiveId!, role: 'account_executive', accessLevel: 'write', isPrimary: true, effectiveFrom: yearStart });
    teamMemberValues.push({ accountId: a.id, userId: a.csmId!, role: 'customer_success_manager', accessLevel: 'write', effectiveFrom: yearStart });
    teamMemberValues.push({ accountId: a.id, userId: a.renewalManagerId!, role: 'renewal_manager', accessLevel: 'write', effectiveFrom: yearStart });
    teamMemberValues.push({ accountId: a.id, userId: a.supportOwnerId!, role: 'support_engineer', accessLevel: 'read', effectiveFrom: yearStart });
    if (a.tier === 'strategic') {
      teamMemberValues.push({ accountId: a.id, userId: userByEmail.get('cro@spoton.dev')!.id, role: 'executive_sponsor', accessLevel: 'read', effectiveFrom: yearStart });
    }
  }
  await db.insert(s.accountTeam).values(teamMemberValues);
  summary.accountTeamMembers = teamMemberValues.length;

  /* --- billing accounts -------------------------------------------------- */
  const billingRows = await db
    .insert(s.billingAccounts)
    .values(
      accountRows.map((a, i) => ({
        accountId: a.id,
        name: `${a.name} — Billing`,
        paymentTerms: pick(['net_30', 'net_30', 'net_45', 'net_60']),
        currency: a.currency,
        paymentStatus: i % 11 === 0 ? 'late' : i % 17 === 0 ? 'delinquent' : 'current',
        outstandingCents: i % 3 === 0 ? between(5, 60) * 100_000 : 0,
        pastDueCents: i % 11 === 0 ? between(2, 25) * 100_000 : 0,
        purchaseOrderRequired: a.tier === 'strategic' || a.tier === 'enterprise',
        country: a.country,
        city: a.city,
        externalBillingId: `zuora_${a.id.slice(-8)}`,
      })),
    )
    .returning();
  const billingByAccount = new Map(billingRows.map((b) => [b.accountId, b]));
  summary.billingAccounts = billingRows.length;

  /* --- contacts and buying committees ----------------------------------- */
  const CONTACT_ROLES = [
    'decision_maker',
    'champion',
    'administrator',
    'user',
    'procurement',
    'executive_sponsor',
    'technical_evaluator',
    'finance',
  ] as const;

  const contactValues: (typeof s.contacts.$inferInsert)[] = [];
  for (const a of allCustomerAccounts) {
    const n = a.tier === 'strategic' ? between(7, 9) : a.tier === 'enterprise' ? between(5, 7) : between(3, 5);
    const roles = pickN(CONTACT_ROLES, Math.min(n, CONTACT_ROLES.length));
    for (const role of roles) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const isChampion = role === 'champion';
      const strength = isChampion ? pick(['strong', 'trusted_advisor']) : pick(['none', 'weak', 'moderate', 'moderate', 'strong']);
      const engaged = chance(0.75);

      contactValues.push({
        accountId: a.id,
        firstName: first,
        lastName: last,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@${a.domain ?? 'example.com'}`,
        phone: `+1-555-${between(1000, 9999)}`,
        title: pick(TITLES_BY_ROLE[role] ?? ['Manager']),
        department: role === 'finance' ? 'Finance' : role === 'technical_evaluator' ? 'Technology' : 'Revenue Operations',
        roleType: role,
        relationshipStrength: strength as never,
        sentiment: pick(['neutral', 'positive', 'positive', 'very_positive', 'negative']) as never,
        engagementScore: engaged ? between(35, 95) : between(0, 30),
        lastEngagedAt: engaged ? new Date(Date.now() - between(1, 90) * 86_400_000) : null,
        lastCustomerResponseAt: engaged && chance(0.7) ? new Date(Date.now() - between(1, 45) * 86_400_000) : null,
        influenceLevel: role === 'decision_maker' || role === 'executive_sponsor' ? between(4, 5) : between(2, 4),
        isChampion,
        // Champion turnover on a handful of accounts, so the risk model has real input.
        hasLeftCompany: isChampion && chance(0.12),
        isPrimary: role === 'champion',
        isBillingContact: role === 'finance',
        country: a.country,
        emailOptIn: chance(0.9),
        privacyRegime: a.privacyRegime,
        ownerId: a.ownerId,
      });
    }
  }
  const contactRows = await db.insert(s.contacts).values(contactValues).returning();
  summary.contacts = contactRows.length;
  log('contacts', `${contactRows.length} contacts`);

  const contactsByAccount = new Map<string, typeof contactRows>();
  for (const c of contactRows) {
    if (!c.accountId) continue;
    const list = contactsByAccount.get(c.accountId) ?? [];
    list.push(c);
    contactsByAccount.set(c.accountId, list);
  }

  // Reporting lines and buying committees.
  const crelValues: (typeof s.contactRelationships.$inferInsert)[] = [];
  const committeeValues: (typeof s.buyingCommittees.$inferInsert)[] = [];
  for (const a of accountRows) {
    const list = contactsByAccount.get(a.id) ?? [];
    if (list.length < 2) continue;
    const exec = list.find((c) => c.roleType === 'executive_sponsor') ?? list[0];
    for (const c of list) {
      if (c.id === exec.id) continue;
      if (chance(0.6)) {
        crelValues.push({ fromContactId: c.id, toContactId: exec.id, type: 'reports_to', strength: 'moderate' });
      }
    }
    committeeValues.push({
      accountId: a.id,
      name: `${a.name} buying committee`,
      coverageBps: ratioBps(list.length, 8),
      notes: 'Standing buying centre for this account.',
    });
  }
  if (crelValues.length) await db.insert(s.contactRelationships).values(crelValues);
  const committeeRows = await db.insert(s.buyingCommittees).values(committeeValues).returning();

  const memberValues: (typeof s.buyingCommitteeMembers.$inferInsert)[] = [];
  for (const committee of committeeRows) {
    const list = contactsByAccount.get(committee.accountId!) ?? [];
    for (const c of list) {
      memberValues.push({
        committeeId: committee.id,
        contactId: c.id,
        role: c.roleType,
        stance: c.isChampion ? 'champion' : pick(['supporter', 'neutral', 'neutral', 'skeptic', 'blocker']) as never,
        influenceLevel: c.influenceLevel,
        isEconomicBuyer: c.roleType === 'executive_sponsor' || c.roleType === 'finance',
        engagementScore: c.engagementScore,
        lastEngagedAt: c.lastEngagedAt,
      });
    }
  }
  await db.insert(s.buyingCommitteeMembers).values(memberValues);
  summary.buyingCommitteeMembers = memberValues.length;

  await db.insert(s.consentRecords).values(
    contactRows.slice(0, 200).map((c) => ({
      contactId: c.id,
      channel: 'email',
      status: c.emailOptIn ? 'granted' : 'withdrawn',
      legalBasis: c.privacyRegime === 'gdpr' ? 'consent' : 'legitimate_interest',
      region: c.privacyRegime,
      source: 'web_form',
      capturedAt: new Date(Date.now() - between(30, 600) * 86_400_000),
    })),
  );

  return { summary: await continueSeed(db, {
    summary,
    adminAuth,
    adminCtx,
    accountRows,
    childRows,
    allCustomerAccounts,
    partnerAccountRows,
    contactsByAccount,
    campaignRows,
    productBySku,
    standardBook,
    userByEmail,
    aes,
    csms,
    renewalMgrs,
    supportEngineers,
    bdrs,
    billingByAccount,
    quarters,
    roleByKey,
  }) };
}

/* -------------------------------------------------------------- part two ----- */

type SeedState = {
  summary: Record<string, number>;
  adminAuth: AuthenticatedUser;
  adminCtx: Ctx;
  accountRows: (typeof s.accounts.$inferSelect)[];
  childRows: (typeof s.accounts.$inferSelect)[];
  allCustomerAccounts: (typeof s.accounts.$inferSelect)[];
  partnerAccountRows: (typeof s.accounts.$inferSelect)[];
  contactsByAccount: Map<string, (typeof s.contacts.$inferSelect)[]>;
  campaignRows: (typeof s.campaigns.$inferSelect)[];
  productBySku: Map<string, typeof s.products.$inferSelect>;
  standardBook: typeof s.priceBooks.$inferSelect;
  userByEmail: Map<string, typeof s.users.$inferSelect>;
  aes: (typeof s.users.$inferSelect)[];
  csms: (typeof s.users.$inferSelect)[];
  renewalMgrs: (typeof s.users.$inferSelect)[];
  supportEngineers: (typeof s.users.$inferSelect)[];
  bdrs: (typeof s.users.$inferSelect)[];
  billingByAccount: Map<string, typeof s.billingAccounts.$inferSelect>;
  quarters: string[];
  roleByKey: Map<string, typeof s.roles.$inferSelect>;
};

async function continueSeed(
  db: Awaited<ReturnType<typeof getDb>>,
  st: SeedState,
): Promise<Record<string, number>> {
  const { summary, adminAuth, adminCtx } = st;

  /* --- leads, responses, attribution ------------------------------------ */
  const leadValues: (typeof s.leads.$inferInsert)[] = [];
  for (let i = 0; i < 110; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const companyBase = pick(COMPANIES);
    const isKnownDomain = chance(0.25);
    const domain = isKnownDomain ? companyBase.domain : `${last.toLowerCase()}${between(10, 99)}.example`;
    const region = pick(['NA', 'EMEA', 'APAC']);

    leadValues.push({
      firstName: first,
      lastName: last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`,
      phone: `+1-555-${between(1000, 9999)}`,
      company: isKnownDomain ? companyBase.name : `${last} ${pick(['Group', 'Holdings', 'Systems', 'Partners'])}`,
      title: pick(['VP Revenue Operations', 'Director of Sales Ops', 'CRM Administrator', 'Head of Customer Success', 'Chief Revenue Officer', 'Sales Analyst', 'Student']),
      website: `https://${domain}`,
      country: region === 'NA' ? pick(['US', 'CA']) : region === 'EMEA' ? pick(['GB', 'DE', 'FR', 'NL', 'SE']) : pick(['AU', 'SG', 'JP', 'IN']),
      region,
      industry: pick(['Software', 'Financial Services', 'Healthcare', 'Manufacturing', 'Retail', 'Agriculture', 'Education']),
      employeeCount: pick([25, 80, 240, 600, 1400, 3200, 8000, 18_000]),
      status: 'new',
      source: pick(['form', 'event', 'intent', 'chat', 'partner', 'outbound', 'referral', 'trial']),
      sourceDetail: pick(['Pricing page', 'Webinar registration', 'G2 intent surge', 'Live chat', 'Partner referral', 'Cold sequence', 'Trial signup']),
      campaignId: pick(st.campaignRows).id,
      emailOptIn: chance(0.85),
      privacyRegime: region === 'EMEA' ? 'gdpr' : 'ccpa',
      description: 'Inbound interest in renewal automation and ARR reporting.',
    });
  }
  const leadRows = await db.insert(s.leads).values(leadValues).returning();
  summary.leads = leadRows.length;

  const RESPONSE_TYPES = ['form_fill', 'content_download', 'event_registration', 'event_attendance', 'webinar_attendance', 'chat', 'intent_surge', 'demo_request', 'trial_signup', 'inbound_call', 'partner_referral'] as const;

  const responseValues: (typeof s.campaignResponses.$inferInsert)[] = [];
  for (const lead of leadRows) {
    const n = between(1, 5);

    /**
     * Interest decays, so the age of a response is what decides whether a lead
     * scores. A genuinely new inbound lead has at least one recent interaction;
     * only a minority are cold records with nothing but old history. Scattering
     * every touch months into the past would model a stale list, not a live one.
     */
    const isActive = chance(0.55);

    for (let i = 0; i < n; i++) {
      const type = pick(RESPONSE_TYPES);
      // The first response is the most recent one.
      const daysAgo = isActive
        ? i === 0
          ? between(0, 14)
          : between(5, 90)
        : between(60, 240);

      responseValues.push({
        campaignId: lead.campaignId ?? pick(st.campaignRows).id,
        leadId: lead.id,
        type: i === 0 && isActive && chance(0.4) ? pick(['demo_request', 'trial_signup', 'inbound_call'] as const) : type,
        channel: pick(['email', 'web', 'event', 'chat', 'phone']),
        occurredAt: new Date(Date.now() - daysAgo * 86_400_000),
        scoreValue: 0,
        detail: `${type.replace(/_/g, ' ')} interaction`,
      });
    }
  }
  // Known contacts respond too — no shadow lead is created for them.
  for (const contacts of st.contactsByAccount.values()) {
    for (const c of contacts.slice(0, 2)) {
      if (!chance(0.4)) continue;
      responseValues.push({
        campaignId: pick(st.campaignRows).id,
        contactId: c.id,
        accountId: c.accountId,
        type: pick(RESPONSE_TYPES),
        channel: 'email',
        occurredAt: new Date(Date.now() - between(1, 150) * 86_400_000),
        detail: 'Existing contact engaged directly, no duplicate lead created',
      });
    }
  }
  await db.insert(s.campaignResponses).values(responseValues);
  summary.campaignResponses = responseValues.length;

  await db.insert(s.campaignMembers).values(
    leadRows.map((l) => ({
      campaignId: l.campaignId!,
      leadId: l.id,
      status: 'responded',
      hasResponded: true,
      firstRespondedAt: new Date(Date.now() - between(10, 200) * 86_400_000),
      responseCount: between(1, 5),
    })),
  );

  // Score and route every lead through the real engines.
  let mqlCount = 0;
  let routedCount = 0;
  for (const lead of leadRows) {
    const scored = await rescoreLead(lead.id, adminCtx);
    if (scored.isMql) mqlCount++;
    const routed = await routeLead(lead.id, adminCtx);
    if (routed.ownerId) routedCount++;
  }
  summary.leadsScored = leadRows.length;
  summary.leadsMql = mqlCount;
  summary.leadsRouted = routedCount;
  log('leads', `${leadRows.length} leads, ${mqlCount} MQL, ${routedCount} routed`);

  // Dispositions across the lifecycle.
  const acceptedLeads = leadRows.slice(0, 40);
  for (const [i, lead] of acceptedLeads.entries()) {
    if (i % 4 === 3) {
      await db
        .update(s.leads)
        .set({ status: 'rejected', rejectedAt: new Date(), rejectionReason: pick(['Not a fit — headcount too small', 'No budget authority', 'Competitor employee', 'Duplicate of an existing opportunity']), disposition: pick(['no_fit', 'no_budget', 'timing', 'duplicate']) })
        .where(eq(s.leads.id, lead.id));
    } else if (i % 4 === 2) {
      await db
        .update(s.leads)
        .set({ status: 'nurture', disposition: 'timing', nurtureReason: 'Revisit next budget cycle', sequenceEnrolledAt: new Date(), sequenceName: 'Long-term nurture' })
        .where(eq(s.leads.id, lead.id));
    } else {
      await db
        .update(s.leads)
        .set({ status: 'accepted', acceptedAt: new Date(), firstTouchedAt: new Date(Date.now() - between(1, 40) * 3_600_000) })
        .where(eq(s.leads.id, lead.id));
    }
  }

  /* --- opportunities across every stage --------------------------------- */
  const OPEN_STAGE_PLAN: { stage: string; count: number }[] = [
    { stage: 'srl', count: 9 },
    { stage: 'discovery', count: 11 },
    { stage: 'solution_design', count: 9 },
    { stage: 'proposal', count: 8 },
    { stage: 'negotiation', count: 7 },
    { stage: 'contract', count: 5 },
    { stage: 're_nurture', count: 4 },
  ];

  const editionSkus = ['SPOT-PLAT-CORE', 'SPOT-PLAT-PRO', 'SPOT-PLAT-ENT'];
  const moduleSkus = ['SPOT-MOD-RENEW', 'SPOT-MOD-SUBS', 'SPOT-MOD-CS', 'SPOT-MOD-SERVICE', 'SPOT-ADD-AI', 'SPOT-ADD-MCP'];

  let accountCursor = 0;
  const nextAccount = () => st.accountRows[accountCursor++ % st.accountRows.length];

  const oppValues: (typeof s.opportunities.$inferInsert)[] = [];
  const stagePlanFlat: string[] = [];
  for (const p of OPEN_STAGE_PLAN) {
    for (let i = 0; i < p.count; i++) stagePlanFlat.push(p.stage);
  }

  for (const [i, stage] of stagePlanFlat.entries()) {
    const account = nextAccount();
    const seats = between(40, 600);
    const editionSkuForOpp = pick(editionSkus);
    const edition = st.productBySku.get(editionSkuForOpp)!;
    const arr =
      seats *
      (PRODUCT_CATALOGUE.find((p) => p.sku === editionSkuForOpp)?.listUnitCents ?? 132_000);
    const isParked = stage === 're_nurture';
    const closeDate = isParked ? addDays(TODAY, between(120, 260)) : addDays(TODAY, between(-20, 150));

    oppValues.push({
      name: `${account.name} — ${edition.name.replace('SpotOn Platform — ', '')} (${seats} seats)`,
      accountId: account.id,
      type: 'new_logo',
      stage: stage as never,
      forecastCategory: stage === 'contract' ? 'commit' : stage === 'negotiation' ? 'best_case' : isParked ? 'omitted' : 'pipeline',
      probabilityBps: stage === 'contract' ? 9000 : stage === 'negotiation' ? 7000 : stage === 'proposal' ? 5000 : stage === 'solution_design' ? 3000 : stage === 'discovery' ? 1500 : 500,
      currency: account.currency,
      amountCents: arr,
      arrCents: arr,
      tcvCents: arr,
      termMonths: 12,
      closeDate,
      originalCloseDate: closeDate,
      pushCount: chance(0.25) ? between(1, 3) : 0,
      stageEnteredAt: new Date(Date.now() - between(3, 70) * 86_400_000),
      nextStep: isParked ? null : pick(['Security review scheduled', 'Awaiting procurement feedback', 'Executive business case review', 'Technical validation in progress', 'Pricing workshop booked']),
      nextMeetingAt: chance(0.7) ? new Date(Date.now() + between(2, 25) * 86_400_000) : null,
      closePlan: ['solution_design', 'proposal', 'negotiation', 'contract'].includes(stage) ? 'Signature targeted for end of quarter; legal reviewing in parallel.' : null,
      competitors: chance(0.6) ? pickN(['Incumbent CRM', 'Spreadsheets', 'Homegrown tooling', 'Competitor A', 'Competitor B'], between(1, 2)) : [],
      incumbentProduct: chance(0.5) ? pick(['Legacy CRM', 'Spreadsheets', 'Homegrown system']) : null,
      lossReason: isParked ? pick(['No budget this fiscal year', 'Project deprioritised']) : null,
      reNurtureUntil: isParked ? addDays(TODAY, between(90, 200)) : null,
      description: `Consolidating revenue operations onto a single platform. ${seats} seats in scope.`,
      ownerId: account.accountExecutiveId!,
      teamId: st.userByEmail.get('ae@spoton.dev')!.teamId,
      territoryId: account.territoryId,
      createdSource: account.originalSource,
      originalSource: account.originalSource,
      latestSource: account.latestSource,
      primaryCampaignId: account.originalCampaignId,
      channelMotion: i % 7 === 0 ? 'partner_sourced' : 'direct',
      partnerAccountId: i % 7 === 0 ? pick(st.partnerAccountRows).id : null,
    });
  }

  const openOppRows = await db.insert(s.opportunities).values(oppValues).returning();
  summary.openOpportunities = openOppRows.length;

  // Products, contact roles, teams and action plans on the open pipeline.
  const oppProductValues: (typeof s.opportunityProducts.$inferInsert)[] = [];
  const ocrValues: (typeof s.opportunityContactRoles.$inferInsert)[] = [];
  const otmValues: (typeof s.opportunityTeam.$inferInsert)[] = [];
  const mapValues: (typeof s.mutualActionPlans.$inferInsert)[] = [];

  for (const opp of openOppRows) {
    const seats = Math.max(1, Math.round(opp.arrCents / 132_000));
    const editionSku = pick(editionSkus);
    const edition = st.productBySku.get(editionSku)!;
    // List price lives on the price book, not the product row.
    const editionListCents =
      PRODUCT_CATALOGUE.find((p) => p.sku === editionSku)?.listUnitCents ?? 132_000;
    oppProductValues.push({
      opportunityId: opp.id,
      productId: edition.id,
      action: 'add',
      quantity: seats,
      listUnitCents: editionListCents,
      netUnitCents: Math.round(opp.arrCents / seats),
      discountBps: between(0, 1800),
      termMonths: 12,
      startDate: opp.closeDate,
      endDate: termEndDate(opp.closeDate, 12),
      arrCents: opp.arrCents,
      tcvCents: opp.arrCents,
    });

    if (chance(0.55)) {
      const mod = st.productBySku.get(pick(moduleSkus))!;
      const qty = mod.unitOfMeasure === 'seat' ? seats : 1;
      const modArr = qty * 60_000;
      oppProductValues.push({
        opportunityId: opp.id,
        productId: mod.id,
        action: 'add',
        quantity: qty,
        listUnitCents: 60_000,
        netUnitCents: 60_000,
        discountBps: 0,
        termMonths: 12,
        startDate: opp.closeDate,
        endDate: termEndDate(opp.closeDate, 12),
        arrCents: modArr,
        tcvCents: modArr,
      });
    }

    const contacts = st.contactsByAccount.get(opp.accountId) ?? [];
    for (const c of contacts.slice(0, between(2, 4))) {
      ocrValues.push({
        opportunityId: opp.id,
        contactId: c.id,
        role: c.roleType,
        stance: c.isChampion ? 'champion' : pick(['supporter', 'neutral', 'skeptic']) as never,
        isPrimary: c.isChampion,
        influenceLevel: c.influenceLevel,
      });
    }

    otmValues.push({ opportunityId: opp.id, userId: opp.ownerId, role: 'account_executive', splitBps: 8000, creditType: 'primary' });
    otmValues.push({ opportunityId: opp.id, userId: pick(st.bdrs).id, role: 'bdr', splitBps: 2000, creditType: 'overlay' });

    if (['solution_design', 'proposal', 'negotiation', 'contract'].includes(opp.stage)) {
      mapValues.push({
        opportunityId: opp.id,
        name: `${opp.name} — mutual action plan`,
        status: 'in_progress',
        targetGoLiveDate: addDays(opp.closeDate, 45),
        sharedWithCustomerAt: new Date(Date.now() - between(5, 40) * 86_400_000),
      });
    }
  }

  await db.insert(s.opportunityProducts).values(oppProductValues);
  await db.insert(s.opportunityContactRoles).values(ocrValues);
  await db.insert(s.opportunityTeam).values(otmValues);
  const mapRows = mapValues.length ? await db.insert(s.mutualActionPlans).values(mapValues).returning() : [];

  const mapiValues: (typeof s.mutualActionPlanItems.$inferInsert)[] = [];
  for (const plan of mapRows) {
    const steps = [
      { name: 'Confirm success criteria', side: 'vendor', offset: -30 },
      { name: 'Technical validation', side: 'customer', offset: -21 },
      { name: 'Security and privacy review', side: 'customer', offset: -14, blocker: true },
      { name: 'Commercial proposal', side: 'vendor', offset: -10 },
      { name: 'Legal review', side: 'customer', offset: -5, blocker: true },
      { name: 'Signature', side: 'customer', offset: 0 },
    ];
    steps.forEach((step, i) => {
      const done = step.offset < -14;
      mapiValues.push({
        planId: plan.id,
        sequence: i,
        name: step.name,
        ownerSide: step.side,
        dueDate: addDays(plan.targetGoLiveDate ?? TODAY, step.offset),
        completedAt: done ? new Date(Date.now() - between(5, 30) * 86_400_000) : null,
        status: done ? 'completed' : 'in_progress',
        isBlocker: Boolean(step.blocker),
      });
    });
  }
  if (mapiValues.length) await db.insert(s.mutualActionPlanItems).values(mapiValues);

  // Stage history for the open pipeline, so velocity reporting has data.
  const STAGE_ORDER = ['srl', 'discovery', 'solution_design', 'proposal', 'negotiation', 'contract'];
  const shValues: (typeof s.stageHistory.$inferInsert)[] = [];
  for (const opp of openOppRows) {
    const idx = STAGE_ORDER.indexOf(opp.stage);
    if (idx < 0) continue;
    let cursor = Date.now() - (idx + 1) * between(8, 25) * 86_400_000;
    for (let i = 0; i <= idx; i++) {
      const duration = between(6, 28);
      shValues.push({
        opportunityId: opp.id,
        fromStage: i === 0 ? null : (STAGE_ORDER[i - 1] as never),
        toStage: STAGE_ORDER[i] as never,
        enteredAt: new Date(cursor),
        exitedAt: i === idx ? null : new Date(cursor + duration * 86_400_000),
        durationDays: i === idx ? null : duration,
        amountAtTransitionCents: opp.amountCents,
        closeDateAtTransition: opp.closeDate,
        userId: opp.ownerId,
      });
      cursor += duration * 86_400_000;
    }
  }
  await db.insert(s.stageHistory).values(shValues);

  /* --- won deals: driven through the real quote and booking engines ------ */
  log('booking', 'driving won deals through quote → approval → book → renewal');

  const wonSpecs = [
    { seats: 420, sku: 'SPOT-PLAT-ENT', discountBps: 2200, monthsAgo: 14, term: 12, modules: ['SPOT-MOD-SUBS', 'SPOT-MOD-RENEW'] },
    { seats: 260, sku: 'SPOT-PLAT-ENT', discountBps: 1500, monthsAgo: 11, term: 12, modules: ['SPOT-MOD-CS'] },
    { seats: 180, sku: 'SPOT-PLAT-PRO', discountBps: 800, monthsAgo: 9, term: 12, modules: ['SPOT-MOD-RENEW'] },
    { seats: 95, sku: 'SPOT-PLAT-PRO', discountBps: 3200, monthsAgo: 8, term: 12, modules: [] },
    { seats: 640, sku: 'SPOT-PLAT-ENT', discountBps: 2600, monthsAgo: 7, term: 24, modules: ['SPOT-MOD-SUBS', 'SPOT-ADD-AI'] },
    { seats: 70, sku: 'SPOT-PLAT-CORE', discountBps: 0, monthsAgo: 6, term: 12, modules: [] },
    { seats: 310, sku: 'SPOT-PLAT-ENT', discountBps: 1800, monthsAgo: 5, term: 12, modules: ['SPOT-MOD-SERVICE'] },
    { seats: 140, sku: 'SPOT-PLAT-PRO', discountBps: 1200, monthsAgo: 4, term: 12, modules: ['SPOT-ADD-MCP'] },
    { seats: 55, sku: 'SPOT-PLAT-CORE', discountBps: 600, monthsAgo: 3, term: 12, modules: [] },
    { seats: 480, sku: 'SPOT-PLAT-ENT', discountBps: 2900, monthsAgo: 2, term: 36, modules: ['SPOT-MOD-SUBS', 'SPOT-MOD-RENEW', 'SPOT-MOD-CS'] },
    { seats: 120, sku: 'SPOT-PLAT-PRO', discountBps: 900, monthsAgo: 2, term: 12, modules: [] },
    { seats: 220, sku: 'SPOT-PLAT-ENT', discountBps: 1400, monthsAgo: 1, term: 12, modules: ['SPOT-ADD-AI'] },
  ];

  const bookedSubscriptions: { subscriptionId: string; accountId: string; renewalId: string; renewalOpportunityId: string }[] = [];

  for (const spec of wonSpecs) {
    const account = nextAccount();
    const startDate = toIso(new Date(Date.UTC(
      Number(TODAY.slice(0, 4)),
      Number(TODAY.slice(5, 7)) - 1 - spec.monthsAgo,
      1,
    )));

    const edition = st.productBySku.get(spec.sku)!;
    const oppRows = await db
      .insert(s.opportunities)
      .values({
        name: `${account.name} — ${edition.name.replace('SpotOn Platform — ', '')} (${spec.seats} seats)`,
        accountId: account.id,
        type: 'new_logo',
        stage: 'contract',
        forecastCategory: 'commit',
        probabilityBps: 9000,
        currency: 'USD',
        amountCents: 0,
        arrCents: 0,
        termMonths: spec.term,
        closeDate: startDate,
        originalCloseDate: startDate,
        stageEnteredAt: new Date(new Date(startDate).getTime() - 10 * 86_400_000),
        nextStep: 'Countersignature',
        closePlan: 'Signed and countersigned.',
        competitors: ['Incumbent CRM'],
        ownerId: account.accountExecutiveId!,
        territoryId: account.territoryId,
        createdSource: account.originalSource,
        originalSource: account.originalSource,
        latestSource: account.latestSource,
        primaryCampaignId: account.originalCampaignId,
        description: 'Won new-logo deal, booked through the standard approval path.',
      })
      .returning();
    const opp = oppRows[0];

    // Contact roles are required by the stage gate.
    const contacts = st.contactsByAccount.get(account.id) ?? [];
    if (contacts.length > 0) {
      await db.insert(s.opportunityContactRoles).values(
        contacts.slice(0, 3).map((c) => ({
          opportunityId: opp.id,
          contactId: c.id,
          role: c.roleType,
          isPrimary: c.isChampion,
          influenceLevel: c.influenceLevel,
        })),
      );
    }

    /**
     * A discount deeper than the product's own ceiling has to be expressed as a
     * negotiated unit price rather than a percentage — that is the engine's
     * deliberate escape hatch, and it keeps the concession visible to the approval
     * chain instead of hidden inside a percentage nobody sanctioned.
     */
    const editionList =
      PRODUCT_CATALOGUE.find((p) => p.sku === spec.sku)?.listUnitCents ?? 132_000;
    const exceedsCeiling = spec.discountBps > edition.maxDiscountBps;

    const lines = [
      exceedsCeiling
        ? {
            productId: edition.id,
            quantity: spec.seats,
            netUnitCentsOverride: Math.round(editionList * (1 - spec.discountBps / 10_000)),
            discountReason: 'Negotiated price — competitive displacement, executive exception',
          }
        : {
            productId: edition.id,
            quantity: spec.seats,
            discountBps: spec.discountBps,
            discountReason: spec.discountBps > 2000 ? 'Competitive displacement' : undefined,
          },
      ...spec.modules.map((sku) => {
        const p = st.productBySku.get(sku)!;
        return {
          productId: p.id,
          quantity: p.unitOfMeasure === 'seat' ? spec.seats : 1,
          discountBps: Math.min(spec.discountBps, p.maxDiscountBps),
        };
      }),
    ];

    const { quote } = await createQuote(
      adminAuth,
      {
        opportunityId: opp.id,
        accountId: account.id,
        priceBookId: st.standardBook.id,
        termMonths: spec.term,
        startDate,
        billingFrequency: spec.term > 12 ? 'annual' : pick(['annual', 'annual', 'quarterly']),
        hasNonStandardTerms: spec.discountBps > 2500,
        nonStandardTermsDetail: spec.discountBps > 2500 ? 'Customer paper with a 90-day termination for convenience clause.' : null,
        lines,
      },
      adminCtx,
    );

    // Real approval chain.
    const submitted = await submitQuoteForApproval(adminAuth, quote.id, 'Competitive deal, discount required to win.', adminCtx);
    if (submitted.status === 'pending' && submitted.requestId) {
      let guard = 0;
      let requestId: string | null = submitted.requestId;
      while (requestId && guard++ < 8) {
        const decision = await decideApproval(adminAuth, requestId, 'approved', 'Approved — competitive justification accepted.', adminCtx);
        if (decision.requestStatus !== 'pending') break;
      }
    }

    await acceptQuote(adminAuth, quote.id, adminCtx);

    // Winning the deal provisions everything, including the renewal.
    const result = await changeStage(adminAuth, opp.id, 'closed_won', adminCtx);
    if (!result.ok) {
      throw new Error(
        `Seed failed to win ${opp.name}: ${result.failures.map((f) => f.label).join('; ')}`,
      );
    }
    if (result.provisioned) {
      bookedSubscriptions.push({
        subscriptionId: result.provisioned.subscriptionId,
        accountId: account.id,
        renewalId: result.provisioned.renewalId,
        renewalOpportunityId: result.provisioned.renewalOpportunityId,
      });
    }

    // Link the billing account onto the subscription.
    const billing = st.billingByAccount.get(account.id);
    if (billing && result.provisioned) {
      await db
        .update(s.subscriptions)
        .set({ billingAccountId: billing.id, csmId: account.csmId, renewalOwnerId: account.renewalManagerId })
        .where(eq(s.subscriptions.id, result.provisioned.subscriptionId));
    }
  }

  summary.wonOpportunities = wonSpecs.length;
  summary.subscriptions = bookedSubscriptions.length;
  log('booking', `${bookedSubscriptions.length} subscriptions with renewals created`);

  /* --- mid-term upsells and cross-sells, co-termed ---------------------- */
  log('amendments', 'applying co-termed mid-term expansions');

  let amendmentCount = 0;
  let rolledIntoRenewalCount = 0;

  for (const [i, booked] of bookedSubscriptions.entries()) {
    if (i % 3 !== 0) continue;

    const subRows = await db
      .select()
      .from(s.subscriptions)
      .where(eq(s.subscriptions.id, booked.subscriptionId))
      .limit(1);
    const sub = subRows[0];
    if (!sub || sub.status !== 'active') continue;

    // Effective a third of the way through the remaining term.
    const effectiveDate = addDays(TODAY, -between(20, 90));
    if (effectiveDate < sub.startDate || effectiveDate > sub.endDate) continue;

    const isCrossSell = i % 2 === 0;
    const product = isCrossSell
      ? st.productBySku.get(pick(['SPOT-MOD-CS', 'SPOT-MOD-SERVICE', 'SPOT-ADD-AI']))!
      : st.productBySku.get('SPOT-PLAT-ENT')!;

    const quantity = product.unitOfMeasure === 'seat' ? between(25, 90) : 1;
    const unit = product.unitOfMeasure === 'seat' ? between(60, 130) * 1000 : between(15, 30) * 100_000;

    const result = await amendSubscription(
      booked.subscriptionId,
      {
        type: isCrossSell ? 'cross_sell' : 'upsell',
        effectiveDate,
        lines: [{ productId: product.id, quantity, netUnitCents: unit, listUnitCents: unit, action: 'add' }],
        notes: isCrossSell
          ? 'Mid-term cross-sell, co-termed to the active subscription.'
          : 'Mid-term seat expansion, co-termed to the active subscription.',
      },
      adminCtx,
    );

    amendmentCount++;
    if (result.appliedToRenewalId) rolledIntoRenewalCount++;

    // Record the matching expansion opportunity as won, for pipeline reporting.
    const account = st.accountRows.find((a) => a.id === booked.accountId);
    await db.insert(s.opportunities).values({
      name: `${account?.name ?? 'Account'} — ${isCrossSell ? 'Cross-sell' : 'Seat expansion'} (mid-term)`,
      accountId: booked.accountId,
      type: isCrossSell ? 'cross_sell' : 'upsell',
      stage: 'closed_won',
      forecastCategory: 'closed',
      probabilityBps: 10_000,
      amountCents: result.proratedAmountCents,
      arrCents: result.annualizedArrCents,
      tcvCents: result.proratedAmountCents,
      expansionArrCents: result.annualizedArrCents,
      termMonths: 12,
      closeDate: effectiveDate,
      originalCloseDate: effectiveDate,
      isClosed: true,
      isWon: true,
      closedAt: new Date(effectiveDate),
      subscriptionId: booked.subscriptionId,
      isCoTermed: result.isCoTermed,
      coTermEndDate: result.coTermEndDate,
      ownerId: account?.accountExecutiveId ?? st.aes[0].id,
      createdSource: 'expansion_signal',
      description: `Co-termed to ${result.coTermEndDate}. Billed ${result.proratedAmountCents} now; full annual value of ${result.annualizedArrCents} rolled into the next renewal.`,
    });
  }
  summary.amendments = amendmentCount;
  summary.amendmentsRolledIntoRenewal = rolledIntoRenewalCount;
  log('amendments', `${amendmentCount} co-termed amendments, ${rolledIntoRenewalCount} rolled into renewals`);

  /* --- some churn and contraction, for the waterfall -------------------- */
  for (const [i, booked] of bookedSubscriptions.entries()) {
    if (i !== 3 && i !== 7) continue;
    const subRows = await db.select().from(s.subscriptions).where(eq(s.subscriptions.id, booked.subscriptionId)).limit(1);
    const sub = subRows[0];
    if (!sub || sub.status !== 'active') continue;

    const items = await db
      .select()
      .from(s.subscriptionItems)
      .where(eq(s.subscriptionItems.subscriptionId, sub.id));
    const removable = items.filter((it) => it.status === 'active').at(-1);
    if (!removable || items.filter((it) => it.status === 'active').length < 2) continue;

    await amendSubscription(
      sub.id,
      {
        type: 'contraction',
        effectiveDate: addDays(TODAY, -between(10, 50)),
        removeItemIds: [removable.id],
        notes: 'Customer reduced scope at mid-term following a reorganisation.',
      },
      adminCtx,
    );
    amendmentCount++;
  }
  summary.amendments = amendmentCount;

  /* --- lost deals -------------------------------------------------------- */
  const lostValues: (typeof s.opportunities.$inferInsert)[] = [];
  for (let i = 0; i < 14; i++) {
    const account = nextAccount();
    const seats = between(30, 400);
    const arr = seats * 120_000;
    const closeDate = addDays(TODAY, -between(20, 300));
    lostValues.push({
      name: `${account.name} — Platform evaluation`,
      accountId: account.id,
      type: 'new_logo',
      stage: 'closed_lost',
      forecastCategory: 'closed',
      probabilityBps: 0,
      amountCents: arr,
      arrCents: arr,
      termMonths: 12,
      closeDate,
      originalCloseDate: closeDate,
      isClosed: true,
      isWon: false,
      closedAt: new Date(closeDate),
      lossReason: pick(LOSS_REASONS),
      lossReasonDetail: 'Recorded at loss review.',
      competitorWonTo: chance(0.6) ? pick(['Competitor A', 'Competitor B', 'Incumbent CRM']) : null,
      ownerId: account.accountExecutiveId!,
      territoryId: account.territoryId,
      originalSource: account.originalSource,
      primaryCampaignId: account.originalCampaignId,
    });
  }
  await db.insert(s.opportunities).values(lostValues);
  summary.lostOpportunities = lostValues.length;

  /* --- attribution ------------------------------------------------------- */
  const allOpps = await db.select().from(s.opportunities);
  const attrValues: (typeof s.attributionTouches.$inferInsert)[] = [];
  for (const opp of allOpps) {
    if (!opp.primaryCampaignId) continue;
    const models = ['first_touch', 'last_touch', 'linear', 'opportunity_creation'] as const;
    for (const model of models) {
      attrValues.push({
        model,
        campaignId: opp.primaryCampaignId,
        sourceCategory: opp.channelMotion === 'partner_sourced' ? 'partner' : pick(['marketing', 'marketing', 'bdr']),
        opportunityId: opp.id,
        accountId: opp.accountId,
        creditType: opp.isWon ? 'revenue' : 'opportunity_created',
        occurredAt: new Date(new Date(opp.closeDate).getTime() - between(30, 200) * 86_400_000),
        weightBps: 10_000,
        creditedPipelineCents: opp.amountCents,
        creditedArrCents: opp.isWon ? opp.arrCents : 0,
        creditedRevenueCents: opp.isWon ? opp.arrCents : 0,
      });
    }
  }
  await db.insert(s.attributionTouches).values(attrValues);
  summary.attributionTouches = attrValues.length;

  /* --- deal registrations ------------------------------------------------ */
  const dregValues: (typeof s.dealRegistrations.$inferInsert)[] = [];
  for (let i = 0; i < 10; i++) {
    const partner = st.partnerAccountRows[i % st.partnerAccountRows.length];
    const endCustomer = st.accountRows[(i * 3) % st.accountRows.length];
    const status = i === 0 ? 'conflict' : i % 4 === 0 ? 'approved' : i % 4 === 1 ? 'submitted' : i % 4 === 2 ? 'converted' : 'rejected';
    dregValues.push({
      number: `REG-${String(i + 1).padStart(4, '0')}`,
      partnerAccountId: partner.id,
      endCustomerAccountId: endCustomer.id,
      endCustomerName: endCustomer.name,
      endCustomerDomain: endCustomer.domain,
      endCustomerCountry: endCustomer.country,
      status: status as never,
      estimatedArrCents: between(20, 180) * 100_000,
      productFamilies: ['Platform', 'Renewals'],
      expectedCloseDate: addDays(TODAY, between(30, 180)),
      submittedAt: new Date(Date.now() - between(10, 120) * 86_400_000),
      protectionDays: 90,
      protectionEndsAt: addDays(TODAY, between(-10, 80)),
      approvedMarginBps: status === 'approved' || status === 'converted' ? between(2000, 3000) : null,
      rejectionReason: status === 'rejected' ? 'Direct team already engaged with this account' : null,
      conflictWithOpportunityId: status === 'conflict' ? allOpps.find((o) => o.accountId === endCustomer.id)?.id ?? null : null,
      conflictResolution: status === 'conflict' ? 'Under review by channel leadership — direct team engaged first.' : null,
      notes: 'Submitted through the partner portal.',
    });
  }
  await db.insert(s.dealRegistrations).values(dregValues);
  summary.dealRegistrations = dregValues.length;

  await db.insert(s.partnerLeadDistributions).values(
    leadRows.slice(60, 72).map((l, i) => ({
      partnerAccountId: st.partnerAccountRows[i % st.partnerAccountRows.length].id,
      leadId: l.id,
      status: i % 3 === 0 ? 'accepted' : i % 3 === 1 ? 'sent' : 'rejected',
      sentAt: new Date(Date.now() - between(5, 60) * 86_400_000),
      acceptedAt: i % 3 === 0 ? new Date(Date.now() - between(1, 20) * 86_400_000) : null,
      rejectedAt: i % 3 === 2 ? new Date(Date.now() - between(1, 20) * 86_400_000) : null,
      rejectionReason: i % 3 === 2 ? 'Outside our territory' : null,
      slaHours: 48,
      slaDueAt: new Date(Date.now() - between(1, 40) * 86_400_000),
      slaBreached: i % 5 === 0,
    })),
  );

  /* --- product instances, usage ----------------------------------------- */
  const activeSubs = await db.select().from(s.subscriptions).where(eq(s.subscriptions.status, 'active'));

  const instanceValues: (typeof s.productInstances.$inferInsert)[] = [];
  for (const sub of activeSubs) {
    instanceValues.push({
      accountId: sub.accountId,
      subscriptionId: sub.id,
      productId: st.productBySku.get('SPOT-PLAT-ENT')!.id,
      name: `${sub.number} production tenant`,
      environment: 'production',
      region: pick(['us-east-1', 'eu-west-1', 'ap-southeast-2']),
      version: pick(['2026.1', '2026.2', '2025.4']),
      status: 'active',
      externalTenantId: `tenant_${sub.id.slice(-8)}`,
      provisionedAt: new Date(new Date(sub.startDate).getTime() + 3 * 86_400_000),
      lastHeartbeatAt: new Date(Date.now() - between(0, 48) * 3_600_000),
    });
    if (chance(0.5)) {
      instanceValues.push({
        accountId: sub.accountId,
        subscriptionId: sub.id,
        productId: st.productBySku.get('SPOT-ADD-SANDBOX')!.id,
        name: `${sub.number} sandbox`,
        environment: 'sandbox',
        region: 'us-east-1',
        version: '2026.2',
        status: 'active',
        provisionedAt: new Date(new Date(sub.startDate).getTime() + 10 * 86_400_000),
      });
    }
  }
  await db.insert(s.productInstances).values(instanceValues);

  // Six months of usage per subscription, with distinct adoption personalities.
  const usageValues: (typeof s.usageMetrics.$inferInsert)[] = [];
  for (const [subIdx, sub] of activeSubs.entries()) {
    const items = await db
      .select()
      .from(s.subscriptionItems)
      .where(eq(s.subscriptionItems.subscriptionId, sub.id));
    const seatItems = items.filter((it) => it.status === 'active' && it.quantity > 5);
    const licensed = Math.max(20, seatItems.reduce((m, it) => Math.max(m, it.quantity), 0));

    // Three archetypes: thriving, drifting, and shelfware.
    const archetype = subIdx % 5 === 0 ? 'shelfware' : subIdx % 3 === 0 ? 'drifting' : 'thriving';
    let utilisation = archetype === 'thriving' ? 0.72 : archetype === 'drifting' ? 0.55 : 0.28;

    for (let m = 5; m >= 0; m--) {
      const periodStart = `${addMonths(`${TODAY.slice(0, 7)}-01`, -m).slice(0, 7)}-01`;
      const periodEnd = termEndDate(periodStart, 1);

      utilisation +=
        archetype === 'thriving' ? 0.035 : archetype === 'drifting' ? -0.02 : -0.015;
      utilisation = Math.max(0.05, Math.min(0.99, utilisation));

      const active = Math.max(1, Math.round(licensed * utilisation));
      const prevActive = usageValues.at(-1)?.activeUsers ?? active;
      const commitment = 1_000_000;
      const volume = Math.round(commitment * (archetype === 'thriving' ? 0.6 + rng() * 0.7 : 0.2 + rng() * 0.5));

      usageValues.push({
        accountId: sub.accountId,
        subscriptionId: sub.id,
        productId: st.productBySku.get('SPOT-PLAT-ENT')!.id,
        periodStart,
        periodEnd,
        grain: 'monthly',
        licensedUsers: licensed,
        activeUsers: active,
        newUsers: Math.max(0, active - prevActive),
        churnedUsers: Math.max(0, prevActive - active),
        utilisationBps: ratioBps(active, licensed),
        logins: active * between(8, 26),
        featureAdoptionBps: archetype === 'thriving' ? between(6500, 9200) : archetype === 'drifting' ? between(3500, 6000) : between(800, 3000),
        featuresUsed: pickN(['pipeline', 'forecasting', 'renewals', 'health', 'approvals', 'reporting'], between(2, 6)),
        usageVolume: volume,
        commitmentVolume: commitment,
        consumptionBps: ratioBps(volume, commitment),
        overageVolume: Math.max(0, volume - commitment),
        adminActions: between(0, 40),
        lastActivityAt: new Date(Date.now() - (m === 0 ? between(0, archetype === 'shelfware' ? 40 : 5) : between(30, 60)) * 86_400_000),
        daysSinceLastActivity: m === 0 ? between(0, archetype === 'shelfware' ? 40 : 5) : between(30, 60),
        trendBps: ratioBps(active - prevActive, Math.max(1, prevActive)),
      });
    }
  }
  await db.insert(s.usageMetrics).values(usageValues);
  summary.usageMetrics = usageValues.length;

  /* --- success plans ---------------------------------------------------- */
  const customerAccountIds = [...new Set(activeSubs.map((x) => x.accountId))];
  const planValues: (typeof s.successPlans.$inferInsert)[] = [];
  for (const accountId of customerAccountIds) {
    const account = st.accountRows.find((a) => a.id === accountId);
    if (!account) continue;
    const contacts = st.contactsByAccount.get(accountId) ?? [];
    const exec = contacts.find((c) => c.roleType === 'executive_sponsor');
    const ttv = between(35, 140);
    planValues.push({
      accountId,
      name: `${account.name} — success plan`,
      status: 'in_progress',
      lifecycleStage: pick(['onboarding', 'adopting', 'established', 'established']) as never,
      csmId: account.csmId,
      executiveSponsorContactId: exec?.id ?? null,
      ourExecutiveSponsorId: st.userByEmail.get('vpcs@spoton.dev')!.id,
      startDate: addDays(TODAY, -between(60, 400)),
      targetGoLiveDate: addDays(TODAY, -between(10, 300)),
      actualGoLiveDate: addDays(TODAY, -between(5, 280)),
      timeToValueDays: ttv,
      onboardingProgressBps: between(5000, 10_000),
      sentiment: account.sentiment ?? 'neutral',
      referenceStatus: pick(['none', 'willing', 'referenceable', 'public_advocate']),
      renewalReadinessBps: between(4000, 9500),
      lastReviewedAt: new Date(Date.now() - between(20, 200) * 86_400_000),
      nextReviewAt: new Date(Date.now() + between(10, 90) * 86_400_000),
      notes: 'Consolidating revenue operations; expansion into service and success modules planned.',
    });
  }
  const planRows = await db.insert(s.successPlans).values(planValues).returning();
  summary.successPlans = planRows.length;

  const objectiveValues: (typeof s.successPlanObjectives.$inferInsert)[] = [];
  const milestoneValues: (typeof s.successPlanMilestones.$inferInsert)[] = [];
  for (const plan of planRows) {
    const objectives = [
      { name: 'Reduce renewal cycle time', metric: 'Days from renewal open to signature', target: '45 days', current: `${between(38, 90)} days` },
      { name: 'Single source of ARR truth', metric: 'Manual reconciliations per quarter', target: '0', current: String(between(0, 4)) },
      { name: 'Improve forecast accuracy', metric: 'Forecast variance', target: 'Within 5%', current: `${between(3, 18)}%` },
    ];
    for (const o of pickN(objectives, between(2, 3))) {
      objectiveValues.push({
        planId: plan.id,
        name: o.name,
        desiredOutcome: `${o.name} measurably improved within two quarters.`,
        metric: o.metric,
        targetValue: o.target,
        currentValue: o.current,
        status: pick(['in_progress', 'in_progress', 'completed']) as never,
        dueDate: addDays(TODAY, between(-40, 150)),
      });
    }
    const phases = [
      { name: 'Kickoff complete', phase: 'kickoff', offset: -150 },
      { name: 'Configuration signed off', phase: 'configuration', offset: -110 },
      { name: 'Integrations live', phase: 'integration', offset: -80 },
      { name: 'Administrator training delivered', phase: 'training', offset: -60 },
      { name: 'Go live', phase: 'go_live', offset: -40, value: true },
      { name: 'First value review', phase: 'adoption', offset: 15, value: true },
    ];
    phases.forEach((p, i) => {
      const done = p.offset < -20;
      milestoneValues.push({
        planId: plan.id,
        name: p.name,
        phase: p.phase,
        sequence: i,
        dueDate: addDays(TODAY, p.offset),
        completedAt: done ? new Date(Date.now() + p.offset * 86_400_000) : null,
        status: done ? 'completed' : 'in_progress',
        ownerId: plan.csmId,
        isValueMilestone: Boolean(p.value),
      });
    });
  }
  await db.insert(s.successPlanObjectives).values(objectiveValues);
  await db.insert(s.successPlanMilestones).values(milestoneValues);

  await db.insert(s.businessReviews).values(
    planRows.slice(0, 14).map((p, i) => ({
      accountId: p.accountId,
      successPlanId: p.id,
      type: i % 3 === 0 ? 'EBR' : 'QBR',
      status: i % 4 === 0 ? 'scheduled' : 'held',
      scheduledAt: new Date(Date.now() + (i % 4 === 0 ? between(10, 60) : -between(10, 120)) * 86_400_000),
      heldAt: i % 4 === 0 ? null : new Date(Date.now() - between(10, 120) * 86_400_000),
      executiveAttended: i % 3 === 0,
      sentiment: pick(['positive', 'neutral', 'very_positive', 'negative'] as const),
      outcomes: 'Agreed adoption plan and confirmed renewal intent.',
    })),
  );

  /* --- risks, CTAs ------------------------------------------------------- */
  const riskValues: (typeof s.risks.$inferInsert)[] = [];
  for (const [i, accountId] of customerAccountIds.entries()) {
    if (i % 3 !== 0) continue;
    const account = st.accountRows.find((a) => a.id === accountId);
    const template = pick(RISK_TEMPLATES);
    riskValues.push({
      accountId,
      type: template.type,
      severity: template.severity as never,
      status: i % 9 === 0 ? 'resolved' : 'open',
      title: template.title,
      description: 'Identified during the account review.',
      mitigationPlan: 'Executive sponsor engaged; remediation plan agreed with the customer.',
      arrAtRiskCents: Math.round((account?.currentArrCents ?? 0) * (0.2 + rng() * 0.5)),
      ownerId: account?.csmId ?? st.csms[0].id,
      identifiedAt: new Date(Date.now() - between(5, 120) * 86_400_000),
      dueDate: addDays(TODAY, between(5, 60)),
      resolvedAt: i % 9 === 0 ? new Date(Date.now() - between(1, 20) * 86_400_000) : null,
      resolution: i % 9 === 0 ? 'Adoption recovered after enablement sprint.' : null,
      detectedBy: pick(['manual', 'health_model', 'usage_signal', 'support_trend']),
    });
  }
  const riskRows = await db.insert(s.risks).values(riskValues).returning();
  summary.risks = riskRows.length;

  await db.insert(s.callsToAction).values(
    riskRows.filter((r) => r.status === 'open').map((r) => ({
      accountId: r.accountId,
      riskId: r.id,
      type: 'risk',
      title: `Work the ${r.type.replace(/_/g, ' ')} risk`,
      description: r.mitigationPlan,
      status: 'in_progress' as const,
      priority: (r.severity === 'critical'
        ? 'urgent'
        : r.severity === 'high'
          ? 'high'
          : 'medium') as 'urgent' | 'high' | 'medium',
      dueDate: r.dueDate,
      ownerId: r.ownerId,
    })),
  );

  /* --- service tickets --------------------------------------------------- */
  log('service', 'creating tickets through the SLA engine');
  let caseCount = 0;
  for (const [i, accountId] of customerAccountIds.entries()) {
    const account = st.accountRows.find((a) => a.id === accountId);
    if (!account) continue;
    const contacts = st.contactsByAccount.get(accountId) ?? [];
    const sub = activeSubs.find((x) => x.accountId === accountId);
    const n = between(1, 5);

    for (let k = 0; k < n; k++) {
      const severity = k === 0 && i % 6 === 0 ? 1 : pick([2, 3, 3, 3, 4]);
      const created = await createCase(
        adminAuth,
        {
          accountId,
          contactId: contacts[k % Math.max(1, contacts.length)]?.id ?? null,
          subscriptionId: sub?.id ?? null,
          productId: st.productBySku.get('SPOT-PLAT-ENT')!.id,
          subject: pick(CASE_SUBJECTS),
          description: 'Reported through the support portal with diagnostic logs attached.',
          type: pick(['question', 'defect', 'incident', 'billing', 'onboarding']),
          severity,
          channel: pick(['portal', 'email', 'phone', 'chat']),
          ownerId: pick(st.supportEngineers).id,
        },
        adminCtx,
      );
      caseCount++;

      // Backdate so ageing and SLA reporting are meaningful.
      const openedAt = new Date(Date.now() - between(1, 120) * 86_400_000);
      await db.update(s.cases).set({ openedAt }).where(eq(s.cases.id, created.id));

      if (chance(0.85)) {
        await addComment(adminAuth, created.id, 'Thanks for the report — investigating now and will update within the hour.', true, adminCtx);
      }
      if (chance(0.65)) {
        await resolveCase(adminAuth, created.id, 'Root cause identified and configuration corrected. Verified with the customer.', adminCtx);
      } else if (severity <= 2 && chance(0.5)) {
        await escalateCase(adminAuth, created.id, 'Severity-1 unresolved beyond the agreed window; engineering engaged.', adminCtx);
      }
    }
  }
  summary.cases = caseCount;
  log('service', `${caseCount} tickets`);

  await db.insert(s.productDefects).values([
    { key: 'SPOT-1042', title: 'Renewal notice date off by one day in leap years', productId: st.productBySku.get('SPOT-MOD-RENEW')!.id, severity: 3, status: 'resolved', affectedVersions: ['2025.4'], resolvedInVersion: '2026.1', resolvedAt: new Date(Date.now() - 40 * 86_400_000), linkedCaseCount: 3, arrImpactedCents: 0 },
    { key: 'SPOT-1119', title: 'Bulk export times out beyond 50,000 rows', productId: st.productBySku.get('SPOT-PLAT-ENT')!.id, severity: 2, status: 'open', affectedVersions: ['2026.1', '2026.2'], targetFixDate: addDays(TODAY, 35), linkedCaseCount: 7, arrImpactedCents: 42_000_000 },
    { key: 'SPOT-1203', title: 'Multi-currency forecast roll-up ignores FX effective date', productId: st.productBySku.get('SPOT-PLAT-ENT')!.id, severity: 2, status: 'open', affectedVersions: ['2026.2'], targetFixDate: addDays(TODAY, 20), linkedCaseCount: 4, arrImpactedCents: 28_000_000 },
    { key: 'SPOT-0987', title: 'Sandbox refresh does not copy field-level security', productId: st.productBySku.get('SPOT-ADD-SANDBOX')!.id, severity: 3, status: 'open', isKnownLimitation: true, affectedVersions: ['2026.1'], linkedCaseCount: 2, arrImpactedCents: 0 },
  ]);

  /* --- activities -------------------------------------------------------- */
  const activityValues: (typeof s.activities.$inferInsert)[] = [];
  for (const opp of allOpps.slice(0, 90)) {
    const contacts = st.contactsByAccount.get(opp.accountId) ?? [];
    const n = between(2, 7);
    for (let i = 0; i < n; i++) {
      const contact = contacts[i % Math.max(1, contacts.length)];
      const type = pick(['email', 'call', 'meeting', 'demo', 'note'] as const);
      const inbound = chance(0.35);
      activityValues.push({
        type,
        subject: pick(['Discovery call', 'Pricing discussion', 'Security review follow-up', 'Executive briefing', 'Technical deep dive', 'Procurement check-in', 'Renewal planning']),
        body: 'Discussed scope, timelines and the commercial structure.',
        direction: inbound ? 'inbound' : 'outbound',
        occurredAt: new Date(Date.now() - between(1, 120) * 86_400_000),
        durationMinutes: type === 'meeting' || type === 'demo' ? between(30, 90) : type === 'call' ? between(10, 45) : null,
        accountId: opp.accountId,
        contactId: contact?.id ?? null,
        opportunityId: opp.id,
        ownerId: opp.ownerId,
        source: pick(['manual', 'email_sync', 'calendar_sync', 'call_intelligence']),
        sentiment: pick(['neutral', 'positive', 'positive', 'very_positive', 'negative']) as never,
        summary: 'Customer confirmed the business case; procurement is the remaining gate.',
        objections: chance(0.4) ? pickN(['Price above budget', 'Migration effort', 'Change management', 'Contract length'], between(1, 2)) : [],
        competitorMentions: chance(0.35) ? pickN(['Competitor A', 'Incumbent CRM'], 1) : [],
        commitments: chance(0.5) ? ['Send revised pricing by Friday', 'Introduce the security team'] : [],
        nextSteps: pick(['Send revised proposal', 'Book executive session', 'Await legal redlines', null]),
        isCustomerResponse: inbound,
        contactRole: contact?.roleType ?? null,
        recordingUrl: type === 'call' && chance(0.3) ? 'https://recordings.example/abc123' : null,
      });
    }
  }
  await db.insert(s.activities).values(activityValues);
  summary.activities = activityValues.length;

  const taskValues: (typeof s.tasks.$inferInsert)[] = [];
  for (const opp of allOpps.filter((o) => !o.isClosed).slice(0, 60)) {
    taskValues.push({
      title: pick(['Confirm next step with champion', 'Chase procurement', 'Update close plan', 'Schedule security review', 'Send mutual action plan']),
      status: pick(['open', 'open', 'in_progress', 'completed']) as never,
      priority: pick(['low', 'medium', 'high', 'urgent']) as never,
      dueDate: addDays(TODAY, between(-10, 30)),
      ownerId: opp.ownerId,
      accountId: opp.accountId,
      opportunityId: opp.id,
      source: 'manual',
    });
  }
  await db.insert(s.tasks).values(taskValues);
  summary.tasks = taskValues.length;

  /* --- invoices ---------------------------------------------------------- */
  const invoiceValues: (typeof s.invoices.$inferInsert)[] = [];
  let invoiceNo = 1;
  for (const sub of activeSubs) {
    const billing = st.billingByAccount.get(sub.accountId);
    if (!billing) continue;
    const periods = sub.billingFrequency === 'quarterly' ? 4 : 1;
    const per = Math.round(sub.currentArrCents / periods);
    for (let p = 0; p < periods; p++) {
      const issued = addDays(sub.startDate, p * Math.round(365 / periods));
      if (issued > TODAY) continue;
      const paid = chance(0.85);
      invoiceValues.push({
        number: `INV-${String(invoiceNo++).padStart(5, '0')}`,
        billingAccountId: billing.id,
        accountId: sub.accountId,
        subscriptionId: sub.id,
        status: paid ? 'paid' : 'issued',
        currency: sub.currency,
        amountCents: per,
        taxCents: Math.round(per * 0.08),
        paidCents: paid ? per : 0,
        periodStart: issued,
        periodEnd: addDays(issued, Math.round(365 / periods) - 1),
        issuedAt: issued,
        dueAt: addDays(issued, 30),
        paidAt: paid ? addDays(issued, between(5, 40)) : null,
        externalInvoiceId: `zuora_inv_${invoiceNo}`,
      });
    }
  }
  if (invoiceValues.length) await db.insert(s.invoices).values(invoiceValues);
  summary.invoices = invoiceValues.length;

  /* --- run the jobs: health, renewal risk, signals, snapshots ---------- */
  log('jobs', 'scoring health, renewal risk and usage signals');
  const health = await scoreAllAccounts(adminCtx);
  summary.healthScored = health.scored;

  const renewalRisk = await refreshRenewalRisk(adminCtx);
  summary.renewalsAssessed = renewalRisk.assessed;

  const signals = await detectSignals(adminCtx);
  summary.usageSignals = signals.signals;
  summary.aiInsights = signals.insights;

  /* --- forecasts --------------------------------------------------------- */
  const forecastValues: (typeof s.forecasts.$inferInsert)[] = [];
  for (const quarter of st.quarters) {
    for (const ae of st.aes) {
      const quotaRows = await db
        .select()
        .from(s.quotas)
        .where(eq(s.quotas.userId, ae.id));
      const quota = quotaRows.find((q) => q.fiscalPeriod === quarter)?.targetCents ?? 0;
      const closed = between(0, Math.round(quota / 100));
      const commit = between(0, Math.round(quota / 150));
      forecastValues.push({
        level: 'rep',
        ownerId: ae.id,
        teamId: ae.teamId,
        fiscalPeriod: quarter,
        periodType: 'quarter',
        revenueType: 'new',
        metric: 'arr',
        quotaCents: quota,
        closedWonCents: closed * 100,
        commitCents: commit * 100,
        bestCaseCents: between(0, Math.round(quota / 120)) * 100,
        pipelineCents: between(0, Math.round(quota / 60)) * 100,
        judgmentCents: (closed + commit) * 100,
        submittedCents: (closed + commit) * 100,
        isSubmitted: quarter <= fiscalQuarter(TODAY),
        submittedAt: quarter <= fiscalQuarter(TODAY) ? new Date() : null,
        submittedById: ae.id,
        commentary: 'Coverage is adequate; two commit deals depend on procurement timing.',
      });
    }
  }
  const forecastRows = await db.insert(s.forecasts).values(forecastValues).returning();
  summary.forecasts = forecastRows.length;

  // Historical submissions, so accuracy and bias are measurable.
  const snapValues: (typeof s.forecastSnapshots.$inferInsert)[] = [];
  for (const f of forecastRows.filter((x) => x.isSubmitted)) {
    for (const weeksAgo of [8, 6, 4, 2, 0]) {
      snapValues.push({
        forecastId: f.id,
        fiscalPeriod: f.fiscalPeriod,
        asOfDate: addDays(TODAY, -weeksAgo * 7),
        level: f.level,
        ownerId: f.ownerId,
        revenueType: f.revenueType,
        submittedCents: Math.round(f.submittedCents * (0.75 + weeksAgo * 0.03)),
        commitCents: Math.round(f.commitCents * (0.7 + weeksAgo * 0.04)),
        bestCaseCents: f.bestCaseCents,
        pipelineCents: f.pipelineCents,
        closedWonCents: Math.round(f.closedWonCents * (1 - weeksAgo * 0.08)),
        changeSincePriorCents: between(-40, 60) * 10_000,
        payload: { note: 'Weekly submission snapshot' },
      });
    }
  }
  await db.insert(s.forecastSnapshots).values(snapValues);
  summary.forecastSnapshots = snapValues.length;

  // Pipeline and ARR snapshots across several dates, for movement analysis.
  for (const daysAgo of [21, 14, 7, 0]) {
    await takeSnapshots(addDays(TODAY, -daysAgo));
  }

  await db.insert(s.savedReports).values([
    { name: 'ARR waterfall by month', objectType: 'arr_movements', kind: 'waterfall', groupBy: ['fiscalPeriod'], aggregates: [{ field: 'arrDeltaCents', fn: 'sum' }], isSystem: true, description: 'New, expansion, uplift, contraction and churn by period.' },
    { name: 'Renewal book — next 180 days', objectType: 'renewals', kind: 'table', filters: [{ field: 'status', op: 'in', value: ['not_started', 'in_progress', 'quoted', 'committed'] }], columns: ['accountId', 'renewalDate', 'renewableArrCents', 'expectedArrCents', 'riskLevel'], isSystem: true },
    { name: 'Pipeline by stage', objectType: 'opportunities', kind: 'summary', groupBy: ['stage'], aggregates: [{ field: 'arrCents', fn: 'sum' }], isSystem: true },
    { name: 'Accounts at risk', objectType: 'accounts', kind: 'table', filters: [{ field: 'healthScore', op: 'lte', value: 60 }], columns: ['name', 'currentArrCents', 'healthScore', 'csmId'], isSystem: true },
    { name: 'Stage conversion funnel', objectType: 'stage_history', kind: 'funnel', groupBy: ['toStage'], isSystem: true },
    { name: 'Campaign ROI', objectType: 'campaigns', kind: 'table', columns: ['name', 'type', 'actualCostCents'], isSystem: true },
  ]);

  /* --- data quality and duplicates -------------------------------------- */
  const dqValues: (typeof s.dataQualityIssues.$inferInsert)[] = [];
  const oppsMissingNextStep = allOpps.filter((o) => !o.isClosed && !o.nextStep).slice(0, 12);
  for (const o of oppsMissingNextStep) {
    dqValues.push({
      objectType: 'opportunities',
      recordId: o.id,
      rule: 'Next step required from Discovery onwards',
      field: 'nextStep',
      severity: 'warning',
      detail: `${o.name} has no recorded next step`,
      status: 'open',
      ownerId: o.ownerId,
    });
  }
  const contactsNoEmail = (await db.select().from(s.contacts).limit(400)).filter((c) => !c.email).slice(0, 8);
  for (const c of contactsNoEmail) {
    dqValues.push({ objectType: 'contacts', recordId: c.id, rule: 'Email required for engagement tracking', field: 'email', severity: 'error', detail: `${c.firstName} ${c.lastName} has no email address`, status: 'open' });
  }
  if (dqValues.length) await db.insert(s.dataQualityIssues).values(dqValues);
  summary.dataQualityIssues = dqValues.length;

  // Genuine duplicate pairs, including a cross-object one.
  const dupLeads = await db.select().from(s.leads).limit(30);
  const dupValues: (typeof s.duplicateCandidates.$inferInsert)[] = [];
  for (let i = 0; i + 1 < 8; i += 2) {
    dupValues.push({
      objectType: 'leads',
      recordAId: dupLeads[i].id,
      recordBId: dupLeads[i + 1].id,
      scoreBps: between(6000, 9500),
      matchedOn: ['surname', 'email domain'],
      status: 'open',
    });
  }
  const someContact = (await db.select().from(s.contacts).limit(1))[0];
  if (someContact && dupLeads[10]) {
    dupValues.push({
      objectType: 'leads',
      recordAId: dupLeads[10].id,
      recordBId: someContact.id,
      scoreBps: 9200,
      matchedOn: ['email'],
      status: 'open',
      crossObject: true,
      otherObjectType: 'contacts',
    });
  }
  await db.insert(s.duplicateCandidates).values(dupValues);
  summary.duplicateCandidates = dupValues.length;

  /* --- notifications ---------------------------------------------------- */
  await db.insert(s.notifications).values([
    { userId: st.userByEmail.get('vpsales@spoton.dev')!.id, title: 'Two commit deals show execution risk', body: 'Deal inspection flagged missing next meetings on commit-category opportunities.', level: 'high', link: '/insights' },
    { userId: st.renewalMgrs[0].id, title: 'Renewal notice window opens in 14 days', body: 'Three renewals enter their notice window this month.', level: 'high', link: '/renewals' },
    { userId: st.csms[0].id, title: 'Health dropped on two accounts', body: 'Licence utilisation fell below 40% on two managed accounts.', level: 'medium', link: '/health' },
    { userId: st.userByEmail.get('dealdesk@spoton.dev')!.id, title: 'Quote awaiting deal desk review', body: 'A quote with non-standard terms is pending your approval.', level: 'urgent', link: '/approvals' },
  ]);

  /* --- integration event history ---------------------------------------- */
  const connections = await db.select().from(s.integrationConnections);
  const eventValues: (typeof s.integrationEvents.$inferInsert)[] = [];
  for (const conn of connections) {
    for (let i = 0; i < between(3, 9); i++) {
      const failed = chance(0.12);
      const dead = failed && chance(0.3);
      eventValues.push({
        connectionId: conn.id,
        direction: conn.direction === 'inbound' ? 'inbound' : 'outbound',
        eventType: pick(['record.upserted', 'subscription.created', 'invoice.paid', 'contact.synced', 'usage.reported', 'envelope.completed']),
        objectType: pick(['accounts', 'subscriptions', 'contacts', 'invoices']),
        payload: { simulated: true, batch: i },
        status: dead ? 'dead_letter' : failed ? 'retrying' : 'succeeded',
        attempts: dead ? 5 : failed ? between(1, 3) : 1,
        lastError: failed ? `${conn.system} responded 503` : null,
        nextRetryAt: failed && !dead ? new Date(Date.now() + 300_000) : null,
        processedAt: failed ? null : new Date(Date.now() - between(1, 40) * 3_600_000),
        externalId: `${conn.system}_${between(10_000, 99_999)}`,
        lineage: { receivedFrom: conn.system, receivedAt: new Date().toISOString() },
      });
    }
  }
  await db.insert(s.integrationEvents).values(eventValues);
  summary.integrationEvents = eventValues.length;

  for (const conn of connections) {
    await db.insert(s.externalIds).values({
      objectType: 'accounts',
      recordId: st.accountRows[0].id,
      system: conn.system,
      externalId: `${conn.system}_acct_${st.accountRows[0].id.slice(-6)}`,
      lastSyncedAt: new Date(),
    }).onConflictDoNothing();
  }

  /* --- final ARR reconciliation ----------------------------------------- */
  const finalArr = await db
    .select({ value: sql<number>`coalesce(sum(${s.accounts.currentArrCents}), 0)::bigint` })
    .from(s.accounts);
  summary.totalArrCents = Number(finalArr[0]?.value ?? 0);

  const ledger = await db
    .select({ value: sql<number>`coalesce(sum(${s.arrMovements.arrDeltaCents}), 0)::bigint` })
    .from(s.arrMovements);
  summary.ledgerArrCents = Number(ledger[0]?.value ?? 0);

  return summary;
}

/* ---------------------------------------------------------------------- main */

async function main() {
  const handle = await getDbHandle();
  await runMigrations(handle.db);

  const existing = await handle.db.select({ id: s.roles.id }).from(s.roles).limit(1);
  if (existing.length > 0) {
    console.log('[seed] database already contains data — run `npm run db:reset` first');
    await handle.close();
    return;
  }

  const start = Date.now();
  const { summary } = await seed();

  console.log('\n[seed] complete in %ss\n', ((Date.now() - start) / 1000).toFixed(1));
  const width = Math.max(...Object.keys(summary).map((k) => k.length));
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k.padEnd(width)}  ${typeof v === 'number' ? v.toLocaleString('en-US') : v}`);
  }
  console.log('\n  Sign in at http://localhost:3000 with admin@spoton.dev / %s\n', SEED_PASSWORD);

  await handle.close();
}

if (process.argv[1]?.includes('seed')) {
  main().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });
}
