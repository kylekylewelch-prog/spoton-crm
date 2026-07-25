import { and, asc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  accounts,
  campaignResponses,
  contacts,
  duplicateCandidates,
  leads,
  opportunities,
  opportunityContactRoles,
  routingRules,
  slaTimers,
  territories,
  territoryAssignments,
} from '@/db/schema';
import { addDays, termEndDate, today } from '@/domain/dates';
import { scoreLead, type ResponseEvent } from '@/domain/scoring';
import { route, type RoutingRule, type Territory, type TerritoryAssignment } from '@/domain/routing';
import { scoreDuplicate } from '@/domain/insights';
import type { AuthenticatedUser } from '../auth';
import { recordAudit, type AuditContext } from '../audit';
import { assertCan, NotFoundError, ValidationError } from '../rbac';
import { emitEvent } from './integrations';

/**
 * Lead management: scoring, duplicate prevention, routing with an SLA, and
 * conversion.
 *
 * The design commitment that matters is that engagement history is never destroyed
 * or duplicated. Campaign responses point at both the lead and, after conversion,
 * the contact, so the interaction record survives; and a known contact can be
 * pushed into a sales workflow directly rather than having a shadow lead created
 * for it.
 */

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'proton.me',
  'aol.com',
]);

function hasBusinessEmail(email: string | null | undefined): boolean {
  if (!email?.includes('@')) return false;
  return !FREE_EMAIL_DOMAINS.has(email.split('@')[1]!.toLowerCase());
}

/* -------------------------------------------------------------------- scoring */

