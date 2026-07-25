import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import { accounts, healthScores, risks, successPlans, usageMetrics, users } from '@/db/schema';
import { adoptionSummary, atRiskAccounts, healthDistribution } from '@/server/services/analytics';
import { HEALTH_DIMENSIONS } from '@/domain/health';
import { Empty, Grid, Meter, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { date, humanise, moneyCompact, num, pct, truncate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The health cockpit.
 *
 * Health is shown with its dimensions, its confidence and the reason it moved.
 * A single number would be shorter and considerably less useful — nobody can act
 * on "72" without knowing which lever is stuck.
 */
export default async function HealthPage() {
  await requireUser();
  const db = await getDb();

  const [distribution, adoption, atRisk] = await Promise.all([
    healthDistribution(),
    adoptionSummary(),
    atRiskAccounts(25),
  ]);

  const latest = await db
    .select({
      score: healthScores,
      accountName: accounts.name,
      accountArr: accounts.currentArrCents,
      tier: accounts.tier,
      csmName: users.name,
    })
    .from(healthScores)
    .innerJoin(accounts, eq(healthScores.accountId, accounts.id))
    .leftJoin(users, eq(accounts.csmId, users.id))
    .orderBy(desc(healthScores.asOfDate), desc(healthScores.overall))
    .limit(120);

  // One row per account — the most recent as-of date.
  const seen = new Set<string>();
  const scores = latest.filter((r) => {
    if (seen.has(r.score.accountId)) return false;
    seen.add(r.score.accountId);
    return true;
  });

  const openRisks = await db
    .select({ risk: risks, accountName: accounts.name, ownerName: users.name })
    .from(risks)
    .innerJoin(accounts, eq(risks.accountId, accounts.id))
    .leftJoin(users, eq(risks.ownerId, users.id))
    .where(eq(risks.status, 'open'))
    .orderBy(desc(risks.arrAtRiskCents))
    .limit(20);

  const plans = await db
    .select({ plan: successPlans, accountName: accounts.name })
    .from(successPlans)
    .innerJoin(accounts, eq(successPlans.accountId, accounts.id))
    .orderBy(desc(successPlans.renewalReadinessBps))
    .limit(15);

  const totalArr = distribution.reduce((s, d) => s + d.arrCents, 0);
  const unhealthyArr = distribution
    .filter((d) => ['poor', 'critical'].includes(d.band))
    .reduce((s, d) => s + d.arrCents, 0);
  const lowConfidence = scores.filter((s) => s.score.confidenceBps < 5000).length;

  return (
    <>
      <PageHeader
        title="Customer Health"
        subtitle="Multidimensional, explainable and confidence-aware. Missing inputs lower confidence rather than the score, because an unmeasured account is not the same thing as an unhealthy one."
      />

      <Grid cols={5}>
        <StatTile label="Customer ARR scored" value={moneyCompact(totalArr)} sub={`${num(scores.length)} accounts`} tone="signal" />
        <StatTile
          label="ARR in poor or critical"
          value={moneyCompact(unhealthyArr)}
          sub={totalArr > 0 ? `${pct(Math.round((unhealthyArr / totalArr) * 10_000), 0)} of base` : '—'}
          tone={unhealthyArr > 0 ? 'alarm' : 'good'}
        />
        <StatTile
          label="Licence utilisation"
          value={pct(adoption.utilisationBps, 0)}
          sub={`${num(adoption.activeUsers)} of ${num(adoption.licensedUsers)} seats active`}
          tone={adoption.utilisationBps >= 7000 ? 'good' : 'warn'}
        />
        <StatTile
          label="Shelfware accounts"
          value={num(adoption.accountsBelowHalfUtilisation)}
          sub="under 50% utilisation"
          tone={adoption.accountsBelowHalfUtilisation > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label="Low-confidence scores"
          value={num(lowConfidence)}
          sub="need better telemetry before acting"
          tone={lowConfidence > 0 ? 'warn' : 'good'}
        />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '0.75rem' }}>
        <Panel title="Health distribution" eyebrow="Accounts and ARR by band">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Band</th>
                <th className="num">Accounts</th>
                <th className="num">ARR</th>
                <th style={{ width: '35%' }}>Share of ARR</th>
              </tr>
            </thead>
            <tbody>
              {distribution.map((d) => {
                const share = totalArr > 0 ? (d.arrCents / totalArr) * 100 : 0;
                const colour =
                  d.band === 'excellent' || d.band === 'good'
                    ? 'var(--color-good-500)'
                    : d.band === 'fair'
                      ? 'var(--color-signal-500)'
                      : d.band === 'poor'
                        ? 'var(--color-warn-500)'
                        : d.band === 'critical'
                          ? 'var(--color-alarm-500)'
                          : 'var(--rule-strong)';
                return (
                  <tr key={d.band}>
                    <td>
                      <Tag value={d.band} label={humanise(d.band)} />
                    </td>
                    <td className="num">{num(d.count)}</td>
                    <td className="num">{moneyCompact(d.arrCents)}</td>
                    <td>
                      <div style={{ height: 8, background: 'var(--bg-inset)', border: '1px solid var(--rule)' }}>
                        <div style={{ width: `${share}%`, height: '100%', background: colour }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <Panel title="Open risks" eyebrow="With ARR exposure and an owner">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Risk</th>
                  <th>Severity</th>
                  <th className="num">ARR at risk</th>
                  <th>Owner</th>
                  <th>Detected by</th>
                </tr>
              </thead>
              <tbody>
                {openRisks.map((r) => (
                  <tr key={r.risk.id}>
                    <td>
                      <Link href={`/o/accounts/${r.risk.accountId}`}>{r.accountName}</Link>
                    </td>
                    <td title={r.risk.description ?? undefined}>{truncate(r.risk.title, 42)}</td>
                    <td>
                      <Tag value={r.risk.severity} />
                    </td>
                    <td className="num">{moneyCompact(r.risk.arrAtRiskCents)}</td>
                    <td style={{ fontSize: '0.6875rem' }}>{r.ownerName ?? '—'}</td>
                    <td style={{ fontSize: '0.625rem', color: 'var(--fg-muted)' }}>
                      {humanise(r.risk.detectedBy)}
                    </td>
                  </tr>
                ))}
                {openRisks.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <Empty>No open risks.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div style={{ height: '0.75rem' }} />

      <Panel title="Account health detail" eyebrow="Dimensions, confidence and the reason it moved">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">ARR</th>
                <th className="num">Score</th>
                <th className="num">Change</th>
                <th className="num">Confidence</th>
                {HEALTH_DIMENSIONS.map((d) => (
                  <th key={d} className="num" title={humanise(d)}>
                    {d.slice(0, 4)}
                  </th>
                ))}
                <th>Recommended action</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((row) => {
                const dims = (row.score.dimensions ?? {}) as Record<string, number | null>;
                return (
                  <tr key={row.score.id}>
                    <td>
                      <Link href={`/o/accounts/${row.score.accountId}`}>{row.accountName}</Link>
                      <div style={{ fontSize: '0.5625rem', color: 'var(--fg-muted)' }}>
                        {humanise(row.tier)} · {row.csmName ?? 'no CSM'} · {date(row.score.asOfDate)}
                      </div>
                    </td>
                    <td className="num">{moneyCompact(row.accountArr)}</td>
                    <td className="num">
                      <Tag value={row.score.band} label={String(row.score.overall)} />
                    </td>
                    <td
                      className="num"
                      style={{
                        color:
                          row.score.delta > 0
                            ? 'var(--color-good-400)'
                            : row.score.delta < 0
                              ? 'var(--color-alarm-400)'
                              : 'var(--fg-muted)',
                      }}
                    >
                      {row.score.delta === 0 ? '—' : row.score.delta > 0 ? `+${row.score.delta}` : row.score.delta}
                    </td>
                    <td className="num" style={{ width: 70 }}>
                      <Meter
                        valueBps={row.score.confidenceBps}
                        tone={row.score.confidenceBps >= 7000 ? 'good' : row.score.confidenceBps >= 4000 ? 'warn' : 'alarm'}
                      />
                    </td>
                    {HEALTH_DIMENSIONS.map((d) => {
                      const v = dims[d];
                      return (
                        <td
                          key={d}
                          className="num"
                          style={{
                            color:
                              v === null || v === undefined
                                ? 'var(--fg-muted)'
                                : v >= 70
                                  ? 'var(--color-good-400)'
                                  : v >= 50
                                    ? 'var(--fg)'
                                    : 'var(--color-alarm-400)',
                          }}
                          title={humanise(d)}
                        >
                          {v === null || v === undefined ? '·' : v}
                        </td>
                      );
                    })}
                    <td style={{ fontSize: '0.6875rem', maxWidth: 320 }}>
                      {truncate(row.score.recommendedAction, 110)}
                    </td>
                  </tr>
                );
              })}
              {scores.length === 0 && (
                <tr>
                  <td colSpan={6 + HEALTH_DIMENSIONS.length}>
                    <Empty>No health scores yet. Run the health job.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ height: '0.75rem' }} />

      <Panel title="Success plans" eyebrow="Time to value, onboarding progress and renewal readiness">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Lifecycle</th>
                <th className="num">Onboarding</th>
                <th className="num">Time to value</th>
                <th className="num">Renewal readiness</th>
                <th>Sentiment</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.plan.id}>
                  <td>
                    <Link href={`/o/success_plans/${p.plan.id}`}>{p.accountName}</Link>
                  </td>
                  <td>
                    <Tag value={p.plan.lifecycleStage} />
                  </td>
                  <td className="num" style={{ width: 90 }}>
                    <Meter valueBps={p.plan.onboardingProgressBps} />
                  </td>
                  <td className="num">{p.plan.timeToValueDays ? `${p.plan.timeToValueDays}d` : '—'}</td>
                  <td className="num" style={{ width: 90 }}>
                    <Meter
                      valueBps={p.plan.renewalReadinessBps ?? 0}
                      tone={(p.plan.renewalReadinessBps ?? 0) >= 7000 ? 'good' : 'warn'}
                    />
                  </td>
                  <td>
                    <Tag value={p.plan.sentiment} />
                  </td>
                  <td>
                    <Tag value={p.plan.referenceStatus} label={humanise(p.plan.referenceStatus)} />
                  </td>
                </tr>
              ))}
              {plans.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <Empty>No success plans yet.</Empty>
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
