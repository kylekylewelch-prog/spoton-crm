import { bigint, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { newId } from '@/lib/ids';

/**
 * Money is stored as integer minor units (cents). Every ARR, MRR, TCV and
 * discount calculation in the system is integer arithmetic — no floating point
 * ever touches a revenue number, so waterfalls reconcile exactly and tests are
 * deterministic. bigint keeps headroom well beyond any realistic contract.
 */
export const money = (name: string) => bigint(name, { mode: 'number' });

/** Rates and percentages are stored as basis points: 12.5% === 1250 bps. */
export const bps = (name: string) => integer(name);

export const pk = (prefix: string) =>
  text('id')
    .primaryKey()
    .$defaultFn(() => newId(prefix));

export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => ts('created_at').notNull().defaultNow();
export const updatedAt = () => ts('updated_at').notNull().defaultNow();

export const auditCols = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdById: text('created_by_id'),
  updatedById: text('updated_by_id'),
};
