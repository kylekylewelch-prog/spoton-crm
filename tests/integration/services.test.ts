import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import * as s from '@/db/schema';
import { setupDatabase, type TestHarness } from '../helpers/db';
import {
  acceptLead,
  convertLead,
  findDuplicates,
  rejectLead,
  rescoreLead,
  routeLead,
  sweepLeadSlaBreaches,
} from '@/server/services/leads';
import {
  addComment,
  createCase,
  escalateCase,
  resolveCase,
  sweepCaseSlaBreaches,
  accountSupportSummary,
} from '@/server/services/cases';
import { scoreAccountHealth, refreshRenewalRisk, detectSignals } from '@/server/services/health';
import {
  acquisitionFunnel,
  arrWaterfall,
  executiveDashboard,
  expansionWhitespace,
  forecastForPeriod,
  healthDistribution,
  pipelineHealth,
  renewalBook,
  retentionMetrics,
  slaAttainment,
  takeSnapshots,
} from '@/server/services/analytics';
import { emitEvent, deliverEvent, processRetryQueue, integrationHealth, linkExternalId, resolveByExternalId, receiveEvent } from '@/server/services/integrations';
import { changeCloseDate, previewStageChange, setRevenueSplits } from '@/server/services/opportunities';
import { fiscalQuarter, today, addDays } from '@/domain/dates';

let h: TestHarness;

beforeAll(async () => {
  h = await setupDatabase({ withSeed: true });
}, 240_000);

afterAll(async () => {
  await h?.close();
});

/* ----------------------------------------------------------------- leads */