export async function rescoreLead(
  leadId: string,
  ctx: AuditContext,
  asOf = today(),
): Promise<{
  totalScore: number;
  grade: string;
  isMql: boolean;
  detail: Record<string, string[]>;
  becameMql: boolean;
}> {
  const db = await getDb();
  const leadRows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const lead = leadRows[0];
  if (!lead) throw new NotFoundError('Lead not found');

  const responses = await db
    .select()
    .from(campaignResponses)
    .where(eq(campaignResponses.leadId, leadId));

  const events: ResponseEvent[] = responses.map((r) => ({
    type: r.type,
    occurredAt: r.occurredAt.toISOString().slice(0, 10),
    scoreValue: r.scoreValue || undefined,
  }));

  // An existing customer account raises fit — expanding is cheaper than landing.
  let isExistingCustomer = false;
  if (lead.email?.includes('@')) {
    const domain = lead.email.split('@')[1];
    const matches = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.domain, domain!), eq(accounts.isCustomer, true)))
      .limit(1);
    isExistingCustomer = Boolean(matches[0]);
  }

  const result = scoreLead({
    fit: {
      employeeCount: lead.employeeCount,
      industry: lead.industry,
      country: lead.country,
      title: lead.title,
      hasBusinessEmail: hasBusinessEmail(lead.email),
      isExistingCustomer,
    },
    events,
    /**
     * Engagement is about whether they interact with us at all, so every recorded
     * response counts toward it, with the higher-effort interactions weighted
     * through the meeting and call channels. Inferring opens from form-fill counts
     * alone understates a lead that has actually been talking to us.
     */
    engagement: {
      emailsOpened: responses.length,
      emailsClicked: responses.filter((r) =>
        ['content_download', 'form_fill', 'demo_request', 'trial_signup', 'outbound_reply'].includes(
          r.type,
        ),
      ).length,
      meetingsHeld: responses.filter((r) =>
        ['event_attendance', 'webinar_attendance'].includes(r.type),
      ).length,
      callsConnected: responses.filter((r) => ['inbound_call', 'chat'].includes(r.type)).length,
      lastResponseAt: responses.length
        ? responses
            .map((r) => r.occurredAt.toISOString().slice(0, 10))
            .sort()
            .at(-1)!
        : null,
      asOf,
    },
    negative: {
      unsubscribed: !lead.emailOptIn,
      disqualifiedPreviously: lead.status === 'disqualified',
      competitor: /competitor/i.test(lead.company ?? ''),
      student: /student|university|\.edu$/i.test(`${lead.title ?? ''} ${lead.email ?? ''}`),
    },
    asOf,
  });

  const becameMql = result.isMql && !lead.mqlAt;

  await db
    .update(leads)
    .set({
      fitScore: result.fitScore,
      intentScore: result.intentScore,
      engagementScore: result.engagementScore,
      behavioralScore: result.behavioralScore,
      negativeScore: result.negativeScore,
      totalScore: result.totalScore,
      grade: result.grade,
      scoreDecayedAt: new Date(),
      status: becameMql && lead.status === 'new' ? 'mql' : lead.status,
      mqlAt: becameMql ? new Date() : lead.mqlAt,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  if (becameMql) {
    await recordAudit(ctx, {
      objectType: 'leads',
      recordId: leadId,
      action: 'update',
      field: 'status',
      oldValue: lead.status,
      newValue: 'mql',
      metadata: { totalScore: result.totalScore, drivers: result.detail },
    });
  }

  return { ...result, becameMql };
}

/* -------------------------------------------------------- duplicate prevention */

/**
 * Checks a prospective lead against both leads and contacts before it is created.
 * A cross-object match is reported separately because the correct resolution
 * differs: an inbound form from someone who is already a contact should attach to
 * that contact, not spawn a competing lead record.
 */
export async function findDuplicates(candidate: {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
}): Promise<{
  leadMatches: { id: string; scoreBps: number; matchedOn: string[] }[];
  contactMatches: { id: string; scoreBps: number; matchedOn: string[] }[];
  bestScoreBps: number;
  suggestion: 'create' | 'merge_lead' | 'attach_to_contact';
}> {
  const db = await getDb();

  const domain = candidate.email?.includes('@') ? candidate.email.split('@')[1] : null;

  const leadPool = await db
    .select()
    .from(leads)
    .where(
      or(
        candidate.email ? eq(leads.email, candidate.email) : sql`false`,
        candidate.lastName ? eq(leads.lastName, candidate.lastName) : sql`false`,
      ),
    )
    .limit(50);

  const contactPool = await db
    .select()
    .from(contacts)
    .where(
      or(
        candidate.email ? eq(contacts.email, candidate.email) : sql`false`,
        candidate.lastName ? eq(contacts.lastName, candidate.lastName) : sql`false`,
      ),
    )
    .limit(50);

  const leadMatches = leadPool
    .map((l) => ({
      id: l.id,
      ...scoreDuplicate(
        { ...candidate, domain },
        { email: l.email, firstName: l.firstName, lastName: l.lastName, company: l.company },
      ),
    }))
    .filter((m) => m.scoreBps >= 5000)
    .sort((a, b) => b.scoreBps - a.scoreBps);

  const contactMatches = contactPool
    .map((c) => ({
      id: c.id,
      ...scoreDuplicate(
        { ...candidate, domain },
        { email: c.email, firstName: c.firstName, lastName: c.lastName },
      ),
    }))
    .filter((m) => m.scoreBps >= 5000)
    .sort((a, b) => b.scoreBps - a.scoreBps);

  const bestContact = contactMatches[0]?.scoreBps ?? 0;
  const bestLead = leadMatches[0]?.scoreBps ?? 0;
  const bestScoreBps = Math.max(bestContact, bestLead);

  return {
    leadMatches,
    contactMatches,
    bestScoreBps,
    suggestion:
      bestContact >= 8500 ? 'attach_to_contact' : bestLead >= 8500 ? 'merge_lead' : 'create',
  };
}

/* -------------------------------------------------------------------- routing */

async function loadRoutingContext() {
  const db = await getDb();
  const rules = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.objectType, 'lead'), eq(routingRules.active, true)))
    .orderBy(asc(routingRules.priority));

  const terrRows = await db.select().from(territories).where(eq(territories.active, true));
  const assignmentRows = await db.select().from(territoryAssignments);

  return {
    rules: rules.map<RoutingRule>((r) => ({
      id: r.id,
      name: r.name,
      objectType: r.objectType,
      strategy: r.strategy as RoutingRule['strategy'],
      priority: r.priority,
      criteria: (r.criteria ?? {}) as Record<string, unknown>,
      assigneeUserIds: (r.assigneeUserIds ?? []) as string[],
      assigneeTeamId: r.assigneeTeamId,
      territoryId: r.territoryId,
      roundRobinCursor: r.roundRobinCursor,
      slaMinutes: r.slaMinutes,
      escalateToUserId: r.escalateToUserId,
      active: r.active,
    })),
    territories: terrRows.map<Territory>((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      criteria: (t.criteria ?? {}) as Record<string, unknown>,
      priority: t.priority,
      active: t.active,
    })),
    assignments: assignmentRows.map<TerritoryAssignment>((a) => ({
      territoryId: a.territoryId,
      userId: a.userId,
      role: a.role,
      effectiveFrom: a.effectiveFrom,
      effectiveTo: a.effectiveTo,
      isTemporaryCoverage: a.isTemporaryCoverage,
      coveringForUserId: a.coveringForUserId,
    })),
  };
}

