import { and, eq, lte, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalIds, integrationConnections, integrationEvents } from '@/db/schema';
import { nextRetry } from '@/domain/workflow';

/**
 * Integration plumbing.
 *
 * The framework is real even though the providers are simulated: every message is a
 * durable row with an idempotency key, an attempt count, a next-retry time and a
 * dead-letter terminal state. Swapping a mock adapter for a live one is a change of
 * transport, not a change of architecture — the outbox, retry ladder, error queue
 * and lineage all keep working.
 */

export type IntegrationCategory =
  | 'marketing_automation'
  | 'sales_engagement'
  | 'call_intelligence'
  | 'cpq'
  | 'e_signature'
  | 'erp'
  | 'billing'
  | 'payments'
  | 'customer_success'
  | 'support'
  | 'product_telemetry'
  | 'iam'
  | 'data_warehouse'
  | 'bi'
  | 'partner_portal'
  | 'chat';

export type Adapter = {
  system: string;
  send: (
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<{ ok: boolean; externalId?: string; response?: Record<string, unknown>; error?: string }>;
};

/**
 * The mock adapter records what would have been sent and succeeds. It fails
 * deliberately on a payload containing `__forceFailure` so retry and dead-letter
 * behaviour is exercisable by the test suite rather than assumed.
 */
function mockAdapter(system: string): Adapter {
  return {
    system,
    async send(eventType, payload) {
      if (payload.__forceFailure) {
        return { ok: false, error: `Simulated ${system} failure for ${eventType}` };
      }
      return {
        ok: true,
        externalId: `${system}_${Math.random().toString(36).slice(2, 10)}`,
        response: { accepted: true, system, eventType, receivedAt: new Date().toISOString() },
      };
    },
  };
}

/**
 * A live adapter is selected only when its credential is configured. Absent a
 * credential the mock is used, which keeps the whole flow testable without
 * silently pretending a real send happened — `isMock` on the connection records
 * which path ran.
 */
function adapterFor(category: IntegrationCategory, system: string): { adapter: Adapter; isMock: boolean } {
  const credentials: Partial<Record<IntegrationCategory, string | undefined>> = {
    chat: process.env.SLACK_WEBHOOK_URL,
    billing: process.env.STRIPE_API_KEY,
    e_signature: process.env.DOCUSIGN_API_KEY,
  };

  const credential = credentials[category];
  if (!credential) return { adapter: mockAdapter(system), isMock: true };

  return {
    isMock: false,
    adapter: {
      system,
      async send(eventType, payload) {
        try {
          const res = await fetch(credential, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ eventType, payload }),
          });
          if (!res.ok) return { ok: false, error: `${system} responded ${res.status}` };
          return { ok: true, response: { status: res.status } };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
  };
}

async function connectionFor(category: IntegrationCategory) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.category, category))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Queues an outbound event. Never throws — an integration failure must not roll
 * back the business transaction that produced it, which is exactly why the outbox
 * exists.
 */
export async function emitEvent(
  category: IntegrationCategory,
  eventType: string,
  payload: Record<string, unknown>,
  opts: {
    objectType?: string;
    recordId?: string;
    idempotencyKey?: string;
    deliverNow?: boolean;
  } = {},
): Promise<{ queued: boolean; eventId: string | null; delivered: boolean }> {
  try {
    const db = await getDb();
    const connection = await connectionFor(category);
    if (!connection) return { queued: false, eventId: null, delivered: false };

    // Idempotency: a redelivered event must not double-apply.
    if (opts.idempotencyKey) {
      const existing = await db
        .select({ id: integrationEvents.id })
        .from(integrationEvents)
        .where(eq(integrationEvents.idempotencyKey, opts.idempotencyKey))
        .limit(1);
      if (existing[0]) return { queued: false, eventId: existing[0].id, delivered: false };
    }

    const inserted = await db
      .insert(integrationEvents)
      .values({
        connectionId: connection.id,
        direction: 'outbound',
        eventType,
        objectType: opts.objectType ?? null,
        recordId: opts.recordId ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
        payload,
        status: 'pending',
        lineage: { producedBy: 'spoton', producedAt: new Date().toISOString() },
      })
      .returning();

    const event = inserted[0];
    if (opts.deliverNow === false) return { queued: true, eventId: event.id, delivered: false };

    const result = await deliverEvent(event.id);
    return { queued: true, eventId: event.id, delivered: result.delivered };
  } catch {
    // Deliberately swallowed: see the note above.
    return { queued: false, eventId: null, delivered: false };
  }
}

export async function deliverEvent(
  eventId: string,
): Promise<{ delivered: boolean; status: string; error?: string }> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(integrationEvents)
    .where(eq(integrationEvents.id, eventId))
    .limit(1);
  const event = rows[0];
  if (!event) return { delivered: false, status: 'missing' };

  const connRows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, event.connectionId))
    .limit(1);
  const connection = connRows[0];
  if (!connection) return { delivered: false, status: 'missing_connection' };

  const { adapter, isMock } = adapterFor(
    connection.category as IntegrationCategory,
    connection.system,
  );

  const attempts = event.attempts + 1;
  const result = await adapter.send(event.eventType, event.payload as Record<string, unknown>);

  if (result.ok) {
    await db
      .update(integrationEvents)
      .set({
        status: 'succeeded',
        attempts,
        externalId: result.externalId ?? null,
        response: result.response ?? null,
        processedAt: new Date(),
        nextRetryAt: null,
        lastError: null,
      })
      .where(eq(integrationEvents.id, eventId));

    await db
      .update(integrationConnections)
      .set({
        status: 'connected',
        isMock,
        lastSyncAt: new Date(),
        lastSuccessAt: new Date(),
        eventsSent: sql`${integrationConnections.eventsSent} + 1`,
      })
      .where(eq(integrationConnections.id, connection.id));

    return { delivered: true, status: 'succeeded' };
  }

  const exhausted = attempts >= event.maxAttempts;
  await db
    .update(integrationEvents)
    .set({
      status: exhausted ? 'dead_letter' : 'retrying',
      attempts,
      lastError: result.error ?? 'Unknown error',
      nextRetryAt: exhausted ? null : nextRetry(attempts),
    })
    .where(eq(integrationEvents.id, eventId));

  await db
    .update(integrationConnections)
    .set({
      status: exhausted ? 'error' : 'degraded',
      lastErrorAt: new Date(),
      lastError: result.error ?? 'Unknown error',
      eventsFailed: sql`${integrationConnections.eventsFailed} + 1`,
    })
    .where(eq(integrationConnections.id, connection.id));

  return {
    delivered: false,
    status: exhausted ? 'dead_letter' : 'retrying',
    error: result.error,
  };
}