describe('lead management', () => {
  it('scores a lead across all dimensions', async () => {
    const lead = (await h.db.select().from(s.leads).limit(1))[0];
    const ctx = await h.ctx('admin@spoton.dev');

    const result = await rescoreLead(lead.id, ctx);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
    expect(result.detail).toHaveProperty('fit');
    expect(result.detail).toHaveProperty('intent');
  });

  it('routes a lead and starts a response SLA timer', async () => {
    const ctx = await h.ctx('admin@spoton.dev');
    const lead = (
      await h.db.insert(s.leads).values({
        lastName: 'RoutingProbe',
        email: 'routing.probe@northwind.example',
        company: 'Northwind Logistics',
        region: 'NA',
        country: 'US',
        industry: 'Manufacturing',
        employeeCount: 8400,
        source: 'form',
        status: 'new',
      }).returning()
    )[0];

    const decision = await routeLead(lead.id, ctx);
    expect(decision.ownerId).toBeTruthy();
    expect(decision.slaMinutes).toBeGreaterThan(0);
    expect(decision.slaDueAt).toBeTruthy();
    expect(decision.reason.length).toBeGreaterThan(0);

    const timers = await h.db
      .select()
      .from(s.slaTimers)
      .where(and(eq(s.slaTimers.objectType, 'leads'), eq(s.slaTimers.recordId, lead.id)));
    expect(timers).toHaveLength(1);
    expect(timers[0].status).toBe('running');
  });

  it('routes a known-domain lead to the existing account owner', async () => {
    const ctx = await h.ctx('admin@spoton.dev');
    const account = (
      await h.db.select().from(s.accounts).where(sql`${s.accounts.domain} is not null`).limit(1)
    )[0];

    const lead = (
      await h.db.insert(s.leads).values({
        lastName: 'NamedAccount',
        email: `named.account@${account.domain}`,
        company: account.name,
        region: account.region,
        source: 'form',
        status: 'new',
      }).returning()
    )[0];

    const decision = await routeLead(lead.id, ctx);
    expect(decision.ownerId).toBe(account.ownerId);
    expect(decision.reason).toMatch(/already owned/i);
  });

  it('detects duplicates within leads and across to contacts', async () => {
    const contact = (
      await h.db.select().from(s.contacts).where(sql`${s.contacts.email} is not null`).limit(1)
    )[0];

    const result = await findDuplicates({
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
    });

    expect(result.bestScoreBps).toBeGreaterThan(8000);
    expect(result.suggestion).toBe('attach_to_contact');
    expect(result.contactMatches.length).toBeGreaterThan(0);
  });

  it('suggests creating a genuinely new record', async () => {
    const result = await findDuplicates({
      email: 'nobody.unique.xyz@brand-new-domain.example',
      firstName: 'Xanthe',
      lastName: 'Quibblesworth',
    });
    expect(result.suggestion).toBe('create');
  });

  it('accepts a lead and stops the SLA clock', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');

    const lead = (
      await h.db.insert(s.leads).values({
        lastName: 'AcceptProbe',
        email: 'accept.probe@example.com',
        source: 'form',
        status: 'working',
        slaDueAt: new Date(Date.now() + 3_600_000),
      }).returning()
    )[0];

    await h.db.insert(s.slaTimers).values({
      objectType: 'leads',
      recordId: lead.id,
      name: 'lead_first_touch',
      targetMinutes: 60,
      dueAt: new Date(Date.now() + 3_600_000),
      status: 'running',
    });

    const result = await acceptLead(admin, lead.id, ctx);
    expect(result.slaMet).toBe(true);

    const timer = (
      await h.db.select().from(s.slaTimers).where(eq(s.slaTimers.recordId, lead.id)).limit(1)
    )[0];
    expect(timer.status).toBe('met');
  });

  it('requires a reason to reject a lead', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const lead = (
      await h.db.insert(s.leads).values({ lastName: 'RejectProbe', source: 'form', status: 'working' }).returning()
    )[0];

    await expect(rejectLead(admin, lead.id, '  ', 'no_fit', ctx)).rejects.toThrow(/reason is required/i);
    await expect(rejectLead(admin, lead.id, 'Headcount too small', 'no_fit', ctx)).resolves.toEqual({
      rejected: true,
    });
  });

  /**
   * The design commitment: engagement history must survive conversion, held once
   * and re-pointed rather than copied or orphaned.
   */
  it('converts a lead and carries its campaign responses onto the contact', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');

    const lead = (
      await h.db.insert(s.leads).values({
        firstName: 'Convert',
        lastName: 'Probe',
        email: 'convert.probe@newcorp.example',
        company: 'NewCorp Industries',
        region: 'NA',
        country: 'US',
        source: 'event',
        status: 'accepted',
        ownerId: admin.id,
      }).returning()
    )[0];

    const campaign = (await h.db.select().from(s.campaigns).limit(1))[0];
    await h.db.insert(s.campaignResponses).values([
      { campaignId: campaign.id, leadId: lead.id, type: 'demo_request', occurredAt: new Date() },
      { campaignId: campaign.id, leadId: lead.id, type: 'content_download', occurredAt: new Date() },
    ]);

    const result = await convertLead(
      admin,
      lead.id,
      { createAccount: true, createOpportunity: true, opportunityName: 'NewCorp — New Business' },
      ctx,
    );

    expect(result.contactId).toBeTruthy();
    expect(result.accountId).toBeTruthy();
    expect(result.opportunityId).toBeTruthy();
    expect(result.responsesRelinked).toBe(2);

    // Responses now point at the contact, and are not duplicated.
    const onContact = await h.db
      .select()
      .from(s.campaignResponses)
      .where(eq(s.campaignResponses.contactId, result.contactId));
    expect(onContact).toHaveLength(2);
    // The lead link is retained for lineage.
    expect(onContact.every((r) => r.leadId === lead.id)).toBe(true);

    // A second conversion must be refused.
    await expect(convertLead(admin, lead.id, {}, ctx)).rejects.toThrow(/already been converted/i);
  });

  it('sweeps untouched leads past their SLA', async () => {
    await h.db.insert(s.leads).values({
      lastName: 'BreachProbe',
      source: 'form',
      status: 'working',
      slaDueAt: new Date(Date.now() - 7_200_000),
      slaBreached: false,
    });

    const result = await sweepLeadSlaBreaches();
    expect(result.breached).toBeGreaterThan(0);
  });
});

/* ----------------------------------------------------------------- service */

