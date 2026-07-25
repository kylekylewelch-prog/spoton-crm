import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import {
  accountRelationships,
  accounts,
  dealRegistrations,
  partnerLeadDistributions,
  partnerProfiles,
  users,
} from '@/db/schema';
import { Empty, Grid, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { date, dateTime, humanise, moneyCompact, num, pct, truncate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Partner and channel management.
 *
 * The commercial intermediary and the end customer are always separate account
 * records linked by a typed relationship, so margin, renewal ownership and product
 * usage are never conflated — which is the mistake that makes channel reporting
 * useless.
 */
export default async function PartnersPage() {
  await requireUser();
  const db = await getDb();

  const partners = await db
    .select({ profile: partnerProfiles, account: accounts, managerName: users.name })
    .from(partnerProfiles)
    .innerJoin(accounts, eq(partnerProfiles.accountId, accounts.id))
    .leftJoin(users, eq(partnerProfiles.channelManagerId, users.id))
    .orderBy(desc(partnerProfiles.sourcedArrCents));

  const registrations = await db
    .select({ reg: dealRegistrations, partnerName: accounts.name })
    .from(dealRegistrations)
    .innerJoin(accounts, eq(dealRegistrations.partnerAccountId, accounts.id))
    .orderBy(desc(dealRegistrations.submittedAt))
    .limit(25);

  const handoffs = await db
    .select({ dist: partnerLeadDistributions, partnerName: accounts.name })
    .from(partnerLeadDistributions)
    .innerJoin(accounts, eq(partnerLeadDistributions.partnerAccountId, accounts.id))
    .orderBy(desc(partnerLeadDistributions.sentAt))
    .limit(20);

  const resellerLinks = await db
    .select({ rel: accountRelationships })
    .from(accountRelationships)
    .where(eq(accountRelationships.type, 'reseller'))
    .limit(30);

  const accountNames = new Map(
    (await db.select({ id: accounts.id, name: accounts.name }).from(accounts)).map((a) => [
      a.id,
      a.name,
    ]),
  );

  const conflicts = registrations.filter((r) => r.reg.status === 'conflict');
  const totalSourced = partners.reduce((s, p) => s + p.profile.sourcedArrCents, 0);
  const registeredArr = registrations
    .filter((r) => ['submitted', 'approved'].includes(r.reg.status))
    .reduce((s, r) => s + r.reg.estimatedArrCents, 0);

  return (
    <>
      <PageHeader
        title="Partners & Channel"
        subtitle="Partner tiers, deal registration with exclusivity windows, and reseller-to-end-customer relationships held as distinct accounts."
      />

      <Grid cols={5}>
        <StatTile label="Active partners" value={num(partners.length)} sub="across all tiers" tone="signal" />
        <StatTile label="Partner-sourced ARR" value={moneyCompact(totalSourced)} tone="good" />
        <StatTile label="Registered pipeline" value={moneyCompact(registeredArr)} sub="submitted or approved" />
        <StatTile
          label="Channel conflicts"
          value={num(conflicts.length)}
          sub="awaiting resolution"
          tone={conflicts.length > 0 ? 'alarm' : 'good'}
        />
        <StatTile label="Reseller relationships" value={num(resellerLinks.length)} sub="intermediary to end customer" />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <Panel title="Partner scorecards" eyebrow="Tier, margin, certification and contribution">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Tier</th>
                <th>Type</th>
                <th className="num">Margin</th>
                <th className="num">Referral fee</th>
                <th>Renewal ownership</th>
                <th>Certification</th>
                <th className="num">Sourced ARR</th>
                <th className="num">Influenced ARR</th>
                <th className="num">Registered</th>
                <th className="num">Won</th>
                <th>Manager</th>
                <th className="num">Agreement expires</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.profile.id}>
                  <td>
                    <Link href={`/o/accounts/${p.account.id}`}>{p.account.name}</Link>
                  </td>
                  <td>
                    <Tag value={p.profile.tier} label={humanise(p.profile.tier)} />
                  </td>
                  <td style={{ fontSize: '0.6875rem' }}>{humanise(p.profile.partnerType)}</td>
                  <td className="num">{pct(p.profile.marginBps, 0)}</td>
                  <td className="num">{pct(p.profile.referralFeeBps, 0)}</td>
                  <td>
                    <Tag value={p.profile.renewalOwnership} label={humanise(p.profile.renewalOwnership)} />
                  </td>
                  <td style={{ fontSize: '0.6875rem' }}>
                    {humanise(p.profile.certificationStatus)}
                    <div style={{ fontSize: '0.5625rem', color: 'var(--fg-muted)' }}>
                      {num(p.profile.certifiedEngineers)} engineers
                    </div>
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {moneyCompact(p.profile.sourcedArrCents)}
                  </td>
                  <td className="num" style={{ color: 'var(--fg-muted)' }}>
                    {moneyCompact(p.profile.influencedArrCents)}
                  </td>
                  <td className="num">{num(p.profile.dealsRegistered)}</td>
                  <td className="num">{num(p.profile.dealsWon)}</td>
                  <td style={{ fontSize: '0.6875rem' }}>{p.managerName ?? '—'}</td>
                  <td className="num" style={{ fontSize: '0.6875rem' }}>
                    {date(p.profile.agreementExpiresAt)}
                  </td>
                </tr>
              ))}
              {partners.length === 0 && (
                <tr>
                  <td colSpan={13}>
                    <Empty>No partner profiles yet.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: '0.75rem' }}>
        <Panel title="Deal registrations" eyebrow="With exclusivity windows and conflict flags">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Registration</th>
                  <th>Partner</th>
                  <th>End customer</th>
                  <th>Status</th>
                  <th className="num">Estimated ARR</th>
                  <th className="num">Protection ends</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((r) => (
                  <tr key={r.reg.id}>
                    <td>
                      <Link href={`/o/deal_registrations/${r.reg.id}`}>
                        <code style={{ fontSize: '0.6875rem' }}>{r.reg.number}</code>
                      </Link>
                    </td>
                    <td style={{ fontSize: '0.6875rem' }}>{truncate(r.partnerName, 22)}</td>
                    <td style={{ fontSize: '0.6875rem' }}>{truncate(r.reg.endCustomerName, 24)}</td>
                    <td>
                      <Tag value={r.reg.status} label={humanise(r.reg.status)} />
                    </td>
                    <td className="num">{moneyCompact(r.reg.estimatedArrCents)}</td>
                    <td className="num" style={{ fontSize: '0.6875rem' }}>
                      {date(r.reg.protectionEndsAt)}
                    </td>
                  </tr>
                ))}
                {registrations.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <Empty>No registrations submitted.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Reseller to end-customer links" eyebrow="Distinct accounts, typed relationship">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Reseller</th>
                  <th>End customer</th>
                  <th>Effective from</th>
                </tr>
              </thead>
              <tbody>
                {resellerLinks.map((l) => (
                  <tr key={l.rel.id}>
                    <td>
                      <Link href={`/o/accounts/${l.rel.fromAccountId}`}>
                        {accountNames.get(l.rel.fromAccountId) ?? l.rel.fromAccountId}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/o/accounts/${l.rel.toAccountId}`}>
                        {accountNames.get(l.rel.toAccountId) ?? l.rel.toAccountId}
                      </Link>
                    </td>
                    <td>{date(l.rel.effectiveFrom)}</td>
                  </tr>
                ))}
                {resellerLinks.length === 0 && (
                  <tr>
                    <td colSpan={3}>
                      <Empty>No reseller relationships.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div style={{ height: '0.75rem' }} />

      <Panel title="Lead distribution to partners" eyebrow="With acceptance SLA">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Status</th>
                <th className="num">Sent</th>
                <th className="num">Accepted</th>
                <th className="num">SLA due</th>
                <th>SLA</th>
                <th>Rejection reason</th>
              </tr>
            </thead>
            <tbody>
              {handoffs.map((h) => (
                <tr key={h.dist.id}>
                  <td>{truncate(h.partnerName, 26)}</td>
                  <td>
                    <Tag value={h.dist.status} label={humanise(h.dist.status)} />
                  </td>
                  <td className="num" style={{ fontSize: '0.6875rem' }}>
                    {dateTime(h.dist.sentAt)}
                  </td>
                  <td className="num" style={{ fontSize: '0.6875rem' }}>
                    {dateTime(h.dist.acceptedAt)}
                  </td>
                  <td className="num" style={{ fontSize: '0.6875rem' }}>
                    {dateTime(h.dist.slaDueAt)}
                  </td>
                  <td>
                    {h.dist.slaBreached ? (
                      <span className="tag tag-alarm">Breached</span>
                    ) : (
                      <span className="tag tag-good">Met</span>
                    )}
                  </td>
                  <td style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)' }}>
                    {h.dist.rejectionReason ?? '—'}
                  </td>
                </tr>
              ))}
              {handoffs.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <Empty>No partner lead handoffs.</Empty>
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
