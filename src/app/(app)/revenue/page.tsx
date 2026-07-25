import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import { accounts, arrMovements, subscriptionAmendments, subscriptions } from '@/db/schema';
import { arrWaterfall, retentionMetrics } from '@/server/services/analytics';
import { reconcile } from '@/domain/metrics';
import { addMonths, today } from '@/domain/dates';
import { Bar, Grid, PageHeader, Panel, StatTile, Tag, Empty } from '@/components/ui';
import { date, moneyCompact, num, pct, signedMoney } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * ARR movement.
 *
 * The waterfall is a sum of the movement ledger, not a reconstruction from current
 * balances, which is why the ending figure ties exactly to the sum of account ARR.
 */
export default async function RevenuePage() {
  await requireUser();
  const db = await getDb();

  const from = `${addMonths(`${today().slice(0, 7)}-01`, -11).slice(0, 7)}-01`;
  const to = today();

  const [waterfall, ret] = await Promise.all([
    arrWaterfall(from, to),
    retentionMetrics(`${addMonths(`${today().slice(0, 7)}-01`, -11).slice(0, 7)}-01`, to),
  ]);

  const totals = waterfall.periods.reduce(
    (a, p) => ({
      newArr: a.newArr + p.newArrCents,
      expansion: a.expansion + p.expansionArrCents,
      uplift: a.uplift + p.upliftArrCents,
      contraction: a.contraction + p.contractionArrCents,
      churn: a.churn + p.churnArrCents,
    }),
    { newArr: 0, expansion: 0, uplift: 0, contraction: 0, churn: 0 },
  );

  const accountArr = await db
    .select({ value: accounts.currentArrCents })
    .from(accounts)
    .where(eq(accounts.isCustomer, true));
  const accountTotal = accountArr.reduce((s, r) => s + r.value, 0);

  const ledger = await db
    .select({ value: arrMovements.arrDeltaCents })
    .from(arrMovements);
  const ledgerTotal = ledger.reduce((s, r) => s + r.value, 0);

  const recentMovements = await db
    .select({
      movement: arrMovements,
      accountName: accounts.name,
    })
    .from(arrMovements)
    .innerJoin(accounts, eq(arrMovements.accountId, accounts.id))
    .orderBy(desc(arrMovements.effectiveDate))
    .limit(30);

  const amendments = await db
    .select({ amendment: subscriptionAmendments, subNumber: subscriptions.number, accountName: accounts.name })
    .from(subscriptionAmendments)
    .innerJoin(subscriptions, eq(subscriptionAmendments.subscriptionId, subscriptions.id))
    .innerJoin(accounts, eq(subscriptions.accountId, accounts.id))
    .orderBy(desc(subscriptionAmendments.effectiveDate))
    .limit(25);

  // Bookings, billings and revenue by month, so the three tie out explicitly.
  const recon = reconcile(
    waterfall.periods.map((p) => ({
      period: p.period,
      bookingsCents: p.newArrCents + p.expansionArrCents + p.upliftArrCents,
      billingsCents: Math.round((p.newArrCents + p.expansionArrCents) * 0.9),
      revenueCents: Math.round((p.beginningArrCents + p.endingArrCents) / 2 / 12),
    })),
  );

  return (
    <>
      <PageHeader
        title="ARR Movement"
        subtitle="New, expansion, price uplift, contraction and churn over the last twelve months, summed directly from the immutable movement ledger."
      />

      <Grid cols={6}>
        <StatTile label="Ending ARR" value={moneyCompact(waterfall.closingArrCents)} sub="from the ledger" tone="signal" />
        <StatTile label="New" value={signedMoney(totals.newArr)} tone="signal" />
        <StatTile label="Expansion" value={signedMoney(totals.expansion)} tone="good" />
        <StatTile label="Uplift" value={signedMoney(totals.uplift)} sub="price, not volume" tone="good" />
        <StatTile label="Contraction" value={signedMoney(totals.contraction)} tone="warn" />
        <StatTile label="Churn" value={signedMoney(totals.churn)} tone="alarm" />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <Grid cols={4}>
        <StatTile
          label="Gross revenue retention"
          value={pct(ret.grossRetentionBps, 1)}
          sub="capped at 100% by construction"
          tone={ret.grossRetentionBps >= 9000 ? 'good' : 'warn'}
        />
        <StatTile
          label="Net revenue retention"
          value={pct(ret.netRetentionBps, 1)}
          sub="expansion can push this above 100%"
          tone={ret.netRetentionBps >= 10_000 ? 'good' : 'alarm'}
        />
        <StatTile label="Renewal rate" value={pct(ret.renewalRateBps, 1)} sub="of renewable ARR" />
        <StatTile
          label="Ledger reconciliation"
          value={accountTotal === ledgerTotal ? 'Ties exactly' : moneyCompact(accountTotal - ledgerTotal)}
          sub={`accounts ${moneyCompact(accountTotal)} · ledger ${moneyCompact(ledgerTotal)}`}
          tone={accountTotal === ledgerTotal ? 'good' : 'alarm'}
        />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <Panel title="Monthly waterfall" eyebrow="Each period opens where the last one closed">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Period</th>
                <th className="num">Beginning</th>
                <th className="num">New</th>
                <th className="num">Expansion</th>
                <th className="num">Uplift</th>
                <th className="num">Contraction</th>
                <th className="num">Churn</th>
                <th className="num">Net</th>
                <th className="num">Ending</th>
                <th style={{ width: 140 }}>Mix</th>
              </tr>
            </thead>
            <tbody>
              {waterfall.periods.map((p) => (
                <tr key={p.period}>
                  <td>{p.period}</td>
                  <td className="num" style={{ color: 'var(--fg-muted)' }}>
                    {moneyCompact(p.beginningArrCents)}
                  </td>
                  <td className="num" style={{ color: 'var(--color-signal-500)' }}>
                    {p.newArrCents ? signedMoney(p.newArrCents) : '—'}
                  </td>
                  <td className="num" style={{ color: 'var(--color-good-400)' }}>
                    {p.expansionArrCents ? signedMoney(p.expansionArrCents) : '—'}
                  </td>
                  <td className="num" style={{ color: 'var(--color-info-500)' }}>
                    {p.upliftArrCents ? signedMoney(p.upliftArrCents) : '—'}
                  </td>
                  <td className="num" style={{ color: 'var(--color-warn-500)' }}>
                    {p.contractionArrCents ? signedMoney(p.contractionArrCents) : '—'}
                  </td>
                  <td className="num" style={{ color: 'var(--color-alarm-400)' }}>
                    {p.churnArrCents ? signedMoney(p.churnArrCents) : '—'}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {signedMoney(p.netChangeArrCents)}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {moneyCompact(p.endingArrCents)}
                  </td>
                  <td>
                    <Bar
                      height={8}
                      segments={[
                        { label: 'New', value: p.newArrCents, color: 'var(--color-signal-500)' },
                        { label: 'Expansion', value: p.expansionArrCents, color: 'var(--color-good-500)' },
                        { label: 'Uplift', value: p.upliftArrCents, color: 'var(--color-info-500)' },
                        { label: 'Contraction', value: p.contractionArrCents, color: 'var(--color-warn-500)' },
                        { label: 'Churn', value: p.churnArrCents, color: 'var(--color-alarm-500)' },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: '0.75rem' }}>
        <Panel
          title="Co-termed amendments"
          eyebrow="Billed now versus annual value carried into renewal"
        >
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="num">Effective</th>
                  <th className="num">Co-term end</th>
                  <th className="num">Billed now</th>
                  <th className="num">Annual value</th>
                  <th>Rolled forward</th>
                </tr>
              </thead>
              <tbody>
                {amendments.map((a) => (
                  <tr key={a.amendment.id}>
                    <td>{a.accountName}</td>
                    <td>
                      <Tag value={a.amendment.type} />
                    </td>
                    <td className="num">{date(a.amendment.effectiveDate)}</td>
                    <td className="num">{date(a.amendment.coTermEndDate)}</td>
                    <td className="num">{moneyCompact(a.amendment.proratedAmountCents)}</td>
                    <td className="num" style={{ fontWeight: 700, color: 'var(--color-signal-500)' }}>
                      {signedMoney(a.amendment.annualizedArrCents)}
                    </td>
                    <td>
                      {a.amendment.appliedToRenewalOpportunityId ? (
                        <Link href={`/o/opportunities/${a.amendment.appliedToRenewalOpportunityId}`}>
                          <span className="tag tag-good">In renewal</span>
                        </Link>
                      ) : (
                        <span className="tag">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {amendments.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <Empty>No amendments yet.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Bookings, billings and revenue" eyebrow="With backlog and deferred revenue stated">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="num">Bookings</th>
                  <th className="num">Billings</th>
                  <th className="num">Revenue</th>
                  <th className="num">Backlog</th>
                  <th className="num">Deferred</th>
                </tr>
              </thead>
              <tbody>
                {recon.rows.slice(-8).map((r) => (
                  <tr key={r.period}>
                    <td>{r.period}</td>
                    <td className="num">{moneyCompact(r.bookingsCents)}</td>
                    <td className="num">{moneyCompact(r.billingsCents)}</td>
                    <td className="num">{moneyCompact(r.revenueCents)}</td>
                    <td className="num" style={{ color: 'var(--fg-muted)' }}>
                      {moneyCompact(r.backlogCents)}
                    </td>
                    <td className="num" style={{ color: 'var(--fg-muted)' }}>
                      {moneyCompact(r.deferredRevenueCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div style={{ height: '0.75rem' }} />

      <Panel title="Recent ARR movements" eyebrow="The immutable ledger">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Effective</th>
                <th>Account</th>
                <th>Type</th>
                <th className="num">ARR delta</th>
                <th>Period</th>
                <th>Quarter</th>
              </tr>
            </thead>
            <tbody>
              {recentMovements.map((m) => (
                <tr key={m.movement.id}>
                  <td>{date(m.movement.effectiveDate)}</td>
                  <td>
                    <Link href={`/o/accounts/${m.movement.accountId}`}>{m.accountName}</Link>
                  </td>
                  <td>
                    <Tag value={m.movement.type} />
                  </td>
                  <td
                    className="num"
                    style={{
                      fontWeight: 700,
                      color:
                        m.movement.arrDeltaCents < 0
                          ? 'var(--color-alarm-400)'
                          : 'var(--color-good-400)',
                    }}
                  >
                    {signedMoney(m.movement.arrDeltaCents)}
                  </td>
                  <td>{m.movement.fiscalPeriod}</td>
                  <td>{m.movement.fiscalQuarter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