describe('service tickets', () => {
  it('resolves SLA targets from the account entitlement', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');

    const entitlement = (
      await h.db
        .select()
        .from(s.entitlements)
        .where(sql`${s.entitlements.supportLevel} is not null`)
        .limit(1)
    )[0];
    expect(entitlement).toBeTruthy();

    const created = await createCase(
      admin,
      {
        accountId: entitlement.accountId,
        subject: 'Production API returning 503',
        severity: 1,
        type: 'incident',
      },
      ctx,
    );

    expect(created.entitlementVerified).toBe(true);
    expect(created.supportLevel).toBeTruthy();
    expect(created.slaFirstResponseDueAt).toBeTruthy();
    // A severity-1 starts escalated by design.
    expect(created.escalationLevel).toBeGreaterThanOrEqual(1);

    const timers = await h.db
      .select()
      .from(s.slaTimers)
      .where(eq(s.slaTimers.recordId, created.id));
    expect(timers).toHaveLength(2);
  });

  it('flags a ticket with no support entitlement rather than guessing', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');

    const prospect = (
      await h.db.select().from(s.accounts).where(eq(s.accounts.isCustomer, false)).limit(1)
    )[0];

    const created = await createCase(
      admin,
      { accountId: prospect.id, subject: 'Trial question', severity: 3 },
      ctx,
    );
    expect(created.entitlementVerified).toBe(false);
    expect(created.supportLevel).toBeNull();
  });

  it('rejects an out-of-range severity', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const account = (await h.db.select().from(s.accounts).limit(1))[0];

    await expect(
      createCase(admin, { accountId: account.id, subject: 'Bad severity', severity: 9 }, ctx),
    ).rejects.toThrow(/between 1 and 4/i);
  });

  it('stops the first-response clock on the first public comment', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const account = (await h.db.select().from(s.accounts).limit(1))[0];

    const created = await createCase(
      admin,
      { accountId: account.id, subject: 'First response probe', severity: 3 },
      ctx,
    );

    // An internal note must not count as a first response.
    const internal = await addComment(admin, created.id, 'Internal triage note', false, ctx);
    expect(internal.wasFirstResponse).toBe(false);

    const first = await addComment(admin, created.id, 'Thanks — investigating now.', true, ctx);
    expect(first.wasFirstResponse).toBe(true);
    expect(first.slaMet).toBe(true);

    const after = (await h.db.select().from(s.cases).where(eq(s.cases.id, created.id)).limit(1))[0];
    expect(after.firstResponseAt).toBeTruthy();
    expect(after.status).toBe('open');
    expect(after.timeToFirstResponseMinutes).not.toBeNull();
  });

  it('requires a resolution summary to resolve', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const account = (await h.db.select().from(s.accounts).limit(1))[0];

    const created = await createCase(
      admin,
      { accountId: account.id, subject: 'Resolution probe', severity: 4 },
      ctx,
    );

    await expect(resolveCase(admin, created.id, '   ', ctx)).rejects.toThrow(/resolution summary/i);

    const resolved = await resolveCase(admin, created.id, 'Configuration corrected.', ctx);
    expect(resolved.resolved).toBe(true);
  });

  it('escalates a severity-1 on a strategic account and opens an account risk', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');

    const strategic = (
      await h.db
        .select()
        .from(s.accounts)
        .where(and(eq(s.accounts.tier, 'strategic'), eq(s.accounts.isCustomer, true)))
        .limit(1)
    )[0];

    if (!strategic) return; // seed variation — nothing to assert against

    const created = await createCase(
      admin,
      { accountId: strategic.id, subject: 'Outage during month end', severity: 1, type: 'incident' },
      ctx,
    );

    const result = await escalateCase(admin, created.id, 'Unresolved beyond the agreed window', ctx);
    expect(result.level).toBeGreaterThanOrEqual(3);
    expect(result.notifyRoles.length).toBeGreaterThan(0);

    const after = (await h.db.select().from(s.cases).where(eq(s.cases.id, created.id)).limit(1))[0];
    expect(after.isEscalated).toBe(true);
    expect(after.executiveVisible).toBe(true);
  });

  it('sweeps breached case SLAs', async () => {
    const result = await sweepCaseSlaBreaches(new Date(Date.now() + 400 * 86_400_000));
    expect(result.firstResponseBreached + result.resolutionBreached).toBeGreaterThan(0);
  });

  it('summarises support posture for an account', async () => {
    const account = (
      await h.db.select().from(s.cases).limit(1)
    )[0];
    const summary = await accountSupportSummary(account.accountId);
    expect(summary).toHaveProperty('openCases');
    expect(summary).toHaveProperty('slaBreaches90d');
    expect(typeof summary.openCases).toBe('number');
  });
});

