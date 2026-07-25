import { and, asc, count, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  accounts,
  caseComments,
  cases,
  entitlements,
  productDefects,
  risks,
  slaTimers,
  subscriptions,
  users,
} from '@/db/schema';
import { escalationLevel, supportSla } from '@/domain/sla';
import type { AuthenticatedUser } from '../auth';
import { recordAudit, type AuditContext } from '../audit';
import { assertCan, NotFoundError, ValidationError } from '../rbac';
import { nextNumber } from './numbering';
import { emitEvent } from './integrations';

/**
 * Service ticket handling.
 *
 * SLA targets are resolved from the account's actual support entitlement rather
 * than hard-coded, so a premier customer genuinely gets premier response times and
 * an unentitled one is flagged instead of silently served. Escalation is automatic
 * and account-aware: a severity-1 on a strategic account reaches an executive
 * without anyone remembering to forward an email.
 */

export type CreateCaseInput = {
  accountId: string;
  contactId?: string | null;
  subscriptionId?: string | null;
  productId?: string | null;
  subject: string;
  description?: string | null;
  type?: string;
  severity: number;
  channel?: string;
  ownerId?: string | null;
};

/** Highest support level the account is entitled to right now. */
async function resolveSupportLevel(
  accountId: string,
  subscriptionId?: string | null,
): Promise<{ supportLevel: string | null; entitlementId: string | null; verified: boolean }> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(entitlements)
    .where(
      and(
        eq(entitlements.accountId, accountId),
        eq(entitlements.status, 'active'),
        isNotNull(entitlements.supportLevel),
      ),
    );

  const withSupport = rows.filter((r) => r.supportLevel);
  if (withSupport.length === 0) {
    return { supportLevel: null, entitlementId: null, verified: false };
  }

  const rank: Record<string, number> = { premier: 3, enterprise: 2, standard: 1 };
  const best = withSupport.sort(
    (a, b) => (rank[b.supportLevel!] ?? 0) - (rank[a.supportLevel!] ?? 0),
  )[0];

  const scoped = subscriptionId
    ? withSupport.find((r) => r.subscriptionId === subscriptionId) ?? best
    : best;

  return { supportLevel: scoped.supportLevel, entitlementId: scoped.id, verified: true };
}

export async function createCase(
  user: AuthenticatedUser,
  input: CreateCaseInput,
  ctx: AuditContext,
): Promise<typeof cases.$inferSelect> {
  assertCan(user, 'cases', 'create');
  if (input.severity < 1 || input.severity > 4) {
    throw new ValidationError('Severity must be between 1 and 4', [
      { field: 'severity', message: '1 is production down, 4 is cosmetic' },
    ]);
  }

  const db = await getDb();
  const entitlement = await resolveSupportLevel(input.accountId, input.subscriptionId);
  const sla = supportSla(entitlement.supportLevel, input.severity);

  const openedAt = new Date();
  const firstResponseDue = new Date(openedAt.getTime() + sla.firstResponse * 60_000);
  const resolutionDue = new Date(openedAt.getTime() + sla.resolution * 60_000);

  const accountRows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, input.accountId))
    .limit(1);
  const account = accountRows[0];

  const escalation = escalationLevel({
    severity: input.severity,
    breachCount: 0,
    reopenCount: 0,
    arrCents: account?.currentArrCents ?? 0,
    isStrategicAccount: account?.tier === 'strategic',
  });

  const inserted = await db
    .insert(cases)
    .values({
      number: await nextNumber('cases'),
      accountId: input.accountId,
      contactId: input.contactId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      productId: input.productId ?? null,
      subject: input.subject,
      description: input.description ?? null,
      type: (input.type ?? 'question') as never,
      status: 'new',
      severity: input.severity,
      priority: input.severity <= 2 ? 'urgent' : input.severity === 3 ? 'medium' : 'low',
      channel: input.channel ?? 'portal',
      ownerId: input.ownerId ?? account?.supportOwnerId ?? null,
      openedAt,
      entitlementId: entitlement.entitlementId,
      entitlementVerified: entitlement.verified,
      supportLevel: entitlement.supportLevel,
      slaFirstResponseDueAt: firstResponseDue,
      slaResolutionDueAt: resolutionDue,
      isEscalated: escalation.level > 0,
      escalationLevel: escalation.level,
      executiveVisible: escalation.executiveVisible,
      createdById: user.id,
    })
    .returning();

  const created = inserted[0];

  await db.insert(slaTimers).values([
    {
      objectType: 'cases',
      recordId: created.id,
      name: 'case_first_response',
      targetMinutes: sla.firstResponse,
      startedAt: openedAt,
      dueAt: firstResponseDue,
      status: 'running',
      ownerId: created.ownerId,
    },
    {
      objectType: 'cases',
      recordId: created.id,
      name: 'case_resolution',
      targetMinutes: sla.resolution,
      startedAt: openedAt,
      dueAt: resolutionDue,
      status: 'running',
      ownerId: created.ownerId,
    },
  ]);

  await recordAudit(ctx, {
    objectType: 'cases',
    recordId: created.id,
    action: 'create',
    metadata: {
      severity: input.severity,
      supportLevel: entitlement.supportLevel,
      entitlementVerified: entitlement.verified,
      slaFirstResponseMinutes: sla.firstResponse,
      escalationLevel: escalation.level,
    },
  });

  if (escalation.level >= 2) {
    await emitEvent('chat', 'case.escalated', {
      caseNumber: created.number,
      severity: input.severity,
      accountName: account?.name,
      arrCents: account?.currentArrCents,
      notifyRoles: escalation.notifyRoles,
    }, { objectType: 'cases', recordId: created.id });
  }

  return created;
}

