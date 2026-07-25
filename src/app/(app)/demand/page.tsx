import Link from 'next/link';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import { campaigns, leads, users } from '@/db/schema';
import { acquisitionFunnel, campaignRoi, pipelineBySource } from '@/server/services/analytics';
import { Empty, Grid, Meter, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { dateTime, humanise, moneyCompact, multiple, num, pct, truncate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Demand and attribution.
 *
 * Sourced and influenced are shown in separate columns and never summed: influenced
 * pipeline legitimately exceeds total pipeline because several teams touch the same
 * deal, and adding the two produces a number that means nothing.
 */
export default async function DemandPage() {
  await requireUser();
  const db = await getDb();

  const [funnel, roi, sources] = await Promise.all([
    acquisitionFunnel(),
    campaignRoi(),
    pipelineBySource(),
  ]);

  const topLeads = await db
    .select({ lead: leads, ownerName: users.name })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .orderBy(desc(leads.totalScore))
    .limit(25);

  const slaBreached = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.slaBreached, true));

  const unassigned = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(leads)
    .where(sql`${leads.ownerId} is null`);

  const mql = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(leads)
    .where(inArray(leads.status, ['mql', 'accepted', 'converted']));

  const converted = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.status, 'converted'));

  const totalSpend = roi.reduce((s, r) => s + r.costCents, 0);
  const totalSourced = roi.reduce((s, r) => s + r.sourcedArrCents, 0);

  return (
    <>
      <PageHeader
        title="Demand & Attribution"
        subtitle="Scoring across four independent dimensions, routing with a response-time SLA, and multi-touch attribution that keeps sourced and influenced credit distinct."
      />

      <Grid cols={6}>
        <StatTile label="Marketing spend" value={moneyCompact(totalSpend)} sub={`${num(roi.length)} campaigns`} />
        <StatTile label="Sourced ARR" value={moneyCompact(totalSourced)} sub="exclusive credit" tone="signal" />
        <StatTile
          label="Blended return"
          value={totalSpend > 0 ? multiple(Math.round((totalSourced / totalSpend) * 10_000)) : '—'}
          sub="sourced ARR per unit of spend"
          tone="good"
        />
        <StatTile label="MQLs" value={num(Number(mql[0]?.value ?? 0))} sub={`${num(Number(converted[0]?.value ?? 0))} converted`} />
        <StatTile
          label="Unassigned leads"
          value={num(Number(unassigned[0]?.value ?? 0))}
          tone={Number(unassigned[0]?.value ?? 0) > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label="Response SLA breached"
          value={num(Number(slaBreached[0]?.value ?? 0))}
          sub="never touched in time"
          tone={Number(slaBreached[0]?.value ?? 0) > 0 ? 'alarm' : 'good'}
        />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '0.75rem' }}>
        <Panel title="Acquisition funnel" eyebrow="Step and cumulative conversion">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th className="num">Count</th>
                <th className="num">From previous</th>
                <th className="num">From top</th>
                <th style={{ width: '28%' }} />
              </tr>
            </thead>
            <tbody>
              {funnel.stages.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td className="num">{num(s.count)}</td>
                  <td className="num">{pct(s.stepConversionBps, 0)}</td>
                  <td className="num">{pct(s.cumulativeConversionBps, 1)}</td>
                  <td>
                    <Meter valueBps={s.cumulativeConversionBps} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Pipeline by original source" eyebrow="Where pipeline comes from">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="num">Opportunities</th>
                  <th className="num">ARR</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.source}>
                    <td>{humanise(s.source)}</td>
                    <td className="num">{num(s.count)}</td>
                    <td className="num">{moneyCompact(s.arrCents)}</td>
                  </tr>
                ))}
                {sources.length === 0 && (
                  <tr>
                    <td colSpan={3}>
                      <Empty>No attributed pipeline.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div style={{ height: '0.75rem' }} />

      <Panel title="Campaign performance" eyebrow="Sourced and influenced shown separately, never summed">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Type</th>
                <th className="num">Cost</th>
                <th className="num">Sourced ARR</th>
                <th className="num">Influenced ARR</th>
                <th className="num">Return on sourced</th>
              </tr>
            </thead>
            <tbody>
              {roi.map((r) => (
                <tr key={r.campaignId}>
                  <td>
                    <Link href={`/o/campaigns/${r.campaignId}`}>{truncate(r.name, 46)}</Link>
                  </td>
                  <td>
                    <Tag value={r.type} label={humanise(r.type)} />
                  </td>
                  <td className="num">{moneyCompact(r.costCents)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {moneyCompact(r.sourcedArrCents)}
                  </td>
                  <td className="num" style={{ color: 'var(--fg-muted)' }}>
                    {moneyCompact(r.influencedArrCents)}
                  </td>
                  <td
                    className="num"
                    style={{
                      color:
                        r.roiBps >= 30_000
                          ? 'var(--color-good-400)'
                          : r.roiBps < 10_000
                            ? 'var(--color-alarm-400)'
                            : undefined,
                    }}
                  >
                    {r.costCents > 0 ? multiple(r.roiBps) : '—'}
                  </td>
                </tr>
              ))}
              {roi.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Empty>No campaigns yet.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ height: '0.75rem' }} />

      <Panel title="Highest-scoring leads" eyebrow="Fit, intent, engagement and behaviour kept apart">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Company</th>
                <th>Status</th>
                <th className="num">Fit</th>
                <th className="num">Intent</th>
                <th className="num">Engage</th>
                <th className="num">Behav</th>
                <th className="num">Negative</th>
                <th className="num">Total</th>
                <th>Grade</th>
                <th>Owner</th>
                <th className="num">SLA due</th>
              </tr>
            </thead>
            <tbody>
              {topLeads.map(({ lead, ownerName }) => (
                <tr key={lead.id}>
                  <td>
                    <Link href={`/o/leads/${lead.id}`}>
                      {[lead.firstName, lead.lastName].filter(Boolean).join(' ')}
                    </Link>
                  </td>
                  <td style={{ fontSize: '0.6875rem' }}>{truncate(lead.company, 26)}</td>
                  <td>
                    <Tag value={lead.status} label={humanise(lead.status)} />
                  </td>
                  <td className="num">{lead.fitScore}</td>
                  <td className="num">{lead.intentScore}</td>
                  <td className="num">{lead.engagementScore}</td>
                  <td className="num">{lead.behavioralScore}</td>
                  <td className="num" style={{ color: lead.negativeScore > 0 ? 'var(--color-alarm-400)' : 'var(--fg-muted)' }}>
                    {lead.negativeScore > 0 ? `−${lead.negativeScore}` : '—'}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {lead.totalScore}
                  </td>
                  <td>
                    <Tag
                      value={lead.grade === 'A' || lead.grade === 'B' ? 'good' : lead.grade === 'C' ? 'medium' : 'low'}
                      label={lead.grade ?? '—'}
                    />
                  </td>
                  <td style={{ fontSize: '0.6875rem' }}>{ownerName ?? '—'}</td>
                  <td className="num" style={{ fontSize: '0.6875rem' }}>
                    {lead.slaBreached ? (
                      <span className="tag tag-alarm">breached</span>
                    ) : (
                      dateTime(lead.slaDueAt)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
