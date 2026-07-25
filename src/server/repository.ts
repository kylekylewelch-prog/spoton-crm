import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
} from 'drizzle-orm';
import { getDb } from '@/db';
import type { AuthenticatedUser } from './auth';
import { recordAudit, recordFieldChanges, recordOwnershipChange, type AuditContext } from './audit';
import {
  assertCan,
  assertCanAccessRecord,
  filterWritable,
  NotFoundError,
  redact,
  redactMany,
  ValidationError,
} from './rbac';
import { editableFields, fieldDef, getObject, requiredFields, searchableFields } from './objects';
import { today } from '@/domain/dates';

/**
 * Generic record access.
 *
 * One implementation of list/get/create/update/delete, driven by the object
 * registry, applying object permissions, record scope, field-level security,
 * validation and audit on every path. Specialised services layer business rules on
 * top of this rather than reimplementing persistence, so nothing can quietly skip
 * the audit trail.
 */

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'is_null'
  | 'not_null';

export type Filter = { field: string; op: FilterOperator; value?: unknown };

export type ListOptions = {
  filters?: Filter[];
  search?: string;
  sort?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
};

export type ListResult<T = Record<string, unknown>> = {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
};

function column(objectKey: string, field: string) {
  const table = getObject(objectKey).table;
  const col = table[field];
  if (!col) {
    throw new ValidationError(`Unknown field "${field}" on ${objectKey}`, [
      { field, message: 'Unknown field' },
    ]);
  }
  return col;
}

function buildCondition(objectKey: string, filter: Filter): SQL | undefined {
  const col = column(objectKey, filter.field);
  switch (filter.op) {
    case 'eq':
      return eq(col, filter.value as never);
    case 'ne':
      return ne(col, filter.value as never);
    case 'gt':
      return gt(col, filter.value as never);
    case 'gte':
      return gte(col, filter.value as never);
    case 'lt':
      return lt(col, filter.value as never);
    case 'lte':
      return lte(col, filter.value as never);
    case 'in':
      return inArray(col, (Array.isArray(filter.value) ? filter.value : [filter.value]) as never[]);
    case 'contains':
      return ilike(col, `%${String(filter.value)}%`);
    case 'is_null':
      return isNull(col);
    case 'not_null':
      return isNotNull(col);
    default:
      return undefined;
  }
}

