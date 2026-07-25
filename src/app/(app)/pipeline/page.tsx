import Link from 'next/link';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import { accounts, opportunities, users } from '@/db/schema';
import { OPEN_STAGES, STAGES, type StageKey } from '@/domain/stages';
import { pipelineHealth } from '@/server/services/analytics';
import { Empty, Grid, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { date, money, moneyCompact, num, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

const BOARD_STAGES: StageKey[] = [...OPEN_STAGES, 're_nurture'];

/**
 * The pipeline board.
 *
 * Columns are the configured stages in order. Each card carries the signals that
 * actually predict a slip — days in stage, whether a next meeting exists, and how
 * many times the close date has moved — rather than just a name and a number.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const user = await requireUser();
  const db = await getDb();

  const ownerFilter = query.owner;
  const typeFilter = query.type;

  const rows = await db
    .select({
      opp: opportunities,
      accountName: accounts.name,
      ownerName: users.name,
    })
    .from(opportunities)
    .innerJoin(accounts, eq(opportunities.accountId, accounts.id))
    .leftJoin(users, eq(opportunities.ownerId, users.id))
    .where(
      and(
        eq(opportunities.isClosed, false),
        ownerFilter ? eq(opportunities.ownerId, ownerFilter) : sql`true`,
        typeFilter ? eq(opportunities.type, typeFilter as never) : sql`true`,
      ),
    )
    .orderBy(desc(opportunities.arrCents));

  const owners = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(asc(users.name));

  const health = await pipelineHealth();

  const byStage = new Map<StageKey, typeof rows>();
  for (const stage of BOARD_STAGES) byStage.set(stage, []);
  for (const row of rows) {
    const stage = row.opp.stage as StageKey;
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(row);
  }

  const openArr = rows
    .filter((r) => !STAGES[r.opp.stage as StageKey].isParked)
    .reduce((s, r) => s + r.opp.arrCents, 0);

  const noNextMeeting = rows.filter((r) => !r.opp.nextMeetingAt).length;
  const stale = rows.filter((r) => {
    if (!r.opp.stageEnteredAt) return false;
    return (Date.now() - r.opp.stageEnteredAt.getTime()) / 86_400_000 > 45;
  }).length;

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle="The configured nine-stage process. Advancing a deal is gated on that stage's objective exit criteria, so the board reflects real progress rather than optimism."
        action={
          <form style={{ display: 'flex', gap: '0.375rem' }}>
            <select className="field" name="owner" defaultValue={ownerFilter ?? ''} style={{ width: 170 }}>
              <option value="">All owners</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select className="field" name="type" defaultValue={typeFilter ?? ''} style={{ width: 150 }}>
              <option value="">All motions</option>
              {['new_logo', 'upsell', 'cross_sell', 'renewal', 'contraction', 'churn'].map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              Filter
            </button>
          </form>
        }
      />

      <Grid cols={5}>
        <StatTile label="Open ARR" value={moneyCompact(openArr)} sub={`${num(rows.length)} deals`} tone="signal" />
        <StatTile label="Win rate" value={pct(health.winRate.winRateBps, 0)} sub={`${num(health.winRate.won)} won · ${num(health.winRate.lost)} lost`} />
        <StatTile label="Average selling price" value={moneyCompact(health.averages.averageSellingPriceCents)} sub="ARR per won deal" />
        <StatTile label="No next meeting" value={num(noNextMeeting)} sub="strongest slip predictor" tone={noNextMeeting > 0 ? 'warn' : 'good'} />
        <StatTile label="Stalled over 45 days" value={num(stale)} sub="in current stage" tone={stale > 0 ? 'alarm' : 'good'} />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      {/* --- the board ---------------------------------------------------- */}
      <div className="scroll-x">
        <div style={{ display: 'flex', gap: '0.625rem', minWidth: 'min-content', alignItems: 'flex-start' }}>
          {BOARD_STAGES.map((stage) => {
            const def = STAGES[stage];
            const cards = byStage.get(stage) ?? [];
            const stageArr = cards.reduce((s, c) => s + c.opp.arrCents, 0);

            return (
              <div key={stage} style={{ width: 268, flexShrink: 0 }} className="panel">
                <header
                  className="panel-head"
                  style={{
                    borderBottom: `2px solid ${
                      def.isParked ? 'var(--rule-strong)' : 'var(--color-signal-500)'
                    }`,
                    display: 'block',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span className="panel-title">
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>
                        {def.displayNumber}
                      </span>{' '}
                      {def.label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                      {cards.length}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)', marginTop: 2 }}>
                    {moneyCompact(stageArr)} · {pct(def.defaultProbabilityBps, 0)} default
                  </div>
                </header>

                <div style={{ maxHeight: '62vh', overflowY: 'auto' }}>
                  {cards.map(({ opp, accountName, ownerName }) => {
                    const daysInStage = opp.stageEnteredAt
                      ? Math.round((Date.now() - opp.stageEnteredAt.getTime()) / 86_400_000)
                      : 0;
                    const overdue = opp.closeDate < new Date().toISOString().slice(0, 10);

                    return (
                      <Link
                        key={opp.id}
                        href={`/o/opportunities/${opp.id}`}
                        style={{
                          display: 'block',
                          padding: '0.5rem 0.625rem',
                          borderBottom: '1px solid var(--rule)',
                          textDecoration: 'none',
                          color: 'inherit',
                        }}
                      >
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.25 }}>
                          {accountName}
                        </div>
                        <div
                          style={{
                            fontSize: '0.6875rem',
                            color: 'var(--fg-muted)',
                            margin: '2px 0 4px',
                          }}
                        >
                          {opp.name.length > 46 ? `${opp.name.slice(0, 45)}…` : opp.name}
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.375rem',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.8125rem',
                              fontWeight: 700,
                              color: 'var(--color-signal-500)',
                            }}
                          >
                            {moneyCompact(opp.arrCents)}
                          </span>
                          <Tag value={opp.forecastCategory} />
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.25rem',
                            marginTop: '0.375rem',
                            fontSize: '0.5625rem',
                          }}
                        >
                          <span className="tag" title="Close date">
                            {date(opp.closeDate)}
                          </span>
                          {overdue && <span className="tag tag-alarm">Past close date</span>}
                          {daysInStage > 45 && <span className="tag tag-warn">{daysInStage}d in stage</span>}
                          {!opp.nextMeetingAt && <span className="tag tag-alarm">No meeting</span>}
                          {opp.pushCount > 1 && <span className="tag tag-warn">Pushed {opp.pushCount}×</span>}
                          {opp.type !== 'new_logo' && <span className="tag tag-info">{opp.type.replace(/_/g, ' ')}</span>}
                        </div>

                        <div style={{ fontSize: '0.5625rem', color: 'var(--fg-muted)', marginTop: 4 }}>
                          {ownerName ?? 'Unassigned'}
                          {opp.nextStep ? ` · ${opp.nextStep.slice(0, 34)}` : ''}
                        </div>
                      </Link>
                    );
                  })}
                  {cards.length === 0 && <Empty>Empty</Empty>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '0.75rem' }}>
        <Panel title="Stage conversion and velocity" eyebrow="From the stage transition ledger">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th className="num">Entered</th>
                  <th className="num">Advanced</th>
                  <th className="num">Conversion</th>
                  <th className="num">Avg days</th>
                </tr>
              </thead>
              <tbody>
                {health.conversion.map((c) => (
                  <tr key={c.stage}>
                    <td>
                      {STAGES[c.stage].displayNumber} {STAGES[c.stage].label}
                    </td>
                    <td className="num">{num(c.entered)}</td>
                    <td className="num">{num(c.advanced)}</td>
                    <td className="num">{pct(c.conversionBps, 0)}</td>
                    <td className="num">{num(c.averageDaysInStage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Pipeline ageing" eyebrow="Days in current stage">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th className="num">Deals</th>
                  <th style={{ width: '45%' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {health.aging.map((b) => {
                  const total = health.aging.reduce((s, x) => s + x.count, 0);
                  const share = total > 0 ? (b.count / total) * 100 : 0;
                  const bad = b.bucket.startsWith('90') || b.bucket.startsWith('61');
                  return (
                    <tr key={b.bucket}>
                      <td>{b.bucket}</td>
                      <td className="num">{num(b.count)}</td>
                      <td>
                        <div style={{ height: 8, background: 'var(--bg-inset)', border: '1px solid var(--rule)' }}>
                          <div
                            style={{
                              width: `${share}%`,
                              height: '100%',
                              background: bad ? 'var(--color-alarm-500)' : 'var(--color-signal-500)',
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