/** First public comment stops the first-response clock. */
export async function addComment(
  user: AuthenticatedUser,
  caseId: string,
  body: string,
  isPublic: boolean,
  ctx: AuditContext,
): Promise<{ commentId: string; wasFirstResponse: boolean; slaMet: boolean }> {
  assertCan(user, 'case_comments', 'create');
  const db = await getDb();

  const rows = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  const record = rows[0];
  if (!record) throw new NotFoundError('Case not found');

  const now = new Date();
  const wasFirstResponse = isPublic && !record.firstResponseAt;
  const slaMet = !record.slaFirstResponseDueAt || now <= record.slaFirstResponseDueAt;

  const inserted = await db
    .insert(caseComments)
    .values({
      caseId,
      authorUserId: user.id,
      body,
      isPublic,
      isFirstResponse: wasFirstResponse,
    })
    .returning();

  if (wasFirstResponse) {
    const minutes = Math.round((now.getTime() - record.openedAt.getTime()) / 60_000);
    await db
      .update(cases)
      .set({
        firstResponseAt: now,
        timeToFirstResponseMinutes: minutes,
        slaFirstResponseBreached: !slaMet,
        status: record.status === 'new' ? 'open' : record.status,
        updatedAt: now,
      })
      .where(eq(cases.id, caseId));

    await db
      .update(slaTimers)
      .set({
        stoppedAt: now,
        status: slaMet ? 'met' : 'breached',
        breachedAt: slaMet ? null : record.slaFirstResponseDueAt,
      })
      .where(
        and(
          eq(slaTimers.objectType, 'cases'),
          eq(slaTimers.recordId, caseId),
          eq(slaTimers.name, 'case_first_response'),
        ),
      );

    await recordAudit(ctx, {
      objectType: 'cases',
      recordId: caseId,
      action: 'update',
      field: 'firstResponseAt',
      newValue: now.toISOString(),
      metadata: { minutes, slaMet },
    });
  }

  return { commentId: inserted[0].id, wasFirstResponse, slaMet };
}

