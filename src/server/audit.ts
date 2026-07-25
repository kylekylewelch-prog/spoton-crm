import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditLog, ownershipHistory } from '@/db/schema';
import type { AuthenticatedUser } from './auth';

/**
 * Audit trail.
 *
 * Every mutation records who, what, when, from where and — for overrides and
 * machine-initiated writes — why. Field-level diffs are stored one row per changed
 * field so "when did this close date move and who moved it" is a query rather than
 * an archaeology project.
 */

export type AuditSource = 'ui' | 'api' | 'mcp' | 'workflow' | 'integration' | 'seed' | 'job';

export type AuditContext = {
  user?: Pick<AuthenticatedUser, 'id'> | null;
  source: AuditSource;
  reason?: string | null;
};

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'approve'
  | 'reject'
  | 'convert'
  | 'book'
  | 'export'
  | 'override'
  | 'ai_action';

const IGNORED_FIELDS = new Set(['updatedAt', 'createdAt', 'updatedById', 'createdById']);

function serialise(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Fields whose values actually differ, ignoring bookkeeping columns. */
export function diffRecords(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { field: string; oldValue: string | null; newValue: string | null }[] {
  const out: { field: string; oldValue: string | null; newValue: string | null }[] = [];
  for (const key of Object.keys(after)) {
    if (IGNORED_FIELDS.has(key)) continue;
    const oldValue = serialise(before[key]);
    const newValue = serialise(after[key]);
    if (oldValue !== newValue) out.push({ field: key, oldValue, newValue });
  }
  return out;
}

export async function recordAudit(
  ctx: AuditContext,
  entry: {
    objectType: string;
    recordId: string;
    action: AuditAction;
    field?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  const db = await getDb();
  await db.insert(auditLog).values({
    objectType: entry.objectType,
    recordId: entry.recordId,
    action: entry.action,
    field: entry.field ?? null,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    userId: ctx.user?.id ?? null,
    source: ctx.source,
    reason: ctx.reason ?? null,
    metadata: entry.metadata ?? null,
  });
}

/** Writes one row per changed field, plus nothing at all if nothing changed. */
export async function recordFieldChanges(
  ctx: AuditContext,
  objectType: string,
  recordId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  action: AuditAction = 'update',
): Promise<number> {
  const changes = diffRecords(before, after);
  if (changes.length === 0) return 0;

  const db = await getDb();
  await db.insert(auditLog).values(
    changes.map((c) => ({
      objectType,
      recordId,
      action,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      userId: ctx.user?.id ?? null,
      source: ctx.source,
      reason: ctx.reason ?? null,
    })),
  );
  return changes.length;
}

export async function auditHistory(
  objectType: string,
  recordId: string,
  limit = 100,
): Promise<(typeof auditLog.$inferSelect)[]> {
  const db = await getDb();
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.objectType, objectType), eq(auditLog.recordId, recordId)))
    .orderBy(desc(auditLog.at))
    .limit(limit);
}

/* --------------------------------------------------------- ownership history */

const OWNER_FIELDS: Record<string, string> = {
  ownerId: 'account_executive',
  accountExecutiveId: 'account_executive',
  bdrId: 'bdr',
  csmId: 'customer_success_manager',
  renewalManagerId: 'renewal_manager',
  supportOwnerId: 'support_engineer',
  channelManagerId: 'channel_manager',
};

/**
 * Effective-dates an ownership change.
 *
 * The previous holder's row is closed the day before the new one opens, so there
 * is never a gap or an overlap. Without this, historical attainment and
 * commission become guesswork after any territory change.
 */
export async function recordOwnershipChange(
  ctx: AuditContext,
  objectType: string,
  recordId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  effectiveFrom: string,
): Promise<void> {
  const db = await getDb();
  const rows: (typeof ownershipHistory.$inferInsert)[] = [];

  for (const [field, role] of Object.entries(OWNER_FIELDS)) {
    if (!(field in after)) continue;
    const previous = before[field] as string | null | undefined;
    const next = after[field] as string | null | undefined;
    if (previous === next || !next) continue;

    if (previous) {
      const yesterday = new Date(new Date(effectiveFrom).getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      await db
        .update(ownershipHistory)
        .set({ effectiveTo: yesterday })
        .where(
          and(
            eq(ownershipHistory.objectType, objectType),
            eq(ownershipHistory.recordId, recordId),
            eq(ownershipHistory.userId, previous),
          ),
        );
    }

    rows.push({
      objectType,
      recordId,
      role: role as never,
      userId: next,
      teamId: (after.teamId ?? before.teamId ?? null) as string | null,
      effectiveFrom,
      reason: ctx.reason ?? 'Ownership change',
    });
  }

  if (rows.length > 0) await db.insert(ownershipHistory).values(rows);
}

/** An override always demands a reason — that is the whole point of allowing it. */
export async function recordOverride(
  ctx: AuditContext,
  objectType: string,
  recordId: string,
  what: string,
  reason: string,
): Promise<void> {
  await recordAudit({ ...ctx, reason }, {
    objectType,
    recordId,
    action: 'override',
    field: what,
    newValue: reason,
    metadata: { overriddenBy: ctx.user?.id ?? null, at: new Date().toISOString() },
  });
}