/* ------------------------------------------------------------------ health */

describe('health and risk jobs', () => {
  it('scores an account with dimensions, confidence and a recommendation', async () => {
    const ctx = await h.ctx('admin@spoton.dev');
    const account = (
      await h.db.select().from(s.accounts).where(eq(s.accounts.isCustomer, true)).limit(1)
    )[0];

    const result = await scoreAccountHealth(account.id, ctx);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.confidenceBps).toBeGreaterThan(0);
    expect(result.recommendedAction.length).toBeGreaterThan(10);

    const stored = await h.db
      .select()
      .from(s.healthScores)
      .where(eq(s.healthScores.accountId, account.id));
    expect(stored.length).toBeGreaterThan(0);

    const dims = stored[0].dimensions as Record<string, number | null>;
    expect(Object.keys(dims).length).toBe(9);
  });

  it('keeps one score per account per day when re-run', async () => {
    const ctx = await h.ctx('admin@spoton.dev');
    const account = (
      await h.db.select().from(s.accounts).where(eq(s.accounts.isCustomer, true)).limit(1)
    )[0];

    await scoreAccountHealth(account.id, ctx);
    await scoreAccountHealth(account.id, ctx);

    const rows = await h.db
      .select()
      .from(s.healthScores)
      .where(and(eq(s.healthScores.accountId, account.id), eq(s.healthScores.asOfDate, today())));
    expect(rows).toHaveLength(1);
  });

  it('refreshes renewal risk, likelihood and forecast category', async () => {
    const ctx = await h.ctx('admin@spoton.dev');
    const result = await refreshRenewalRisk(ctx);
    expect(result.assessed).toBeGreaterThan(0);

    const rens = await h.db
      .select()
      .from(s.renewals)
      .where(eq(s.renewals.status, 'not_started'));

    for (const r of rens) {
      expect(r.renewalLikelihoodBps).not.toBeNull();
      expect(['low', 'medium', 'high', 'critical']).toContain(r.riskLevel);
      // Scenario bounds must be ordered.
      expect(r.downsideArrCents).toBeLessThanOrEqual(r.expectedArrCents);
      expect(r.upsideArrCents).toBeGreaterThanOrEqual(r.expectedArrCents);
    }
  });

  it('detects usage signals and records them as insights with evidence', async () => {
    const ctx = await h.ctx('admin@spoton.dev');
    const result = await detectSignals(ctx);
    expect(result.signals + result.insights).toBeGreaterThanOrEqual(0);

    const insights = await h.db.select().from(s.aiInsights).limit(5);
    for (const i of insights) {
      expect(i.confidenceBps).toBeGreaterThan(0);
      expect(i.status).toBe('open'); // never auto-applied
      expect(Array.isArray(i.evidence)).toBe(true);
    }
  });
});

/* --------------------------------------------------------------- analytics */