export async function resolveCase(
  user: AuthenticatedUser,
  caseId: string,
  resolution: string,
  ctx: AuditContext,
): Promise<{ resolved: true; slaMet: boolean; minutes: number }> {
  assertCan(user, 'cases', 'update');
  if (!resolution.trim()) {
    throw new ValidationError('A resolution summary is required to close a case', [
      { field: 'resolutionSummary', message: 'Describe how it was resolved' },
    ]);
  }

  const db = await getDb();
  const rows = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  const record = rows[0];
  if (!record) throw new NotFoundError('Case not found');

  const now = new Date();
  const minutes = Math.round((now.getTime() - record.openedAt.getTime()) / 60_000);
  const slaMet = !record.slaResolutionDueAt || now <= record.slaResolutionDueAt;

  await db
    .update(cases)
    .set({
      status: 'resolved',
      resolvedAt: now,
      timeToResolutionMinutes: minutes,
      slaResolutionBreached: !slaMet,
      resolutionSummary: resolution,
      updatedAt: now,
      updatedById: user.id,
    })
    .where(eq(cases.id, caseId));

  await db
    .update(slaTimers)
    .set({
      stoppedAt: now,
      status: slaMet ? 'met' : 'breached',
      breachedAt: slaMet ? null : record.slaResolutionDueAt,
    })
    .where(
      and(
        eq(slaTimers.objectType, 'cases'),
        eq(slaTimers.recordId, caseId),
        eq(slaTimers.name, 'case_resolution'),
        eq(slaTimers.status, 'running'),
      ),
    );

  await recordAudit(ctx, {
    objectType: 'cases',
    recordId: caseId,
    action: 'update',
    field: 'status',
    oldValue: record.status,
    newValue: 'resolved',
    metadata: { minutes, slaMet },
  });

  return { resolved: true, slaMet, minutes };
}

/**
 * Escalates a case and, past a threshold, opens an account risk. A support problem
 * that is about to cost a renewal should appear in the renewal conversation, not
 * only in a support queue.
 */
export async function escalateCase(
  user: AuthenticatedUser,
  caseId: string,
  reason: string,
  ctx: AuditContext,
): Promise<{ level: number; notifyRoles: string[]; riskCreated: boolean }> {
  assertCan(user, 'cases', 'update');
  const db = await getDb();

  const rows = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  const record = rows[0];
  if (!record) throw new NotFoundError('Case not found');

  const accountRows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, record.accountId))
    .limit(1);
  const account = accountRows[0];

  const breaches =
    (record.slaFirstResponseBreached ? 1 : 0) + (record.slaResolutionBreached ? 1 : 0);

  const escalation = escalationLevel({
    severity: record.severity,
    breachCount: breaches + 1,
    reopenCount: record.reopenCount,
    arrCents: account?.currentArrCents ?? 0,
    isStrategicAccount: account?.tier === 'strategic',
  });

  const escalateTo = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.active, true))
    .limit(1);

  await db
    .update(cases)
    .set({
      status: 'escalated',
      isEscalated: true,
      escalationLevel: escalation.level,
      escalatedAt: new Date(),
      escalatedToUserId: escalateTo[0]?.id ?? null,
      executiveVisible: escalation.executiveVisible,
      priority: 'urgent',
      updatedAt: new Date(),
      updatedById: user.id,
    })
    .where(eq(cases.id, caseId));

  let riskCreated = false;
  if (escalation.level >= 3 && account) {
    const existing = await db
      .select({ id: risks.id })
      .from(risks)
      .where(
        and(
          eq(risks.accountId, record.accountId),
          eq(risks.type, 'support'),
          eq(risks.status, 'open'),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      await db.insert(risks).values({
        accountId: record.accountId,
        type: 'support',
        severity: escalation.level >= 4 ? 'critical' : 'high',
        status: 'open',
        title: `Support escalation on ${record.number}: ${record.subject}`,
        description: reason,
        arrAtRiskCents: Math.round((account.currentArrCents ?? 0) * 0.4),
        ownerId: account.csmId ?? account.ownerId,
        detectedBy: 'support_trend',
        createdById: user.id,
      });
      riskCreated = true;
    }
  }

  await recordAudit({ ...ctx, reason }, {
    objectType: 'cases',
    recordId: caseId,
    action: 'update',
    field: 'escalationLevel',
    oldValue: String(record.escalationLevel),
    newValue: String(escalation.level),
    metadata: { notifyRoles: escalation.notifyRoles, riskCreated },
  });

  await emitEvent('chat', 'case.escalated', {
    caseNumber: record.number,
    level: escalation.level,
    accountName: account?.name,
    reason,
    notifyRoles: escalation.notifyRoles,
  }, { objectType: 'cases', recordId: caseId });

  return { level: escalation.level, notifyRoles: escalation.notifyRoles, riskCreated };
}

