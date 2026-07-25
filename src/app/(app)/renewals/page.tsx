import Link from 'next/link';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import { accounts, renewals, subscriptions, users } from '@/db/schema';
import { renewalBook } from '@/server/services/analytics';
import { renewalUrgency } from '@/domain/renewals';
import { today } from '@/domain/dates';
import { Empty, Grid, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { date, moneyCompact, num, pct, relativeDays, signedMoney } from '@/lib/format';

export const dynamic = 'force-dynamic';

const BUCKET_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  notice_window: 'In notice window',
  this_quarter: 'Next 90 days',
  next_quarter: '90 to 180 days',
  future: 'Beyond 180 days',
};

/**
 * The renewal desk.
 *
 * Renewals are grouped by proximity to the *notice* date rather than the renewal
 * date, because the notice deadline is the real commercial cliff — once it passes on
 * an auto-renewing contract the customer has effectively renewed, and before it
 * passes there is still work to do.
 */
export default async function RenewalsPage() {
  await requireUser();
  const db = await getDb();
  const book = await renewalBook(400);

  const rows = await db
    .select({
      renewal: renewals,
      accountName: accounts.name,
      accountTier: accounts.tier,
      healthScore: accounts.healthScore,
      healthBand: accounts.healthBand,
      ownerName: users.name,
      subscriptionNumber: subscriptions.number,
      autoRenew: subscriptions.autoRenew,
      subEnd: subscriptions.endDate,
      noticeDays: subscriptions.noticeDays,
    })
    .from(renewals)
    .innerJoin(accounts, eq(renewals.accountId, accounts.id))
    .innerJoin(subscriptions, eq(renewals.subscriptionId, subscriptions.id))
    .leftJoin(users, eq(renewals.ownerId, users.id))
    .where(inArray(renewals.status, ['not_started', 'in_progress', 'quoted', 'committed']))
    .orderBy(asc(renewals.renewalDate));

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const urgency = renewalUrgency(
      {
        renewalDate: row.renewal.renewalDate,
        noticeDate: row.renewal.noticeDate,
        autoRenew: row.renewal.autoRenew,
      },
      today(),
    );
    const list = grouped.get(urgency.bucket) ?? [];
    list.push(row);
    grouped.set(urgency.bucket, list);
  }

  const coTermed = rows.filter((r) => r.renewal.coTermedAdditionsArrCents > 0);
  const coTermedTotal = coTermed.reduce((s, r) => s + r.renewal.coTermedAdditionsArrCents, 0);

  return (
    <>
      <PageHeader
        title="Renewal Desk"
        subtitle="Every renewal is created the moment its originating deal is won, so nothing depends on someone remembering to run a report. Renewable ARR includes the annualised value of mid-term additions that were co-termed onto the subscription."
      />

      <Grid cols={5}>
        <StatTile label="Renewable ARR" value={moneyCompact(book.totals.renewableArrCents)} sub={`${num(book.totals.count)} renewals`} tone="signal" />
        <StatTile label="Expected ARR" value={moneyCompact(book.totals.expectedArrCents)} sub="after uplift and known changes" tone="good" />
        <StatTile label="Committed" value={moneyCompact(book.totals.committedArrCents)} sub="notice passed or quoted" tone="good" />
        <StatTile label="ARR at risk" value={moneyCompact(book.totals.atRiskArrCents)} sub="high and critical risk" tone={book.totals.atRiskArrCents > 0 ? 'alarm' : 'good'} />
        <StatTile
          label="Co-termed additions"
          value={moneyCompact(coTermedTotal)}
          sub={`${num(coTermed.length)} renewals carry mid-term expansion`}
          tone="signal"
        />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      {/* --- co-term rollup evidence -------------------------------------- */}
      {coTermed.length > 0 && (
        <>
          <Panel
            title="Mid-term expansion carried into renewal"
            eyebrow="Co-termination working as intended"
          >
            <p style={{ padding: '0.75rem 0.875rem 0', fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
              These renewals were increased automatically when an upsell or cross-sell was co-termed
              onto the active subscription. The addition was billed pro rata for the remainder of the
              term, and its full annual value was added to the renewable base below — which is what
              stops a part-year expansion from quietly disappearing at renewal.
            </p>
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Subscription</th>
                    <th className="num">Current ARR</th>
                    <th className="num">Co-termed additions</th>
                    <th className="num">Renewable ARR</th>
                    <th className="num">Uplift</th>
                    <th className="num">Expected ARR</th>
                    <th className="num">Renewal date</th>
                  </tr>
                </thead>
                <tbody>
                  {coTermed.map((r) => (
                    <tr key={r.renewal.id}>
                      <td>
                        <Link href={`/o/accounts/${r.renewal.accountId}`}>{r.accountName}</Link>
                      </td>
                      <td>
                        <Link href={`/o/subscriptions/${r.renewal.subscriptionId}`}>
                          <code style={{ fontSize: '0.6875rem' }}>{r.subscriptionNumber}</code>
                        </Link>
                      </td>
                      <td className="num">{moneyCompact(r.renewal.currentArrCents)}</td>
                      <td className="num" style={{ color: 'var(--color-signal-500)', fontWeight: 700 }}>
                        {signedMoney(r.renewal.coTermedAdditionsArrCents)}
                      </td>
                      <td className="num">{moneyCompact(r.renewal.renewableArrCents)}</td>
                      <td className="num">{pct(r.renewal.upliftBps, 1)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {moneyCompact(r.renewal.expectedArrCents)}
                      </td>
                      <td className="num">{date(r.renewal.renewalDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <div style={{ height: '0.75rem' }} />
        </>
      )}

      {/* --- the book by urgency ------------------------------------------ */}
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {['overdue', 'notice_window', 'this_quarter', 'next_quarter', 'future'].map((bucket) => {
          const list = grouped.get(bucket) ?? [];
          if (list.length === 0) return null;
          const bucketArr = list.reduce((s, r) => s + r.renewal.renewableArrCents, 0);

          return (
            <Panel
              key={bucket}
              title={BUCKET_LABELS[bucket]}
              eyebrow={`${num(list.length)} renewals · ${moneyCompact(bucketArr)} renewable`}
            >
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th className="num">Renewable ARR</th>
                      <th className="num">Expected</th>
                      <th className="num">Downside</th>
                      <th>Risk</th>
                      <th>Forecast</th>
                      <th className="num">Likelihood</th>
                      <th className="num">Health</th>
                      <th className="num">Notice</th>
                      <th className="num">Renewal</th>
                      <th>Auto</th>
                      <th>Owner</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const urgency = renewalUrgency(
                        {
                          renewalDate: r.renewal.renewalDate,
                          noticeDate: r.renewal.noticeDate,
                          autoRenew: r.renewal.autoRenew,
                        },
                        today(),
                      );
                      return (
                        <tr key={r.renewal.id}>
                          <td>
                            <Link href={`/o/accounts/${r.renewal.accountId}`}>{r.accountName}</Link>
                            <div style={{ fontSize: '0.5625rem', color: 'var(--fg-muted)' }}>
                              {r.accountTier.replace(/_/g, ' ')}
                            </div>
                          </td>
                          <td className="num">{moneyCompact(r.renewal.renewableArrCents)}</td>
                          <td className="num" style={{ fontWeight: 700 }}>
                            {moneyCompact(r.renewal.expectedArrCents)}
                          </td>
                          <td className="num" style={{ color: 'var(--fg-muted)' }}>
                            {moneyCompact(r.renewal.downsideArrCents)}
                          </td>
                          <td>
                            <Tag value={r.renewal.riskLevel} />
                          </td>
                          <td>
                            <Tag value={r.renewal.forecastCategory} />
                          </td>
                          <td className="num">{pct(r.renewal.renewalLikelihoodBps, 0)}</td>
                          <td className="num">
                            <Tag value={r.healthBand} label={String(r.healthScore ?? '—')} />
                          </td>
                          <td className="num">
                            {r.renewal.noticeDate ? (
                              urgency.noticePassed ? (
                                <span className="tag tag-good" title="Notice window has closed">
                                  passed
                                </span>
                              ) : (
                                relativeDays(urgency.daysToNotice)
                              )
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="num">{date(r.renewal.renewalDate)}</td>
                          <td>{r.renewal.autoRenew ? <span className="tag tag-good">Yes</span> : <span className="tag tag-warn">No</span>}</td>
                          <td style={{ fontSize: '0.6875rem' }}>{r.ownerName ?? '—'}</td>
                          <td className="num">
                            <Link className="btn" href={`/o/renewals/${r.renewal.id}`}>
                              Open
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          );
        })}

        {rows.length === 0 && (
          <Panel title="Renewal book">
            <Empty>No open renewals. Win a deal and its renewal is created automatically.</Empty>
          </Panel>
        )}
      </div>
    </>
  );
}
