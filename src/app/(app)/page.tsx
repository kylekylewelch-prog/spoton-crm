import Link from 'next/link';
import { requireUser } from '@/server/session';
import {
  arrWaterfall,
  atRiskAccounts,
  executiveDashboard,
  expansionWhitespace,
  pipelineBySource,
} from '@/server/services/analytics';
import { Bar, Empty, Grid, Panel, PageHeader, StatTile, Tag } from '@/components/ui';
import { moneyCompact, multiple, num, pct, relativeDays, signedMoney } from '@/lib/format';
import { fiscalQuarter, quarterBounds, today } from '@/domain/dates';
import { STAGES } from '@/domain/stages';

export const dynamic = 'force-dynamic';

/**
 * The executive dashboard.
 *
 * Structured around the questions a revenue leader has to answer, in order: where
 * pipeline comes from, what is likely to close, what happened to ARR, who will
 * renew, who is at risk, and where the expansion is. Every number is read from the
 * operational tables rather than a parallel reporting store.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const quarter = fiscalQuarter(today());
  const { start, end } = quarterBounds(quarter);

  const [dash, waterfall, sources, atRisk, whitespace] = await Promise.all([
    executiveDashboard(),
    arrWaterfall(start, end),
    pipelineBySource(),
    atRiskAccounts(6),
    expansionWhitespace(6),
  ]);

  const period = waterfall.periods.at(-1);
  const totals = waterfall.periods.reduce(
    (acc, p) => ({
      newArr: acc.newArr + p.newArrCents,
      expansion: acc.expansion + p.expansionArrCents,
      uplift: acc.uplift + p.upliftArrCents,
      contraction: acc.contraction + p.contractionArrCents,
      churn: acc.churn + p.churnArrCents,
    }),
    { newArr: 0, expansion: 0, uplift: 0, contraction: 0, churn: 0 },
  );

  return (
    <>
      <PageHeader
        title={`Good day, ${user.name.split(' ')[0]}`}
        subtitle={`Revenue position for ${quarter}. Every figure here is derived from the operational ledgers — bookings, the ARR movement ledger, the renewal book and the support queue — so the dashboard and the record always agree.`}
      />

      {/* --- headline ------------------------------------------------------ */}
      <Grid cols={5}>
        <StatTile
          label="Current ARR"
          value={moneyCompact(dash.arr.currentCents)}
          sub={`${num(dash.counts.customers)} customers`}
          tone="signal"
        />
        <StatTile
          label="Net revenue retention"
          value={pct(dash.retention.netRetentionBps, 0)}
          sub={`gross ${pct(dash.retention.grossRetentionBps, 0)}`}
          tone={dash.retention.netRetentionBps >= 10_000 ? 'good' : 'alarm'}
        />
        <StatTile
          label="Open pipeline"
          value={moneyCompact(dash.pipeline.totalOpenArrCents)}
          sub={`${num(dash.counts.openOpportunities)} opportunities`}
        />
        <StatTile
          label={`${quarter} call`}
          value={moneyCompact(dash.forecast.callCents)}
          sub={`quota ${moneyCompact(dash.forecast.quotaCents)} · coverage ${multiple(dash.forecast.coverageBps)}`}
          tone={dash.forecast.callCents >= dash.forecast.quotaCents ? 'good' : 'warn'}
        />
        <StatTile
          label="Renewals next 180 days"
          value={moneyCompact(dash.renewals.renewableArrCents)}
          sub={`${moneyCompact(dash.renewals.atRiskArrCents)} at risk`}
          tone={dash.renewals.atRiskArrCents > 0 ? 'warn' : 'good'}
          href="/renewals"
        />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))',
          gap: '0.75rem',
        }}
      >
        {/* --- ARR movement ----------------------------------------------- */}
        <Panel
          title="ARR movement this quarter"
          eyebrow="What ARR was added, expanded, contracted or lost"
          action={
            <Link href="/revenue" className="btn">
              Waterfall
            </Link>
          }
        >
          <div style={{ padding: '0.875rem' }}>
            <Bar
              height={14}
              segments={[
                { label: 'New', value: totals.newArr, color: 'var(--color-signal-500)' },
                { label: 'Expansion', value: totals.expansion, color: 'var(--color-good-500)' },
                { label: 'Uplift', value: totals.uplift, color: 'var(--color-info-500)' },
                { label: 'Contraction', value: totals.contraction, color: 'var(--color-warn-500)' },
                { label: 'Churn', value: totals.churn, color: 'var(--color-alarm-500)' },
              ]}
            />
            <table className="grid-table" style={{ marginTop: '0.75rem' }}>
              <tbody>
                <tr>
                  <td>Opening ARR</td>
                  <td className="num">{moneyCompact(waterfall.periods[0]?.beginningArrCents ?? 0)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-signal-500)' }}>New</td>
                  <td className="num">{signedMoney(totals.newArr)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-good-400)' }}>Expansion</td>
                  <td className="num">{signedMoney(totals.expansion)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-info-500)' }}>Price uplift</td>
                  <td className="num">{signedMoney(totals.uplift)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-warn-500)' }}>Contraction</td>
                  <td className="num">{signedMoney(totals.contraction)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-alarm-400)' }}>Churn</td>
                  <td className="num">{signedMoney(totals.churn)}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Ending ARR</td>
                  <td className="num">{moneyCompact(period?.endingArrCents ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>

        {/* --- pipeline by stage ------------------------------------------- */}
        <Panel
          title="Pipeline by stage"
          eyebrow="What is likely to close, and why"
          action={
            <Link href="/pipeline" className="btn">
              Board
            </Link>
          }
        >
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th className="num">Deals</th>
                  <th className="num">ARR</th>
                  <th style={{ width: '32%' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {dash.pipeline.byStage.map((row) => {
                  const def = STAGES[row.stage];
                  const share =
                    dash.pipeline.totalOpenArrCents > 0
                      ? (row.arrCents / dash.pipeline.totalOpenArrCents) * 100
                      : 0;
                  return (
                    <tr key={row.stage}>
                      <td>
                        <span style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                          {def.displayNumber}
                        </span>{' '}
                        {def.label}
                      </td>
                      <td className="num">{num(row.count)}</td>
                      <td className="num">{moneyCompact(row.arrCents)}</td>
                      <td>
                        <div
                          style={{
                            height: 8,
                            background: 'var(--bg-inset)',
                            border: '1px solid var(--rule)',
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, share)}%`,
                              height: '100%',
                              background: def.isParked
                                ? 'var(--rule-strong)'
                                : 'var(--color-signal-500)',
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

        {/* --- forecast ---------------------------------------------------- */}
        <Panel
          title={`Forecast — ${quarter}`}
          eyebrow="Categories, judgement and coverage"
          action={
            <Link href="/forecast" className="btn">
              Workbench
            </Link>
          }
        >
          <table className="grid-table">
            <tbody>
              <tr>
                <td>Closed won</td>
                <td className="num">{moneyCompact(dash.forecast.closedWonCents)}</td>
                <td className="num" style={{ color: 'var(--fg-muted)' }}>
                  {pct(dash.forecast.attainmentBps, 0)} of quota
                </td>
              </tr>
              <tr>
                <td>Commit</td>
                <td className="num">{moneyCompact(dash.forecast.commitCents)}</td>
                <td />
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>Call (closed + commit)</td>
                <td className="num">{moneyCompact(dash.forecast.callCents)}</td>
                <td />
              </tr>
              <tr>
                <td>Best case</td>
                <td className="num">{moneyCompact(dash.forecast.bestCaseCents)}</td>
                <td />
              </tr>
              <tr>
                <td>Pipeline</td>
                <td className="num">{moneyCompact(dash.forecast.pipelineCents)}</td>
                <td />
              </tr>
              <tr>
                <td>Stage-weighted</td>
                <td className="num">{moneyCompact(dash.forecast.weightedCents)}</td>
                <td className="num" style={{ color: 'var(--fg-muted)' }}>
                  computed
                </td>
              </tr>
              <tr>
                <td>Gap to quota</td>
                <td className="num">{moneyCompact(dash.forecast.gapToQuotaCents)}</td>
                <td className="num">
                  <Tag
                    value={dash.forecast.coverageBps >= 30_000 ? 'good' : 'high'}
                    label={`${multiple(dash.forecast.coverageBps)} coverage`}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>

        {/* --- pipeline sources ------------------------------------------- */}
        <Panel
          title="Where pipeline comes from"
          eyebrow="Original source attribution"
          action={
            <Link href="/demand" className="btn">
              Attribution
            </Link>
          }
        >
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
                {sources.slice(0, 8).map((row) => (
                  <tr key={row.source}>
                    <td>{row.source.replace(/_/g, ' ')}</td>
                    <td className="num">{num(row.count)}</td>
                    <td className="num">{moneyCompact(row.arrCents)}</td>
                  </tr>
                ))}
                {sources.length === 0 && (
                  <tr>
                    <td colSpan={3}>
                      <Empty>No attributed pipeline yet.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* --- at risk ----------------------------------------------------- */}
        <Panel
          title="Customers at risk"
          eyebrow="Who is at risk, and what is being done"
          action={
            <Link href="/health" className="btn">
              Health
            </Link>
          }
        >
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num">ARR</th>
                  <th className="num">Health</th>
                  <th className="num">Cases</th>
                  <th className="num">Renewal</th>
                  <th>CSM</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map((row) => (
                  <tr key={row.accountId}>
                    <td>
                      <Link href={`/o/accounts/${row.accountId}`}>{row.name}</Link>
                    </td>
                    <td className="num">{moneyCompact(row.currentArrCents)}</td>
                    <td className="num">
                      <Tag value={row.healthBand} label={String(row.healthScore ?? '—')} />
                    </td>
                    <td className="num">{num(row.openCases)}</td>
                    <td className="num">{relativeDays(row.daysToRenewal)}</td>
                    <td>{row.csmName ?? '—'}</td>
                  </tr>
                ))}
                {atRisk.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <Empty>No accounts below the health threshold.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* --- whitespace -------------------------------------------------- */}
        <Panel title="Expansion whitespace" eyebrow="Where the strongest expansion is">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num">Current ARR</th>
                  <th className="num">Whitespace</th>
                  <th className="num">Penetration</th>
                  <th>Not yet sold</th>
                </tr>
              </thead>
              <tbody>
                {whitespace.map((row) => (
                  <tr key={row.accountId}>
                    <td>
                      <Link href={`/o/accounts/${row.accountId}`}>{row.name}</Link>
                    </td>
                    <td className="num">{moneyCompact(row.currentArrCents)}</td>
                    <td className="num" style={{ color: 'var(--color-signal-500)', fontWeight: 700 }}>
                      {moneyCompact(row.whitespaceArrCents)}
                    </td>
                    <td className="num">{pct(row.penetrationBps, 0)}</td>
                    <td style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)' }}>
                      {row.missingFamilies.slice(0, 3).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
                {whitespace.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <Empty>Full product penetration across the customer base.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* --- operational counters ------------------------------------------ */}
      <div style={{ height: '0.75rem' }} />
      <Grid cols={6}>
        <StatTile
          label="Open service tickets"
          value={num(dash.counts.openCases)}
          sub={`${num(dash.counts.escalatedCases)} escalated`}
          tone={dash.counts.escalatedCases > 0 ? 'alarm' : 'neutral'}
          href="/service"
        />
        <StatTile
          label="Open risks"
          value={num(dash.counts.openRisks)}
          sub="tracked with mitigation plans"
          tone={dash.counts.openRisks > 0 ? 'warn' : 'good'}
          href="/o/risks"
        />
        <StatTile
          label="SLA attainment"
          value={pct(dash.sla.attainmentBps, 0)}
          sub={`${num(dash.sla.met)} met · ${num(dash.sla.breached)} breached`}
          tone={dash.sla.attainmentBps >= 9000 ? 'good' : 'warn'}
        />
        <StatTile
          label="Unassigned leads"
          value={num(dash.counts.unassignedLeads)}
          sub="awaiting routing"
          tone={dash.counts.unassignedLeads > 0 ? 'warn' : 'good'}
          href="/o/leads"
        />
        <StatTile
          label="Renewal commit"
          value={moneyCompact(dash.renewals.committedArrCents)}
          sub={`${num(dash.renewals.count)} renewals in window`}
          tone="good"
          href="/renewals"
        />
        <StatTile
          label="Renewal rate"
          value={pct(dash.retention.renewalRateBps, 0)}
          sub="of renewable ARR"
          tone={dash.retention.renewalRateBps >= 9000 ? 'good' : 'warn'}
        />
      </Grid>
    </>
  );
}