/** Marks SLA breaches on open cases. Run by the scheduled sweep. */
export async function sweepCaseSlaBreaches(
  now: Date = new Date(),
): Promise<{ firstResponseBreached: number; resolutionBreached: number }> {
  const db = await getDb();

  const fr = await db
    .select({ id: cases.id, due: cases.slaFirstResponseDueAt })
    .from(cases)
    .where(
      and(
        isNull(cases.firstResponseAt),
        eq(cases.slaFirstResponseBreached, false),
        sql`${cases.slaFirstResponseDueAt} < ${now}`,
      ),
    )
    .limit(500);

  for (const row of fr) {
    await db
      .update(cases)
      .set({ slaFirstResponseBreached: true, updatedAt: now })
      .where(eq(cases.id, row.id));
    await db
      .update(slaTimers)
      .set({ status: 'breached', breachedAt: row.due })
      .where(
        and(
          eq(slaTimers.recordId, row.id),
          eq(slaTimers.name, 'case_first_response'),
          eq(slaTimers.status, 'running'),
        ),
      );
  }

  const res = await db
    .select({ id: cases.id, due: cases.slaResolutionDueAt })
    .from(cases)
    .where(
      and(
        isNull(cases.resolvedAt),
        eq(cases.slaResolutionBreached, false),
        sql`${cases.slaResolutionDueAt} < ${now}`,
      ),
    )
    .limit(500);

  for (const row of res) {
    await db
      .update(cases)
      .set({ slaResolutionBreached: true, updatedAt: now })
      .where(eq(cases.id, row.id));
    await db
      .update(slaTimers)
      .set({ status: 'breached', breachedAt: row.due })
      .where(
        and(
          eq(slaTimers.recordId, row.id),
          eq(slaTimers.name, 'case_resolution'),
          eq(slaTimers.status, 'running'),
        ),
      );
  }

  return { firstResponseBreached: fr.length, resolutionBreached: res.length };
}

/** Support posture for an account, as the health model and renewal desk read it. */
export async function accountSupportSummary(accountId: string): Promise<{
  openCases: number;
  severity1Cases: number;
  openEscalations: number;
  slaBreaches90d: number;
  averageCsat: number | null;
  openDefects: number;
  servicesHoursOutstanding: number;
}> {
  const db = await getDb();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);

  const rows = await db.select().from(cases).where(eq(cases.accountId, accountId));

  const open = rows.filter((c) => !['resolved', 'closed'].includes(c.status));
  const csats = rows.map((c) => c.csatScore).filter((x): x is number => x != null);

  const defectIds = [...new Set(open.map((c) => c.defectId).filter((x): x is string => !!x))];
  const openDefects = defectIds.length
    ? (
        await db
          .select({ value: count() })
          .from(productDefects)
          .where(and(eq(productDefects.status, 'open')))
      )[0]
    : { value: 0 };

  return {
    openCases: open.length,
    severity1Cases: open.filter((c) => c.severity === 1).length,
    openEscalations: open.filter((c) => c.isEscalated).length,
    slaBreaches90d: rows.filter(
      (c) =>
        (c.slaFirstResponseBreached || c.slaResolutionBreached) && c.openedAt >= ninetyDaysAgo,
    ).length,
    averageCsat:
      csats.length > 0
        ? Math.round((csats.reduce((a, b) => a + b, 0) / csats.length) * 10) / 10
        : null,
    openDefects: Number(openDefects?.value ?? 0),
    servicesHoursOutstanding: open.reduce((s, c) => s + (c.servicesHoursRemaining ?? 0), 0),
  };
}

export { asc, desc, gte, subscriptions };
