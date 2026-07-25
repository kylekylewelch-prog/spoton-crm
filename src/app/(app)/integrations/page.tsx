import { desc, eq } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import { integrationEvents } from '@/db/schema';
import { integrationHealth } from '@/server/services/integrations';
import { Empty, Grid, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { dateTime, humanise, num, truncate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The integration monitor.
 *
 * The plumbing is real even where the providers are simulated: durable outbox rows,
 * idempotency keys, a bounded retry ladder and a dead-letter queue a human can see.
 * Swapping a mock adapter for a live one changes the transport, not the architecture.
 */
export default async function IntegrationsPage() {
  await requireUser();
  const db = await getDb();

  const connections = await integrationHealth();

  const recent = await db
    .select()
    .from(integrationEvents)
    .orderBy(desc(integrationEvents.createdAt))
    .limit(40);

  const deadLetters = await db
    .select()
    .from(integrationEvents)
    .where(eq(integrationEvents.status, 'dead_letter'))
    .orderBy(desc(integrationEvents.createdAt))
    .limit(20);

  const totalPending = connections.reduce((s, c) => s + c.pending, 0);
  const totalDead = connections.reduce((s, c) => s + c.deadLettered, 0);
  const degraded = connections.filter((c) => c.status !== 'connected');
  const simulated = connections.filter((c) => c.isMock);

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Every inbound and outbound message is a durable row with an attempt count, a next-retry time and a dead-letter terminal state, so nothing is silently lost and every sync is replayable."
      />

      <Grid cols={5}>
        <StatTile label="Connections" value={num(connections.length)} sub={`${num(simulated.length)} using mock adapters`} tone="signal" />
        <StatTile label="Degraded or errored" value={num(degraded.length)} tone={degraded.length > 0 ? 'warn' : 'good'} />
        <StatTile label="Queued for retry" value={num(totalPending)} sub="exponential backoff, capped at an hour" tone={totalPending > 0 ? 'warn' : 'good'} />
        <StatTile label="Dead letters" value={num(totalDead)} sub="awaiting human triage" tone={totalDead > 0 ? 'alarm' : 'good'} />
        <StatTile
          label="Events delivered"
          value={num(connections.reduce((s, c) => s + c.eventsSent, 0))}
          sub={`${num(connections.reduce((s, c) => s + c.eventsFailed, 0))} failed`}
        />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <Panel title="Connection health" eyebrow="Category, transport and sync state">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Connection</th>
                <th>Category</th>
                <th>System</th>
                <th>Status</th>
                <th>Adapter</th>
                <th className="num">Last sync</th>
                <th className="num">Sent</th>
                <th className="num">Failed</th>
                <th className="num">Queued</th>
                <th className="num">Dead</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700 }}>{c.name}</td>
                  <td style={{ fontSize: '0.6875rem' }}>{humanise(c.category)}</td>
                  <td style={{ fontSize: '0.6875rem' }}>
                    <code>{c.system}</code>
                  </td>
                  <td>
                    <Tag value={c.status} label={humanise(c.status)} />
                  </td>
                  <td>
                    {c.isMock ? (
                      <span className="tag" title="No credential configured — using the simulator">
                        Simulated
                      </span>
                    ) : (
                      <span className="tag tag-good">Live</span>
                    )}
                  </td>
                  <td className="num" style={{ fontSize: '0.6875rem' }}>
                    {dateTime(c.lastSyncAt)}
                  </td>
                  <td className="num">{num(c.eventsSent)}</td>
                  <td className="num" style={{ color: c.eventsFailed > 0 ? 'var(--color-warn-500)' : undefined }}>
                    {num(c.eventsFailed)}
                  </td>
                  <td className="num">{num(c.pending)}</td>
                  <td className="num" style={{ color: c.deadLettered > 0 ? 'var(--color-alarm-400)' : undefined }}>
                    {num(c.deadLettered)}
                  </td>
                </tr>
              ))}
              {connections.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <Empty>No integration connections configured.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ height: '0.75rem' }} />

      {deadLetters.length > 0 && (
        <>
          <Panel title="Exception queue" eyebrow="Failures that exhausted their retries">
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Object</th>
                    <th className="num">Attempts</th>
                    <th>Last error</th>
                    <th className="num">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {deadLetters.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <code style={{ fontSize: '0.6875rem' }}>{e.eventType}</code>
                      </td>
                      <td style={{ fontSize: '0.6875rem' }}>{e.objectType ?? '—'}</td>
                      <td className="num">{num(e.attempts)}</td>
                      <td style={{ fontSize: '0.6875rem', color: 'var(--color-alarm-400)' }}>
                        {truncate(e.lastError, 60)}
                      </td>
                      <td className="num" style={{ fontSize: '0.6875rem' }}>
                        {dateTime(e.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <div style={{ height: '0.75rem' }} />
        </>
      )}

      <Panel title="Recent event log" eyebrow="With lineage and idempotency keys">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Direction</th>
                <th>Object</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th>External id</th>
                <th className="num">Next retry</th>
                <th className="num">Created</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id}>
                  <td>
                    <code style={{ fontSize: '0.6875rem' }}>{e.eventType}</code>
                  </td>
                  <td style={{ fontSize: '0.6875rem' }}>{e.direction}</td>
                  <td style={{ fontSize: '0.6875rem' }}>{e.objectType ?? '—'}</td>
                  <td>
                    <Tag value={e.status} label={humanise(e.status)} />
                  </td>
                  <td className="num">{num(e.attempts)}</td>
                  <td style={{ fontSize: '0.625rem', color: 'var(--fg-muted)' }}>
                    {e.externalId ? truncate(e.externalId, 22) : '—'}
                  </td>
                  <td className="num" style={{ fontSize: '0.6875rem' }}>
                    {dateTime(e.nextRetryAt)}
                  </td>
                  <td className="num" style={{ fontSize: '0.6875rem' }}>
                    {dateTime(e.createdAt)}
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <Empty>No integration events recorded.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