/** Drains the retry queue. Called by the scheduled job and by the tests. */
export async function processRetryQueue(
  now: Date = new Date(),
): Promise<{ attempted: number; delivered: number; deadLettered: number }> {
  const db = await getDb();
  const due = await db
    .select({ id: integrationEvents.id })
    .from(integrationEvents)
    .where(
      and(
        or(eq(integrationEvents.status, 'retrying'), eq(integrationEvents.status, 'pending')),
        or(
          lte(integrationEvents.nextRetryAt, now),
          eq(integrationEvents.status, 'pending'),
        ),
      ),
    )
    .limit(100);

  let delivered = 0;
  let deadLettered = 0;
  for (const row of due) {
    const result = await deliverEvent(row.id);
    if (result.delivered) delivered++;
    if (result.status === 'dead_letter') deadLettered++;
  }
  return { attempted: due.length, delivered, deadLettered };
}

/**
 * Records an inbound event. Change-data capture from a warehouse or a webhook from
 * a provider lands here first, so nothing is applied without a durable record of
 * what arrived.
 */
export async function receiveEvent(
  category: IntegrationCategory,
  eventType: string,
  payload: Record<string, unknown>,
  opts: { externalId?: string; idempotencyKey?: string; objectType?: string; recordId?: string } = {},
): Promise<{ accepted: boolean; eventId: string | null; duplicate: boolean }> {
  const db = await getDb();
  const connection = await connectionFor(category);
  if (!connection) return { accepted: false, eventId: null, duplicate: false };

  if (opts.idempotencyKey) {
    const existing = await db
      .select({ id: integrationEvents.id })
      .from(integrationEvents)
      .where(eq(integrationEvents.idempotencyKey, opts.idempotencyKey))
      .limit(1);
    if (existing[0]) return { accepted: true, eventId: existing[0].id, duplicate: true };
  }

  const inserted = await db
    .insert(integrationEvents)
    .values({
      connectionId: connection.id,
      direction: 'inbound',
      eventType,
      objectType: opts.objectType ?? null,
      recordId: opts.recordId ?? null,
      externalId: opts.externalId ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
      payload,
      status: 'succeeded',
      processedAt: new Date(),
      lineage: {
        receivedFrom: connection.system,
        receivedAt: new Date().toISOString(),
        externalId: opts.externalId ?? null,
      },
    })
    .returning();

  await db
    .update(integrationConnections)
    .set({ lastSyncAt: new Date(), lastSuccessAt: new Date() })
    .where(eq(integrationConnections.id, connection.id));

  return { accepted: true, eventId: inserted[0].id, duplicate: false };
}

/** Stable third-party key, so integrations never match on name or email. */
export async function linkExternalId(
  objectType: string,
  recordId: string,
  system: string,
  externalId: string,
): Promise<void> {
  const db = await getDb();
  await db
    .insert(externalIds)
    .values({ objectType, recordId, system, externalId, lastSyncedAt: new Date() })
    .onConflictDoNothing();
}

export async function resolveByExternalId(
  system: string,
  objectType: string,
  externalId: string,
): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select({ recordId: externalIds.recordId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.system, system),
        eq(externalIds.objectType, objectType),
        eq(externalIds.externalId, externalId),
      ),
    )
    .limit(1);
  return rows[0]?.recordId ?? null;
}

/** Sync health for the integration monitor. */
export async function integrationHealth(): Promise<
  {
    id: string;
    name: string;
    category: string;
    system: string;
    status: string;
    isMock: boolean;
    lastSyncAt: Date | null;
    eventsSent: number;
    eventsFailed: number;
    pending: number;
    deadLettered: number;
  }[]
> {
  const db = await getDb();
  const connections = await db.select().from(integrationConnections);

  const out = [];
  for (const c of connections) {
    const pendingRows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.connectionId, c.id),
          or(eq(integrationEvents.status, 'pending'), eq(integrationEvents.status, 'retrying')),
        ),
      );
    const deadRows = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(integrationEvents)
      .where(
        and(eq(integrationEvents.connectionId, c.id), eq(integrationEvents.status, 'dead_letter')),
      );

    out.push({
      id: c.id,
      name: c.name,
      category: c.category,
      system: c.system,
      status: c.status,
      isMock: c.isMock,
      lastSyncAt: c.lastSyncAt,
      eventsSent: c.eventsSent,
      eventsFailed: c.eventsFailed,
      pending: Number(pendingRows[0]?.value ?? 0),
      deadLettered: Number(deadRows[0]?.value ?? 0),
    });
  }
  return out;
}
