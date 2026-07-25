import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import { accounts, aiInsights, usageSignals } from '@/db/schema';
import { Empty, Grid, Meter, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { dateTime, humanise, num, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The AI layer.
 *
 * Everything here is a recommendation carrying its own evidence and a confidence
 * figure. Nothing has been applied to a record: material changes to pricing,
 * forecast, risk or ownership stay human decisions with an audit row behind them.
 * The system proposes, a person disposes.
 */
export default async function InsightsPage() {
  await requireUser();
  const db = await getDb();

  const insights = await db
    .select({ insight: aiInsights, accountName: accounts.name })
    .from(aiInsights)
    .leftJoin(accounts, eq(aiInsights.accountId, accounts.id))
    .orderBy(desc(aiInsights.severity), desc(aiInsights.confidenceBps))
    .limit(80);

  const signals = await db
    .select({ signal: usageSignals, accountName: accounts.name })
    .from(usageSignals)
    .innerJoin(accounts, eq(usageSignals.accountId, accounts.id))
    .where(eq(usageSignals.status, 'open'))
    .orderBy(desc(usageSignals.strength))
    .limit(30);

  const byKind = new Map<string, typeof insights>();
  for (const i of insights) {
    const list = byKind.get(i.insight.kind) ?? [];
    list.push(i);
    byKind.set(i.insight.kind, list);
  }

  const expansion = signals.filter((s) => s.signal.type === 'expansion_signal');
  const churn = signals.filter((s) => s.signal.type === 'churn_risk');
  const urgent = insights.filter((i) => i.insight.severity === 'urgent' || i.insight.severity === 'high');

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle="Deterministic, explainable signals derived from usage, engagement and process data. Each one carries the evidence that produced it, so a recommendation can be judged rather than trusted."
      />

      <Grid cols={5}>
        <StatTile label="Open insights" value={num(insights.length)} tone="signal" />
        <StatTile label="High or urgent" value={num(urgent.length)} sub="need attention now" tone={urgent.length > 0 ? 'alarm' : 'good'} />
        <StatTile label="Expansion signals" value={num(expansion.length)} sub="at or near licence ceiling" tone="good" />
        <StatTile label="Churn signals" value={num(churn.length)} sub="shelfware or inactivity" tone={churn.length > 0 ? 'warn' : 'good'} />
        <StatTile label="Applied automatically" value="0" sub="by design — all require a human" tone="good" />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {[...byKind.entries()].map(([kind, list]) => (
          <Panel key={kind} title={humanise(kind)} eyebrow={`${num(list.length)} insights`}>
            {list.slice(0, 12).map(({ insight, accountName }) => (
              <div
                key={insight.id}
                style={{ padding: '0.75rem 0.875rem', borderBottom: '1px solid var(--rule)' }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 300 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <Tag value={insight.severity} label={humanise(insight.severity)} />
                      {accountName && (
                        <Link
                          href={`/o/accounts/${insight.accountId}`}
                          style={{ fontSize: '0.75rem', fontWeight: 700 }}
                        >
                          {accountName}
                        </Link>
                      )}
                      <span style={{ fontSize: '0.5625rem', color: 'var(--fg-muted)' }}>
                        {dateTime(insight.generatedAt)} · {insight.model}
                      </span>
                    </div>

                    <div style={{ marginTop: '0.375rem', fontSize: '0.8125rem', fontWeight: 700 }}>
                      {insight.title}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.25rem' }}>
                      {insight.detail}
                    </p>

                    {Array.isArray(insight.evidence) && insight.evidence.length > 0 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <div className="eyebrow">Evidence</div>
                        <ul
                          style={{
                            listStyle: 'none',
                            fontSize: '0.6875rem',
                            color: 'var(--fg-muted)',
                            marginTop: '0.125rem',
                          }}
                        >
                          {(insight.evidence as string[]).slice(0, 5).map((e, i) => (
                            <li key={i} style={{ paddingLeft: '0.75rem', position: 'relative' }}>
                              <span
                                style={{
                                  position: 'absolute',
                                  left: 0,
                                  color: 'var(--color-signal-500)',
                                }}
                              >
                                ·
                              </span>
                              {String(e)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {insight.recommendedAction && (
                      <p
                        style={{
                          marginTop: '0.5rem',
                          fontSize: '0.75rem',
                          borderLeft: '2px solid var(--color-signal-500)',
                          paddingLeft: '0.5rem',
                        }}
                      >
                        <strong>Recommended:</strong> {insight.recommendedAction}
                      </p>
                    )}
                  </div>

                  <div style={{ width: 130 }}>
                    <div className="eyebrow">Confidence</div>
                    <Meter
                      valueBps={insight.confidenceBps}
                      tone={insight.confidenceBps >= 7500 ? 'good' : insight.confidenceBps >= 5000 ? 'warn' : 'alarm'}
                      label={pct(insight.confidenceBps, 0)}
                    />
                    <div style={{ marginTop: '0.5rem' }}>
                      <Link href={`/o/${insight.objectType}/${insight.recordId}`} className="btn">
                        Open record
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        ))}

        {insights.length === 0 && (
          <Panel title="Insights">
            <Empty>No insights generated yet. Run the signal detection job.</Empty>
          </Panel>
        )}

        <Panel title="Open product-usage signals" eyebrow="Telemetry turned into commercial signals">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Signal</th>
                  <th className="num">Strength</th>
                  <th>Detail</th>
                  <th className="num">Detected</th>
                </tr>
              </thead>
              <tbody>
                {signals.map(({ signal, accountName }) => (
                  <tr key={signal.id}>
                    <td>
                      <Link href={`/o/accounts/${signal.accountId}`}>{accountName}</Link>
                    </td>
                    <td>
                      <Tag
                        value={
                          signal.type === 'expansion_signal' || signal.type === 'product_qualified_lead'
                            ? 'good'
                            : signal.type === 'churn_risk'
                              ? 'critical'
                              : 'medium'
                        }
                        label={humanise(signal.type)}
                      />
                    </td>
                    <td className="num">{signal.strength}</td>
                    <td style={{ fontSize: '0.6875rem' }}>{signal.detail}</td>
                    <td className="num" style={{ fontSize: '0.6875rem' }}>
                      {dateTime(signal.detectedAt)}
                    </td>
                  </tr>
                ))}
                {signals.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <Empty>No open usage signals.</Empty>
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
