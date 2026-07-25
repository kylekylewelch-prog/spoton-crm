import Link from 'next/link';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import {
  accounts,
  forecastSnapshots,
  forecasts,
  opportunities,
  pipelineSnapshots,
  users,
} from '@/db/schema';
import { forecastForPeriod } from '@/server/services/analytics';
import { diffSnapshots, isAtRiskOfSlipping, scoreAccuracy, type SnapshotDeal } from '@/domain/forecast';
import { addDays, fiscalQuarter, quarterBounds, today } from '@/domain/dates';
import { STAGES, type StageKey } from '@/domain/stages';
import { Empty, Grid, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { date, moneyCompact, multiple, num, pct, signedMoney } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The forecast workbench.
 *
 * Shows the computed roll-up and the submitted judgement side by side, plus what has
 * moved since the last submission. Preserving both is what makes bias and accuracy
 * measurable rather than anecdotal.
 */
export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  await requireUser();
  const db = await getDb();

  const quarter = query.period ?? fiscalQuarter(today());
  const { start, end } = quarterBounds(quarter);

  const rollup = await forecastForPeriod(quarter);

  const submissions = await db
    .select({ forecast: forecasts, ownerName: users.name })
    .from(forecasts)
    .leftJoin(users, eq(forecasts.ownerId, users.id))
    .where(eq(forecasts.fiscalPeriod, quarter))
    .orderBy(desc(forecasts.submittedCents));

  const periods = await db
    .selectDistinct({ period: forecasts.fiscalPeriod })
    .from(forecasts)
    .orderBy(asc(forecasts.fiscalPeriod));

  // Movement since the snapshot three weeks ago.
  const priorDate = addDays(today(), -21);
  const [priorRows, currentRows] = await Promise.all([
    db.select().from(pipelineSnapshots).where(eq(pipelineSnapshots.asOfDate, priorDate)),
    db.select().from(pipelineSnapshots).where(eq(pipelineSnapshots.asOfDate, today())),
  ]);

  const toSnapshot = (r: typeof priorRows[number]): SnapshotDeal => ({
    opportunityId: r.opportunityId,
    stage: r.stage as StageKey,
    forecastCategory: r.forecastCategory,
    amountCents: r.amountCents,
    arrCents: r.arrCents,
    closeDate: r.closeDate,
    isClosed: r.isClosed,
    isWon: r.isWon,
  });

  const movement =
    priorRows.length > 0 && currentRows.length > 0
      ? diffSnapshots(priorRows.map(toSnapshot), currentRows.map(toSnapshot), quarter)
      : null;

  // Commit deals carrying execution risk.
  const commitDeals = await db
    .select({ opp: opportunities, accountName: accounts.name, ownerName: users.name })
    .from(opportunities)
    .innerJoin(accounts, eq(opportunities.accountId, accounts.id))
    .leftJoin(users, eq(opportunities.ownerId, users.id))
    .where(
      and(
        eq(opportunities.isClosed, false),
        inArray(opportunities.forecastCategory, ['commit', 'best_case']),
        gte(opportunities.closeDate, start),
        lte(opportunities.closeDate, end),
      ),
    )
    .orderBy(desc(opportunities.arrCents));

  const atRiskCommit = commitDeals
    .map((d) => ({
      ...d,
      risk: isAtRiskOfSlipping(
        {
          stage: d.opp.stage as StageKey,
          closeDate: d.opp.closeDate,
          nextMeetingAt: d.opp.nextMeetingAt,
          daysInStage: d.opp.stageEnteredAt
            ? Math.round((Date.now() - d.opp.stageEnteredAt.getTime()) / 86_400_000)
            : 0,
        },
        today(),
      ),
    }))
    .filter((d) => d.risk.atRisk);

  const atRiskValue = atRiskCommit.reduce((s, d) => s + d.opp.arrCents, 0);

  // Submission history, for accuracy.
  const history = await db
    .select()
    .from(forecastSnapshots)
    .where(eq(forecastSnapshots.fiscalPeriod, quarter))
    .orderBy(asc(forecastSnapshots.asOfDate));

  const accuracy = scoreAccuracy(
    quarter,
    submissions.reduce((s, f) => s + f.forecast.submittedCents, 0),
    rollup.closedWonCents,
  );

  return (
    <>
      <PageHeader
        title="Forecast"
        subtitle="Category roll-up, stage-weighted computation and human judgement, kept apart on purpose. Submissions are snapshotted so bias and accuracy can be measured after the fact."
        action={
          <form style={{ display: 'flex', gap: '0.375rem' }}>
            <select className="field" name="period" defaultValue={quarter} style={{ width: 130 }}>
              {periods.map((p) => (
                <option key={p.period} value={p.period}>
                  {p.period}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              View
            </button>
          </form>
        }
      />

      <Grid cols={6}>
        <StatTile label="Closed won" value={moneyCompact(rollup.closedWonCents)} sub={`${pct(rollup.attainmentBps, 0)} of quota`} tone="good" />
        <StatTile label="Commit" value={moneyCompact(rollup.commitCents)} tone="signal" />
        <StatTile label="Call" value={moneyCompact(rollup.callCents)} sub="closed + commit" tone="signal" />
        <StatTile label="Best case total" value={moneyCompact(rollup.bestCaseTotalCents)} />
        <StatTile label="Stage-weighted" value={moneyCompact(rollup.weightedCents)} sub="computed, not judged" />
        <StatTile
          label="Coverage"
          value={multiple(rollup.coverageBps)}
          sub={`gap ${moneyCompact(rollup.gapToQuotaCents)}`}
          tone={rollup.coverageBps >= 30_000 ? 'good' : 'warn'}
        />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '0.75rem' }}>
        <Panel title="Submissions by rep" eyebrow="Judgement versus computed roll-up">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Owner</th>
                  <th className="num">Quota</th>
                  <th className="num">Closed</th>
                  <th className="num">Commit</th>
                  <th className="num">Submitted</th>
                  <th className="num">Attainment</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => {
                  const attain =
                    s.forecast.quotaCents > 0
                      ? Math.round((s.forecast.closedWonCents / s.forecast.quotaCents) * 10_000)
                      : 0;
                  return (
                    <tr key={s.forecast.id}>
                      <td>{s.ownerName ?? '—'}</td>
                      <td className="num">{moneyCompact(s.forecast.quotaCents)}</td>
                      <td className="num">{moneyCompact(s.forecast.closedWonCents)}</td>
                      <td className="num">{moneyCompact(s.forecast.commitCents)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {moneyCompact(s.forecast.submittedCents)}
                      </td>
                      <td className="num" style={{ color: attain >= 10_000 ? 'var(--color-good-400)' : undefined }}>
                        {pct(attain, 0)}
                      </td>
                      <td>
                        {s.forecast.isSubmitted ? (
                          <span className="tag tag-good">Submitted</span>
                        ) : (
                          <span className="tag tag-warn">Draft</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {submissions.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <Empty>No submissions for {quarter}.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Forecast accuracy" eyebrow="Graded against the outcome">
          <table className="grid-table">
            <tbody>
              <tr>
                <td>Submitted</td>
                <td className="num">{moneyCompact(accuracy.submittedCents)}</td>
              </tr>
              <tr>
                <td>Actual closed won</td>
                <td className="num">{moneyCompact(accuracy.actualCents)}</td>
              </tr>
              <tr>
                <td>Variance</td>
                <td className="num">{signedMoney(accuracy.varianceCents)}</td>
              </tr>
              <tr>
                <td>Bias</td>
                <td className="num">{pct(accuracy.biasBps, 1)}</td>
              </tr>
              <tr>
                <td>Verdict</td>
                <td className="num">
                  <Tag
                    value={accuracy.verdict === 'accurate' ? 'good' : 'high'}
                    label={accuracy.verdict.replace(/_/g, ' ')}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ padding: '0.875rem', borderTop: '1px solid var(--rule)' }}>
            <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
              Submission history
            </div>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>As of</th>
                  <th className="num">Submitted</th>
                  <th className="num">Commit</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 8).map((h) => (
                  <tr key={h.id}>
                    <td>{date(h.asOfDate)}</td>
                    <td className="num">{moneyCompact(h.submittedCents)}</td>
                    <td className="num">{moneyCompact(h.commitCents)}</td>
                    <td className="num">{signedMoney(h.changeSincePriorCents)}</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <Empty>No snapshots for this period.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '0.75rem' }}>
        <Panel
          title="Commit deals carrying risk"
          eyebrow={`${num(atRiskCommit.length)} deals · ${moneyCompact(atRiskValue)}`}
        >
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Stage</th>
                  <th className="num">ARR</th>
                  <th className="num">Close</th>
                  <th>Why it is at risk</th>
                </tr>
              </thead>
              <tbody>
                {atRiskCommit.slice(0, 12).map((d) => (
                  <tr key={d.opp.id}>
                    <td>
                      <Link href={`/o/opportunities/${d.opp.id}`}>{d.accountName}</Link>
                      <div style={{ fontSize: '0.5625rem', color: 'var(--fg-muted)' }}>
                        {d.ownerName ?? '—'}
                      </div>
                    </td>
                    <td>
                      <Tag value={d.opp.stage} label={STAGES[d.opp.stage as StageKey].label} />
                    </td>
                    <td className="num">{moneyCompact(d.opp.arrCents)}</td>
                    <td className="num">{date(d.opp.closeDate)}</td>
                    <td style={{ fontSize: '0.625rem', color: 'var(--fg-muted)' }}>
                      {d.risk.reasons.join('; ')}
                    </td>
                  </tr>
                ))}
                {atRiskCommit.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <Empty>No risk signals on commit or best-case deals.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Movement since three weeks ago" eyebrow="Derived from pipeline snapshots">
          {movement ? (
            <table className="grid-table">
              <tbody>
                <tr>
                  <td>Created in period</td>
                  <td className="num">{num(movement.created.length)}</td>
                </tr>
                <tr>
                  <td>Advanced a stage</td>
                  <td className="num" style={{ color: 'var(--color-good-400)' }}>
                    {num(movement.advanced.length)}
                  </td>
                </tr>
                <tr>
                  <td>Regressed</td>
                  <td className="num" style={{ color: 'var(--color-warn-500)' }}>
                    {num(movement.regressed.length)}
                  </td>
                </tr>
                <tr>
                  <td>Slipped out of period</td>
                  <td className="num" style={{ color: 'var(--color-alarm-400)' }}>
                    {num(movement.slipped.length)}
                  </td>
                </tr>
                <tr>
                  <td>Pulled in</td>
                  <td className="num">{num(movement.pulledIn.length)}</td>
                </tr>
                <tr>
                  <td>Won</td>
                  <td className="num" style={{ color: 'var(--color-good-400)' }}>
                    {num(movement.won.length)}
                  </td>
                </tr>
                <tr>
                  <td>Lost</td>
                  <td className="num" style={{ color: 'var(--color-alarm-400)' }}>
                    {num(movement.lost.length)}
                  </td>
                </tr>
                <tr>
                  <td>Value increased</td>
                  <td className="num">{num(movement.increased.length)}</td>
                </tr>
                <tr>
                  <td>Value decreased</td>
                  <td className="num">{num(movement.decreased.length)}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Net change in period ARR</td>
                  <td className="num">{signedMoney(movement.netChangeArrCents)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <Empty>
              Not enough snapshot history yet. The nightly job records one snapshot per day.
            </Empty>
          )}
        </Panel>
      </div>
    </>
  );
}