/**
 * Routes a lead and starts its response-time SLA. Assignment and SLA are created
 * together — an owner without a clock is how inbound leads go cold unnoticed.
 */
export async function routeLead(
  leadId: string,
  ctx: AuditContext,
): Promise<{
  ownerId: string | null;
  ruleName: string | null;
  slaMinutes: number;
  slaDueAt: Date | null;
  reason: string;
}> {
  const db = await getDb();
  const leadRows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const lead = leadRows[0];
  if (!lead) throw new NotFoundError('Lead not found');

  const { rules, territories: terrs, assignments } = await loadRoutingContext();

  // If the company already exists as an owned account, the lead belongs to that owner.
  let accountOwnerId: string | null = null;
  if (lead.email?.includes('@')) {
    const domain = lead.email.split('@')[1];
    const matches = await db
      .select({ ownerId: accounts.ownerId })
      .from(accounts)
      .where(eq(accounts.domain, domain!))
      .limit(1);
    accountOwnerId = matches[0]?.ownerId ?? null;
  }

  const decision = route(
    {
      id: lead.id,
      region: lead.region ?? undefined,
      country: lead.country ?? undefined,
      industry: lead.industry ?? undefined,
      employeeCount: lead.employeeCount ?? undefined,
      totalScore: lead.totalScore,
      source: lead.source,
      accountOwnerId,
    },
    rules,
    { territories: terrs, assignments, asOf: today() },
  );

  const slaDueAt = decision.ownerId
    ? new Date(Date.now() + decision.slaMinutes * 60_000)
    : null;

  await db
    .update(leads)
    .set({
      ownerId: decision.ownerId,
      territoryId: decision.territoryId,
      routingRuleId: decision.ruleId,
      assignedAt: decision.ownerId ? new Date() : null,
      slaMinutes: decision.slaMinutes,
      slaDueAt,
      status: lead.status === 'new' && decision.ownerId ? 'working' : lead.status,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  // Persist the round-robin cursor so fairness survives a restart.
  if (decision.nextCursor !== null && decision.ruleId) {
    await db
      .update(routingRules)
      .set({ roundRobinCursor: decision.nextCursor })
      .where(eq(routingRules.id, decision.ruleId));
  }

  if (decision.ownerId && slaDueAt) {
    await db.insert(slaTimers).values({
      objectType: 'leads',
      recordId: leadId,
      name: 'lead_first_touch',
      targetMinutes: decision.slaMinutes,
      dueAt: slaDueAt,
      status: 'running',
      ownerId: decision.ownerId,
      escalatedToUserId: decision.escalateToUserId,
    });
  }

  await recordAudit({ ...ctx, reason: decision.reason }, {
    objectType: 'leads',
    recordId: leadId,
    action: 'update',
    field: 'ownerId',
    oldValue: lead.ownerId,
    newValue: decision.ownerId,
    metadata: { rule: decision.ruleName, slaMinutes: decision.slaMinutes },
  });

  if (decision.ownerId) {
    await emitEvent('sales_engagement', 'lead.assigned', {
      leadId,
      ownerId: decision.ownerId,
      score: lead.totalScore,
      slaMinutes: decision.slaMinutes,
    }, { objectType: 'leads', recordId: leadId });
  }

  return {
    ownerId: decision.ownerId,
    ruleName: decision.ruleName,
    slaMinutes: decision.slaMinutes,
    slaDueAt,
    reason: decision.reason,
  };
}

/** Sales acceptance stops the response-time clock. */
export async function acceptLead(
  user: AuthenticatedUser,
  leadId: string,
  ctx: AuditContext,
): Promise<{ accepted: true; slaMet: boolean }> {
  assertCan(user, 'leads', 'update');
  const db = await getDb();

  const rows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const lead = rows[0];
  if (!lead) throw new NotFoundError('Lead not found');

  const now = new Date();
  const slaMet = !lead.slaDueAt || now <= lead.slaDueAt;

  await db
    .update(leads)
    .set({
      status: 'accepted',
      acceptedAt: now,
      firstTouchedAt: lead.firstTouchedAt ?? now,
      slaBreached: !slaMet,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  await db
    .update(slaTimers)
    .set({
      stoppedAt: now,
      status: slaMet ? 'met' : 'breached',
      breachedAt: slaMet ? null : lead.slaDueAt,
    })
    .where(
      and(
        eq(slaTimers.objectType, 'leads'),
        eq(slaTimers.recordId, leadId),
        eq(slaTimers.status, 'running'),
      ),
    );

  await recordAudit(ctx, {
    objectType: 'leads',
    recordId: leadId,
    action: 'update',
    field: 'status',
    oldValue: lead.status,
    newValue: 'accepted',
    metadata: { slaMet },
  });

  return { accepted: true, slaMet };
}

export async function rejectLead(
  user: AuthenticatedUser,
  leadId: string,
  reason: string,
  disposition: string,
  ctx: AuditContext,
): Promise<{ rejected: true }> {
  assertCan(user, 'leads', 'update');
  if (!reason.trim()) {
    throw new ValidationError('A rejection reason is required', [
      { field: 'rejectionReason', message: 'Explain why this lead was rejected' },
    ]);
  }

  const db = await getDb();
  await db
    .update(leads)
    .set({
      status: 'rejected',
      rejectedAt: new Date(),
      rejectionReason: reason,
      disposition,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  await recordAudit({ ...ctx, reason }, {
    objectType: 'leads',
    recordId: leadId,
    action: 'update',
    field: 'status',
    newValue: 'rejected',
    metadata: { disposition },
  });

  return { rejected: true };
}

/* ----------------------------------------------------------------- conversion */

/**
 * Converts a lead into a contact (and optionally an account and opportunity).
 *
 * Campaign responses are re-pointed at the new contact rather than copied, so the
 * interaction history is preserved exactly once and remains attributable through
 * the conversion boundary.
 */
export async function convertLead(
  user: AuthenticatedUser,
  leadId: string,
  input: {
    accountId?: string | null;
    createAccount?: boolean;
    createOpportunity?: boolean;
    opportunityName?: string;
    opportunityCloseDate?: string;
    opportunityAmountCents?: number;
  },
  ctx: AuditContext,
): Promise<{
  contactId: string;
  accountId: string | null;
  opportunityId: string | null;
  responsesRelinked: number;
}> {
  assertCan(user, 'leads', 'update');
  assertCan(user, 'contacts', 'create');

  const db = await getDb();
  const leadRows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const lead = leadRows[0];
  if (!lead) throw new NotFoundError('Lead not found');
  if (lead.convertedAt) {
    throw new ValidationError('This lead has already been converted');
  }

  // --- account -------------------------------------------------------------
  let accountId = input.accountId ?? null;
  if (!accountId && input.createAccount) {
    const domain = lead.email?.includes('@') ? lead.email.split('@')[1]! : null;

    if (domain) {
      const existing = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.domain, domain))
        .limit(1);
      accountId = existing[0]?.id ?? null;
    }

    if (!accountId) {
      const created = await db
        .insert(accounts)
        .values({
          name: lead.company ?? `${lead.firstName ?? ''} ${lead.lastName}`.trim(),
          domain,
          region: lead.region,
          country: lead.country,
          industry: lead.industry,
          employeeCount: lead.employeeCount,
          lifecycleStage: 'evaluating',
          ownerId: lead.ownerId ?? user.id,
          accountExecutiveId: lead.ownerId ?? user.id,
          territoryId: lead.territoryId,
          originalSource: lead.source,
          originalSourceDetail: lead.sourceDetail,
          latestSource: lead.source,
          originalCampaignId: lead.campaignId,
          createdById: user.id,
        })
        .returning();
      accountId = created[0].id;
    }
  }

  // --- contact -------------------------------------------------------------
  const contactRows = await db
    .insert(contacts)
    .values({
      accountId,
      firstName: lead.firstName ?? '—',
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      title: lead.title,
      roleType: 'user',
      country: lead.country,
      ownerId: lead.ownerId ?? user.id,
      fitScore: lead.fitScore,
      intentScore: lead.intentScore,
      engagementScore: lead.engagementScore,
      totalScore: lead.totalScore,
      grade: lead.grade,
      originalSource: lead.source,
      latestSource: lead.source,
      originalCampaignId: lead.campaignId,
      emailOptIn: lead.emailOptIn,
      privacyRegime: lead.privacyRegime,
      createdById: user.id,
    })
    .returning();
  const contact = contactRows[0];

  // --- engagement history survives the boundary ----------------------------
  const relinked = await db
    .update(campaignResponses)
    .set({ contactId: contact.id, accountId })
    .where(eq(campaignResponses.leadId, leadId))
    .returning({ id: campaignResponses.id });

  // --- opportunity ---------------------------------------------------------
  let opportunityId: string | null = null;
  if (input.createOpportunity && accountId) {
    assertCan(user, 'opportunities', 'create');
    const closeDate = input.opportunityCloseDate ?? termEndDate(today(), 3);
    const oppRows = await db
      .insert(opportunities)
      .values({
        name: input.opportunityName ?? `${lead.company ?? lead.lastName} — New Business`,
        accountId,
        type: 'new_logo',
        stage: 'srl',
        forecastCategory: 'pipeline',
        probabilityBps: 500,
        amountCents: input.opportunityAmountCents ?? 0,
        arrCents: input.opportunityAmountCents ?? 0,
        closeDate,
        originalCloseDate: closeDate,
        termMonths: 12,
        ownerId: lead.ownerId ?? user.id,
        territoryId: lead.territoryId,
        createdSource: lead.source,
        originalSource: lead.source,
        latestSource: lead.source,
        primaryCampaignId: lead.campaignId,
        nextStep: 'Qualify and confirm the buying process',
        createdById: user.id,
      })
      .returning();
    opportunityId = oppRows[0].id;

    await db.insert(opportunityContactRoles).values({
      opportunityId,
      contactId: contact.id,
      role: 'champion',
      isPrimary: true,
      createdById: user.id,
    });
  }

  await db
    .update(leads)
    .set({
      status: 'converted',
      convertedAt: new Date(),
      convertedContactId: contact.id,
      convertedAccountId: accountId,
      convertedOpportunityId: opportunityId,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  await recordAudit(ctx, {
    objectType: 'leads',
    recordId: leadId,
    action: 'convert',
    metadata: {
      contactId: contact.id,
      accountId,
      opportunityId,
      responsesRelinked: relinked.length,
    },
  });

  return {
    contactId: contact.id,
    accountId,
    opportunityId,
    responsesRelinked: relinked.length,
  };
}

/** Flags SLA breaches on leads nobody has touched. Run by the scheduled job. */
export async function sweepLeadSlaBreaches(
  now: Date = new Date(),
): Promise<{ breached: number }> {
  const db = await getDb();
  const overdue = await db
    .select({ id: leads.id, slaDueAt: leads.slaDueAt, ownerId: leads.ownerId })
    .from(leads)
    .where(
      and(
        isNull(leads.firstTouchedAt),
        eq(leads.slaBreached, false),
        sql`${leads.slaDueAt} < ${now}`,
      ),
    )
    .limit(500);

  for (const lead of overdue) {
    await db.update(leads).set({ slaBreached: true }).where(eq(leads.id, lead.id));
    await db
      .update(slaTimers)
      .set({ status: 'breached', breachedAt: lead.slaDueAt })
      .where(
        and(
          eq(slaTimers.objectType, 'leads'),
          eq(slaTimers.recordId, lead.id),
          eq(slaTimers.status, 'running'),
        ),
      );
  }

  return { breached: overdue.length };
}

/** Records a duplicate pair for the data-governance queue. */
export async function recordDuplicateCandidate(
  objectType: string,
  recordAId: string,
  recordBId: string,
  scoreBps: number,
  matchedOn: string[],
  otherObjectType?: string,
): Promise<void> {
  const db = await getDb();
  await db.insert(duplicateCandidates).values({
    objectType,
    recordAId,
    recordBId,
    scoreBps,
    matchedOn,
    crossObject: Boolean(otherObjectType),
    otherObjectType: otherObjectType ?? null,
    status: 'open',
  });
}

export { addDays, gte };
