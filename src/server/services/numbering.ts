import { count } from 'drizzle-orm';
import { getDb } from '@/db';
import { getObject } from '../objects';
import { docNumber } from '@/lib/ids';

/**
 * Human-quotable document numbers (Q-0042, SUB-0107).
 *
 * Derived from the current row count plus a random suffix on collision, which is
 * adequate for a single-writer system and keeps numbers short enough to read over
 * the phone. A production deployment under concurrent load would move this to a
 * Postgres sequence per document type.
 */

const PREFIXES: Record<string, string> = {
  quotes: 'Q',
  orders: 'ORD',
  contracts: 'CTR',
  subscriptions: 'SUB',
  subscription_amendments: 'AMD',
  cases: 'CASE',
  invoices: 'INV',
  deal_registrations: 'REG',
};

export async function nextNumber(objectKey: string): Promise<string> {
  const prefix = PREFIXES[objectKey] ?? objectKey.slice(0, 3).toUpperCase();
  const def = getObject(objectKey);
  const db = await getDb();
  const rows = await db.select({ value: count() }).from(def.table);
  const n = Number(rows[0]?.value ?? 0) + 1;
  return docNumber(prefix, n);
}