describe('analytics', () => {
  it('produces an executive dashboard with every section populated', async () => {
    const dash = await executiveDashboard();
    expect(dash.arr.currentCents).toBeGreaterThan(0);
    expect(dash.pipeline.byStage.length).toBeGreaterThan(0);
    expect(dash.counts.customers).toBeGreaterThan(0);
    expect(dash.retention).toHaveProperty('netRetentionBps');
    expect(dash.forecast).toHaveProperty('callCents');
    expect(dash.health.length).toBeGreaterThan(0);
  });

  it('builds an ARR waterfall that chains period to period', async () => {
    const result = await arrWaterfall('2025-01-01', today());
    expect(result.periods.length).toBeGreaterThan(0);

    for (let i = 1; i < result.periods.length; i++) {
      expect(result.periods[i].beginningArrCents).toBe(result.periods[i - 1].endingArrCents);
    }
  });

  it('computes retention with gross never above net', async () => {
    const result = await retentionMetrics('2025-01-01', today());
    expect(result.grossRetentionBps).toBeLessThanOrEqual(result.netRetentionBps);
    expect(result.grossRetentionBps).toBeLessThanOrEqual(10_000);
  });

  it('returns the renewal book with consistent totals', async () => {
    const book = await renewalBook(365);
    const summed = book.rows.reduce((sum, r) => sum + r.renewableArrCents, 0);
    expect(book.totals.renewableArrCents).toBe(summed);
    expect(book.totals.count).toBe(book.rows.length);
  });

  it('produces a forecast, funnel, health distribution, pipeline health and SLA view', async () => {
    const [forecast, funnel, health, pipeline, sla, whitespace] = await Promise.all([
      forecastForPeriod(fiscalQuarter(today())),
      acquisitionFunnel(),
      healthDistribution(),
      pipelineHealth(),
      slaAttainment(),
      expansionWhitespace(5),
    ]);

    expect(forecast).toHaveProperty('coverageBps');
    expect(funnel.stages[0].name).toBe('Inquiries');
    expect(funnel.stages[0].stepConversionBps).toBe(10_000);
    expect(health.length).toBeGreaterThan(0);
    expect(pipeline.winRate).toHaveProperty('winRateBps');
    expect(pipeline.conversion.length).toBeGreaterThan(0);
    expect(sla.overall).toHaveProperty('attainmentBps');
    expect(Array.isArray(whitespace)).toBe(true);
  });

  it('takes pipeline and ARR snapshots idempotently for a date', async () => {
    const first = await takeSnapshots(today());
    expect(first.pipelineRows).toBeGreaterThan(0);

    await takeSnapshots(today());
    const rows = await h.db
      .select({ value: sql<number>`count(*)::int` })
      .from(s.pipelineSnapshots)
      .where(eq(s.pipelineSnapshots.asOfDate, today()));

    // Re-running replaces rather than duplicates.
    expect(Number(rows[0].value)).toBe(first.pipelineRows);
  });
});

/* ------------------------------------------------------- opportunity service */

describe('opportunity service', () => {
  it('tracks a pushed close date as slippage', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const opp = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.isClosed, false)).limit(1)
    )[0];

    const pushed = await changeCloseDate(admin, opp.id, addDays(opp.closeDate, 30), ctx);
    expect(pushed.pushed).toBe(true);
    expect(pushed.daysMoved).toBe(30);
    expect(pushed.pushCount).toBe(opp.pushCount + 1);

    // Pulling a date in is not slippage.
    const pulled = await changeCloseDate(admin, opp.id, addDays(opp.closeDate, 10), ctx);
    expect(pulled.pushed).toBe(false);
    expect(pulled.pushCount).toBe(pushed.pushCount);
  });

  it('requires revenue splits to total exactly 100%', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const opp = (await h.db.select().from(s.opportunities).limit(1))[0];
    const users = await h.db.select().from(s.users).limit(2);

    await expect(
      setRevenueSplits(
        admin,
        opp.id,
        [{ userId: users[0].id, role: 'account_executive', splitBps: 6000 }],
        ctx,
      ),
    ).rejects.toThrow(/must total 100/i);

    const ok = await setRevenueSplits(
      admin,
      opp.id,
      [
        { userId: users[0].id, role: 'account_executive', splitBps: 7000 },
        { userId: users[1].id, role: 'bdr', splitBps: 3000, creditType: 'overlay' },
      ],
      ctx,
    );
    expect(ok.ok).toBe(true);
  });

  it('previews what a stage change requires without changing anything', async () => {
    const opp = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.stage, 'discovery')).limit(1)
    )[0];

    const preview = await previewStageChange(opp.id, 'solution_design');
    expect(preview.fromStage).toBe('discovery');
    expect(preview.criteria.length).toBeGreaterThan(0);

    const after = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.id, opp.id)).limit(1)
    )[0];
    expect(after.stage).toBe('discovery');
  });
});

