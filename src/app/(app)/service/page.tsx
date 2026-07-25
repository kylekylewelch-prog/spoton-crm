import Link from 'next/link';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import { accounts, cases, productDefects, users } from '@/db/schema';
import { slaAttainment } from '@/server/services/analytics';
import { Empty, Grid, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { dateTime, humanise, money, moneyCompact, num, pct, truncate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const OPEN_STATUSES = ['new', 'open', 'pending_customer', 'escalated'] as const;

/**
 * Service and case visibility.
 *
 * The ARR column is deliberately present: a severity-1 on a strategic account is a
 * different commercial event from the same ticket on a small one, and support
 * queues that hide that fact escalate the wrong things.
 */
export default async function ServicePage() {
  await requireUser();
  const db = await getDb();

  const open = await db
    .select({
      ticket: cases,
      accountName: accounts.name,
      accountArr: accounts.currentArrCents,
      tier: accounts.tier,
      ownerName: users.name,
    })
    .from(cases)
    .innerJoin(accounts, eq(cases.accountId, accounts.id))
    .leftJoin(users, eq(cases.ownerId, users.id))
    .where(inArray(cases.status, [...OPEN_STATUSES]))
    .orderBy(desc(cases.isEscalated), cases.severity, desc(accounts.currentArrCents));

  const recentlyClosed = await db
    .select({ ticket: cases, accountName: accounts.name })
    .from(cases)
    .innerJoin(accounts, eq(cases.accountId, accounts.id))
    .where(inArray(cases.status, ['resolved', 'closed']))
    .orderBy(desc(cases.resolvedAt))
    .limit(20);

  const defects = await db
    .select()
    .from(productDefects)
    .orderBy(desc(productDefects.arrImpactedCents))
    .limit(12);

  const sla = await slaAttainment();

  const severity1 = open.filter((c) => c.ticket.severity === 1);
  const escalated = open.filter((c) => c.ticket.isEscalated);
  const breached = open.filter(
    (c) => c.ticket.slaFirstResponseBreached || c.ticket.slaResolutionBreached,
  );
  const arrWithOpenCases = [...new Set(open.map((c) => c.ticket.accountId))].length;

  const resolved = recentlyClosed.filter((c) => c.ticket.timeToResolutionMinutes != null);
  const avgResolution =
    resolved.length > 0
      ? Math.round(
          resolved.reduce((s, c) => s + (c.ticket.timeToResolutionMinutes ?? 0), 0) /
            resolved.length /
            60,
        )
      : 0;

  return (
    <>
      <PageHeader
        title="Service"
        subtitle="Tickets with entitlement-driven SLA targets. Support history feeds account health, renewal risk and deal inspection, so a support problem shows up in the commercial conversation."
      />

      <Grid cols={6}>
        <StatTile label="Open tickets" value={num(open.length)} sub={`${num(arrWithOpenCases)} accounts affected`} />
        <StatTile label="Severity 1" value={num(severity1.length)} sub="production impact" tone={severity1.length > 0 ? 'alarm' : 'good'} />
        <StatTile label="Escalated" value={num(escalated.length)} sub="above level 0" tone={escalated.length > 0 ? 'warn' : 'good'} />
        <StatTile label="SLA breached" value={num(breached.length)} sub="open tickets past target" tone={breached.length > 0 ? 'alarm' : 'good'} />
        <StatTile
          label="SLA attainment"
          value={pct(sla.overall.attainmentBps, 0)}
          sub={`${num(sla.overall.met)} met · ${num(sla.overall.breached)} missed`}
          tone={sla.overall.attainmentBps >= 9000 ? 'good' : 'warn'}
        />
        <StatTile label="Mean time to resolve" value={`${num(avgResolution)}h`} sub="recently closed" />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <Panel title="Open queue" eyebrow="Ordered by escalation, then severity, then account value">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Account</th>
                <th className="num">Account ARR</th>
                <th className="num">Sev</th>
                <th>Status</th>
                <th>Support level</th>
                <th className="num">First response due</th>
                <th className="num">Resolution due</th>
                <th>SLA</th>
                <th>Owner</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {open.map((c) => (
                <tr key={c.ticket.id}>
                  <td>
                    <Link href={`/o/cases/${c.ticket.id}`}>
                      <code style={{ fontSize: '0.6875rem' }}>{c.ticket.number}</code>
                    </Link>
                    <div style={{ fontSize: '0.6875rem' }}>{truncate(c.ticket.subject, 44)}</div>
                  </td>
                  <td>
                    <Link href={`/o/accounts/${c.ticket.accountId}`}>{c.accountName}</Link>
                    <div style={{ fontSize: '0.5625rem', color: 'var(--fg-muted)' }}>
                      {humanise(c.tier)}
                    </div>
                  </td>
                  <td className="num">{moneyCompact(c.accountArr)}</td>
                  <td className="num">
                    <span
                      className={
                        c.ticket.severity === 1
                          ? 'tag tag-alarm'
                          : c.ticket.severity === 2
                            ? 'tag tag-warn'
                            : 'tag'
                      }
                    >
                      {c.ticket.severity}
                    </span>
                  </td>
                  <td>
                    <Tag value={c.ticket.status} label={humanise(c.ticket.status)} />
                  </td>
                  <td style={{ fontSize: '0.6875rem' }}>
                    {c.ticket.supportLevel ? (
                      humanise(c.ticket.supportLevel)
                    ) : (
                      <span className="tag tag-warn" title="No support entitlement found">
                        unentitled
                      </span>
                    )}
                  </td>
                  <td className="num" style={{ fontSize: '0.6875rem' }}>
                    {dateTime(c.ticket.slaFirstResponseDueAt)}
                  </td>
                  <td className="num" style={{ fontSize: '0.6875rem' }}>
                    {dateTime(c.ticket.slaResolutionDueAt)}
                  </td>
                  <td>
                    {c.ticket.slaFirstResponseBreached || c.ticket.slaResolutionBreached ? (
                      <span className="tag tag-alarm">Breached</span>
                    ) : (
                      <span className="tag tag-good">On track</span>
                    )}
                  </td>
                  <td style={{ fontSize: '0.6875rem' }}>{c.ownerName ?? '—'}</td>
                  <td className="num">
                    <Link className="btn" href={`/o/cases/${c.ticket.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {open.length === 0 && (
                <tr>
                  <td colSpan={11}>
                    <Empty>No open tickets.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '0.75rem' }}>
        <Panel title="SLA attainment by timer" eyebrow="Every timer has a target and a terminal state">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Timer</th>
                <th className="num">Met</th>
                <th className="num">Breached</th>
                <th className="num">Running</th>
                <th className="num">Attainment</th>
              </tr>
            </thead>
            <tbody>
              {sla.timers.map((t) => (
                <tr key={t.name}>
                  <td>{humanise(t.name)}</td>
                  <td className="num" style={{ color: 'var(--color-good-400)' }}>
                    {num(t.met)}
                  </td>
                  <td className="num" style={{ color: 'var(--color-alarm-400)' }}>
                    {num(t.breached)}
                  </td>
                  <td className="num">{num(t.running)}</td>
                  <td className="num">{pct(t.attainmentBps, 0)}</td>
                </tr>
              ))}
              {sla.timers.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <Empty>No SLA timers recorded.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>

        <Panel title="Product defects and known limitations" eyebrow="With ARR exposure">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Title</th>
                  <th className="num">Sev</th>
                  <th>Status</th>
                  <th className="num">Cases</th>
                  <th className="num">ARR impacted</th>
                </tr>
              </thead>
              <tbody>
                {defects.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <code style={{ fontSize: '0.6875rem' }}>{d.key}</code>
                    </td>
                    <td>{truncate(d.title, 44)}</td>
                    <td className="num">{d.severity}</td>
                    <td>
                      {d.isKnownLimitation ? (
                        <span className="tag">Limitation</span>
                      ) : (
                        <Tag value={d.status} />
                      )}
                    </td>
                    <td className="num">{num(d.linkedCaseCount)}</td>
                    <td className="num">{d.arrImpactedCents ? money(d.arrImpactedCents) : '—'}</td>
                  </tr>
                ))}
                {defects.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <Empty>No recorded defects.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