/** Coerces incoming values to what the column expects. */
export function coerceValue(objectKey: string, field: string, raw: unknown): unknown {
  const def = fieldDef(objectKey, field);
  if (raw === '' || raw === undefined) return null;
  if (raw === null) return null;
  if (!def) return raw;

  switch (def.type) {
    case 'number':
    case 'money':
    case 'bps': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''));
      return Number.isFinite(n) ? Math.round(n) : null;
    }
    case 'percent': {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.round(n * 100) : null;
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      return raw === 'true' || raw === 'on' || raw === '1' || raw === 1;
    case 'date':
      return typeof raw === 'string' ? raw.slice(0, 10) : raw;
    case 'datetime':
      if (raw instanceof Date) return raw;
      return new Date(String(raw));
    case 'json':
      if (typeof raw !== 'string') return raw;
      try {
        return JSON.parse(raw);
      } catch {
        throw new ValidationError(`${def.label} must be valid JSON`, [
          { field, message: 'Invalid JSON' },
        ]);
      }
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

export function coerceRecord(
  objectKey: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const allowed = new Set(editableFields(objectKey).map((x) => x.name));
  for (const [k, v] of Object.entries(input)) {
    if (!allowed.has(k)) continue;
    out[k] = coerceValue(objectKey, k, v);
  }
  return out;
}

/** Enum and required-field validation, driven by the registry. */
export function validateRecord(
  objectKey: string,
  data: Record<string, unknown>,
  { partial = false }: { partial?: boolean } = {},
): void {
  const failures: { field: string; message: string }[] = [];
  const def = getObject(objectKey);

  if (!partial) {
    for (const req of requiredFields(objectKey)) {
      const v = data[req.name];
      if (v === null || v === undefined || v === '') {
        failures.push({ field: req.name, message: `${req.label} is required` });
      }
    }
  }

  for (const [field, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    const fd = def.fields.find((x) => x.name === field);
    if (!fd) continue;

    if (fd.type === 'enum' && fd.options && !fd.options.includes(String(value))) {
      failures.push({
        field,
        message: `${fd.label} must be one of: ${fd.options.join(', ')}`,
      });
    }
    if (fd.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
      failures.push({ field, message: `${fd.label} is not a valid email address` });
    }
    if ((fd.type === 'money' || fd.type === 'number') && typeof value === 'number') {
      if (!Number.isFinite(value)) {
        failures.push({ field, message: `${fd.label} must be a number` });
      }
    }
    if (fd.type === 'bps' && typeof value === 'number' && (value < -1_000_000 || value > 1_000_000)) {
      failures.push({ field, message: `${fd.label} is out of range` });
    }
  }

  if (failures.length > 0) {
    // The specific rules go in the message as well as the structured list, so a
    // log line or a bare API response is self-explanatory without unpacking it.
    throw new ValidationError(
      `${failures.length} validation ${failures.length === 1 ? 'error' : 'errors'} on ${
        def.label
      }: ${failures.map((f) => f.message).join('; ')}`,
      failures,
    );
  }
}

/* --------------------------------------------------------------------- reads */

export async function list(
  user: AuthenticatedUser,
  objectKey: string,
  options: ListOptions = {},
): Promise<ListResult> {
  assertCan(user, objectKey, 'read');
  const def = getObject(objectKey);
  const db = await getDb();

  const conditions: SQL[] = [];
  for (const filter of options.filters ?? []) {
    const c = buildCondition(objectKey, filter);
    if (c) conditions.push(c);
  }

  if (options.search?.trim()) {
    const term = options.search.trim();
    const searchable = searchableFields(objectKey);
    if (searchable.length > 0) {
      const ors = searchable.map((sf) => ilike(def.table[sf.name], `%${term}%`));
      const combined = ors.length === 1 ? ors[0] : or(...ors);
      if (combined) conditions.push(combined);
    }
  }

  const where = conditions.length === 0 ? undefined : and(...conditions);

  const sortField = options.sort?.field ?? def.defaultSort?.field ?? 'createdAt';
  const sortDirection = options.sort?.direction ?? def.defaultSort?.direction ?? 'desc';
  const sortCol = def.table[sortField] ?? def.table.createdAt ?? def.table.id;

  const limit = Math.min(500, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);

  const rows = await db
    .select()
    .from(def.table)
    .where(where)
    .orderBy(sortDirection === 'asc' ? asc(sortCol) : desc(sortCol))
    .limit(limit)
    .offset(offset);

  const totals = await db.select({ value: count() }).from(def.table).where(where);

  return {
    rows: redactMany(user, objectKey, rows as Record<string, unknown>[]) as Record<
      string,
      unknown
    >[],
    total: Number(totals[0]?.value ?? 0),
    limit,
    offset,
  };
}

export async function get(
  user: AuthenticatedUser,
  objectKey: string,
  id: string,
): Promise<Record<string, unknown>> {
  assertCan(user, objectKey, 'read');
  const def = getObject(objectKey);
  const db = await getDb();

  const rows = await db.select().from(def.table).where(eq(def.table.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`${def.label} ${id} not found`);

  assertCanAccessRecord(user, objectKey, 'read', row as Record<string, never>);
  return redact(user, objectKey, row as Record<string, unknown>) as Record<string, unknown>;
}

/** Raw fetch that bypasses field security — for internal service use only. */
export async function getRaw(
  objectKey: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const def = getObject(objectKey);
  const db = await getDb();
  const rows = await db.select().from(def.table).where(eq(def.table.id, id)).limit(1);
  return (rows[0] as Record<string, unknown>) ?? null;
}

export async function listRaw(
  objectKey: string,
  filters: Filter[] = [],
  options: { limit?: number; sort?: { field: string; direction: 'asc' | 'desc' } } = {},
): Promise<Record<string, unknown>[]> {
  const def = getObject(objectKey);
  const db = await getDb();
  const conditions: SQL[] = [];
  for (const filter of filters) {
    const c = buildCondition(objectKey, filter);
    if (c) conditions.push(c);
  }
  const where = conditions.length === 0 ? undefined : and(...conditions);

  let query = db.select().from(def.table).where(where);
  if (options.sort) {
    const col = def.table[options.sort.field];
    if (col) query = query.orderBy(options.sort.direction === 'asc' ? asc(col) : desc(col)) as never;
  }
  if (options.limit) query = query.limit(options.limit) as never;
  return (await query) as Record<string, unknown>[];
}

export async function countWhere(objectKey: string, filters: Filter[] = []): Promise<number> {
  const def = getObject(objectKey);
  const db = await getDb();
  const conditions: SQL[] = [];
  for (const filter of filters) {
    const c = buildCondition(objectKey, filter);
    if (c) conditions.push(c);
  }
  const rows = await db
    .select({ value: count() })
    .from(def.table)
    .where(conditions.length === 0 ? undefined : and(...conditions));
  return Number(rows[0]?.value ?? 0);
}

/* -------------------------------------------------------------------- writes */

export async function create(
  user: AuthenticatedUser,
  objectKey: string,
  input: Record<string, unknown>,
  ctx: AuditContext,
): Promise<Record<string, unknown>> {
  assertCan(user, objectKey, 'create');
  const def = getObject(objectKey);

  if (def.systemManaged && !user.isAdmin && ctx.source !== 'workflow' && ctx.source !== 'job') {
    throw new ValidationError(
      `${def.labelPlural} are maintained by the system and cannot be created directly`,
    );
  }

  const coerced = coerceRecord(objectKey, input);
  const { allowed, rejected } = filterWritable(user, objectKey, coerced);
  if (rejected.length > 0 && !user.isAdmin) {
    // Silently dropping a field the user tried to set would be worse than saying so.
    throw new ValidationError(
      `You do not have permission to set: ${rejected.join(', ')}`,
      rejected.map((r) => ({ field: r, message: 'Read-only for your role' })),
    );
  }

  validateRecord(objectKey, allowed);

  const db = await getDb();
  const payload: Record<string, unknown> = { ...allowed };
  if (def.table.createdById) payload.createdById = user.id;
  if (def.table.updatedById) payload.updatedById = user.id;
  if (def.table.ownerId && !payload.ownerId) payload.ownerId = user.id;

  const inserted = (await db
    .insert(def.table)
    .values(payload)
    .returning()) as unknown as Record<string, unknown>[];
  const row = inserted[0];

  await recordAudit(ctx, {
    objectType: objectKey,
    recordId: row.id as string,
    action: 'create',
    metadata: { fields: Object.keys(allowed) },
  });

  if (def.table.ownerId) {
    await recordOwnershipChange(ctx, objectKey, row.id as string, {}, row, today());
  }

  return redact(user, objectKey, row) as Record<string, unknown>;
}

export async function update(
  user: AuthenticatedUser,
  objectKey: string,
  id: string,
  patch: Record<string, unknown>,
  ctx: AuditContext,
): Promise<Record<string, unknown>> {
  assertCan(user, objectKey, 'update');
  const def = getObject(objectKey);
  const db = await getDb();

  const existingRows = await db.select().from(def.table).where(eq(def.table.id, id)).limit(1);
  const before = existingRows[0] as Record<string, unknown> | undefined;
  if (!before) throw new NotFoundError(`${def.label} ${id} not found`);

  assertCanAccessRecord(user, objectKey, 'update', before as Record<string, never>);

  const coerced = coerceRecord(objectKey, patch);
  const { allowed, rejected } = filterWritable(user, objectKey, coerced);
  if (rejected.length > 0 && !user.isAdmin) {
    throw new ValidationError(
      `You do not have permission to change: ${rejected.join(', ')}`,
      rejected.map((r) => ({ field: r, message: 'Read-only for your role' })),
    );
  }

  validateRecord(objectKey, allowed, { partial: true });
  if (Object.keys(allowed).length === 0) {
    return redact(user, objectKey, before) as Record<string, unknown>;
  }

  const payload: Record<string, unknown> = { ...allowed };
  if (def.table.updatedAt) payload.updatedAt = new Date();
  if (def.table.updatedById) payload.updatedById = user.id;

  const updated = await db
    .update(def.table)
    .set(payload)
    .where(eq(def.table.id, id))
    .returning();
  const after = updated[0] as Record<string, unknown>;

  await recordFieldChanges(ctx, objectKey, id, before, allowed);
  await recordOwnershipChange(ctx, objectKey, id, before, allowed, today());

  return redact(user, objectKey, after) as Record<string, unknown>;
}

export async function remove(
  user: AuthenticatedUser,
  objectKey: string,
  id: string,
  ctx: AuditContext,
): Promise<void> {
  assertCan(user, objectKey, 'delete');
  const def = getObject(objectKey);

  if (def.systemManaged && !user.isAdmin) {
    throw new ValidationError(
      `${def.labelPlural} form part of the audit record and cannot be deleted`,
    );
  }

  const db = await getDb();
  const rows = await db.select().from(def.table).where(eq(def.table.id, id)).limit(1);
  const before = rows[0] as Record<string, unknown> | undefined;
  if (!before) throw new NotFoundError(`${def.label} ${id} not found`);

  assertCanAccessRecord(user, objectKey, 'delete', before as Record<string, never>);

  await db.delete(def.table).where(eq(def.table.id, id));
  await recordAudit(ctx, {
    objectType: objectKey,
    recordId: id,
    action: 'delete',
    metadata: { snapshot: before },
  });
}

/* --------------------------------------------------------- system-level writes */

/**
 * Insert performed by the platform itself (workflows, seeding, the subscription
 * engine). Still audited — the difference is that it is not gated on a human's
 * object permissions, because the system is the actor.
 */
export async function systemCreate(
  objectKey: string,
  values: Record<string, unknown>,
  ctx: AuditContext,
): Promise<Record<string, unknown>> {
  const def = getObject(objectKey);
  const db = await getDb();
  const inserted = (await db
    .insert(def.table)
    .values(values)
    .returning()) as unknown as Record<string, unknown>[];
  const row = inserted[0];
  await recordAudit(ctx, {
    objectType: objectKey,
    recordId: row.id as string,
    action: 'create',
    metadata: { system: true },
  });
  return row;
}

export async function systemUpdate(
  objectKey: string,
  id: string,
  values: Record<string, unknown>,
  ctx: AuditContext,
): Promise<Record<string, unknown>> {
  const def = getObject(objectKey);
  const db = await getDb();

  const existing = await db.select().from(def.table).where(eq(def.table.id, id)).limit(1);
  const before = (existing[0] ?? {}) as Record<string, unknown>;

  const payload = { ...values } as Record<string, unknown>;
  if (def.table.updatedAt) payload.updatedAt = new Date();

  const updated = await db.update(def.table).set(payload).where(eq(def.table.id, id)).returning();
  const after = updated[0] as Record<string, unknown>;

  await recordFieldChanges(ctx, objectKey, id, before, values);
  return after;
}

/** Bulk insert used by the seeder and the import pipeline. */
export async function systemInsertMany(
  objectKey: string,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const def = getObject(objectKey);
  const db = await getDb();

  // Chunked so a large import does not exceed parameter limits.
  const out: Record<string, unknown>[] = [];
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const inserted = await db
      .insert(def.table)
      .values(rows.slice(i, i + CHUNK))
      .returning();
    out.push(...(inserted as Record<string, unknown>[]));
  }
  return out;
}