/* -------------------------------------------------------------- integrations */

describe('integration plumbing', () => {
  it('queues and delivers an outbound event', async () => {
    const result = await emitEvent('chat', 'test.event', { hello: 'world' });
    expect(result.queued).toBe(true);
    expect(result.delivered).toBe(true);

    const event = (
      await h.db.select().from(s.integrationEvents).where(eq(s.integrationEvents.id, result.eventId!)).limit(1)
    )[0];
    expect(event.status).toBe('succeeded');
    expect(event.externalId).toBeTruthy();
  });

  it('honours an idempotency key', async () => {
    const key = `idem-${Date.now()}`;
    const first = await emitEvent('chat', 'test.idempotent', { n: 1 }, { idempotencyKey: key });
    const second = await emitEvent('chat', 'test.idempotent', { n: 2 }, { idempotencyKey: key });

    expect(first.eventId).toBe(second.eventId);
    expect(second.queued).toBe(false);

    const rows = await h.db
      .select()
      .from(s.integrationEvents)
      .where(eq(s.integrationEvents.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  /** Retry and dead-letter behaviour must be demonstrable, not assumed. */
  it('retries a failing event and eventually dead-letters it', async () => {
    const result = await emitEvent('chat', 'test.failing', { __forceFailure: true });
    expect(result.delivered).toBe(false);

    const eventId = result.eventId!;
    let status = '';
    for (let i = 0; i < 8; i++) {
      const outcome = await deliverEvent(eventId);
      status = outcome.status;
      if (status === 'dead_letter') break;
    }

    expect(status).toBe('dead_letter');

    const event = (
      await h.db.select().from(s.integrationEvents).where(eq(s.integrationEvents.id, eventId)).limit(1)
    )[0];
    expect(event.status).toBe('dead_letter');
    expect(event.attempts).toBeGreaterThanOrEqual(event.maxAttempts);
    expect(event.lastError).toBeTruthy();
  });

  it('drains the retry queue', async () => {
    const result = await processRetryQueue(new Date(Date.now() + 86_400_000));
    expect(result.attempted).toBeGreaterThanOrEqual(0);
  });

  it('records an inbound event and detects a redelivery', async () => {
    const key = `inbound-${Date.now()}`;
    const first = await receiveEvent('product_telemetry', 'usage.reported', { seats: 40 }, { idempotencyKey: key });
    expect(first.accepted).toBe(true);
    expect(first.duplicate).toBe(false);

    const second = await receiveEvent('product_telemetry', 'usage.reported', { seats: 40 }, { idempotencyKey: key });
    expect(second.duplicate).toBe(true);
  });

  it('resolves records by stable external id', async () => {
    const account = (await h.db.select().from(s.accounts).limit(1))[0];
    await linkExternalId('accounts', account.id, 'testsystem', 'EXT-123');

    const resolved = await resolveByExternalId('testsystem', 'accounts', 'EXT-123');
    expect(resolved).toBe(account.id);

    const missing = await resolveByExternalId('testsystem', 'accounts', 'EXT-nope');
    expect(missing).toBeNull();
  });

  it('reports connection health including queue depth', async () => {
    const health = await integrationHealth();
    expect(health.length).toBeGreaterThan(0);
    for (const c of health) {
      expect(c).toHaveProperty('pending');
      expect(c).toHaveProperty('deadLettered');
      expect(typeof c.isMock).toBe('boolean');
    }
  });

  it('never throws out of emitEvent, even for an unknown category', async () => {
    const result = await emitEvent('not_a_category' as never, 'x', {});
    expect(result.queued).toBe(false);
  });
});
