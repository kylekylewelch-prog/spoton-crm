import Link from 'next/link';
import { and, asc, desc, eq } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import {
  accounts,
  approvalRequests,
  approvalSteps,
  opportunities,
  quotes,
  users,
} from '@/db/schema';
import { canDecide } from '@/domain/approvals';
import { Empty, Grid, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { ApprovalDecision } from '@/components/approval-decision';
import { dateTime, humanise, money, moneyCompact, num, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The approvals inbox.
 *
 * Chains are shown in full, not just the current step, so an approver can see who
 * has already signed off and who comes after them. That context is what stops
 * approvals being rubber-stamped.
 */
export default async function ApprovalsPage() {
  const user = await requireUser();
  const db = await getDb();

  const requests = await db
    .select({
      request: approvalRequests,
      requesterName: users.name,
    })
    .from(approvalRequests)
    .leftJoin(users, eq(approvalRequests.requestedById, users.id))
    .orderBy(desc(approvalRequests.submittedAt))
    .limit(80);

  const allSteps = await db
    .select({ step: approvalSteps, approverName: users.name })
    .from(approvalSteps)
    .leftJoin(users, eq(approvalSteps.approverUserId, users.id))
    .orderBy(asc(approvalSteps.sequence));

  const stepsByRequest = new Map<string, typeof allSteps>();
  for (const s of allSteps) {
    const list = stepsByRequest.get(s.step.requestId) ?? [];
    list.push(s);
    stepsByRequest.set(s.step.requestId, list);
  }

  // Resolve the quote and account behind each request.
  const quoteIds = requests
    .filter((r) => r.request.objectType === 'quotes')
    .map((r) => r.request.recordId);

  const quoteRows =
    quoteIds.length > 0
      ? await db
          .select({ quote: quotes, accountName: accounts.name, oppName: opportunities.name })
          .from(quotes)
          .innerJoin(accounts, eq(quotes.accountId, accounts.id))
          .innerJoin(opportunities, eq(quotes.opportunityId, opportunities.id))
          .where(eq(quotes.status, quotes.status))
      : [];
  const quoteById = new Map(quoteRows.map((q) => [q.quote.id, q]));

  const pending = requests.filter((r) => r.request.status === 'pending');
  const decided = requests.filter((r) => r.request.status !== 'pending');

  const myQueue = pending.filter((r) => {
    const steps = stepsByRequest.get(r.request.id) ?? [];
    const current = steps.find((s) => s.step.sequence === r.request.currentStep);
    if (!current) return false;
    return canDecide(
      { approverRoleKey: current.step.approverRoleKey, approverUserId: current.step.approverUserId },
      { id: user.id, roleKey: user.roleKey, isAdmin: user.isAdmin },
      r.request.requestedById,
    ).allowed;
  });

  const pendingValue = pending.reduce((s, r) => s + r.request.amountCents, 0);
  const breached = pending.filter((r) => r.request.slaDueAt && r.request.slaDueAt < new Date());

  const renderRequest = (row: (typeof requests)[number]) => {
    const steps = stepsByRequest.get(row.request.id) ?? [];
    const current = steps.find((s) => s.step.sequence === row.request.currentStep);
    const quote = quoteById.get(row.request.recordId);

    const authority = current
      ? canDecide(
          {
            approverRoleKey: current.step.approverRoleKey,
            approverUserId: current.step.approverUserId,
          },
          { id: user.id, roleKey: user.roleKey, isAdmin: user.isAdmin },
          row.request.requestedById,
        )
      : { allowed: false, reason: 'No pending step' };

    return (
      <div
        key={row.request.id}
        style={{ borderBottom: '1px solid var(--rule)', padding: '0.875rem' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 280, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Tag value={row.request.status} />
              <Tag value={row.request.kind} label={humanise(row.request.kind)} />
              {row.request.slaDueAt && row.request.slaDueAt < new Date() && row.request.status === 'pending' && (
                <span className="tag tag-alarm">SLA breached</span>
              )}
            </div>

            <div style={{ marginTop: '0.375rem', fontWeight: 700, fontSize: '0.875rem' }}>
              {quote ? (
                <Link href={`/o/quotes/${quote.quote.id}`}>
                  {quote.accountName} — {quote.quote.number}
                </Link>
              ) : (
                <Link href={`/o/${row.request.objectType}/${row.request.recordId}`}>
                  {humanise(row.request.objectType)} {row.request.recordId.slice(0, 12)}…
                </Link>
              )}
            </div>

            {quote && (
              <div style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)' }}>
                {quote.oppName}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                gap: '1.25rem',
                marginTop: '0.5rem',
                fontSize: '0.75rem',
                flexWrap: 'wrap',
              }}
            >
              <span>
                <span className="eyebrow">Amount</span>
                <br />
                <strong>{money(row.request.amountCents)}</strong>
              </span>
              <span>
                <span className="eyebrow">Blended discount</span>
                <br />
                <strong
                  style={{
                    color:
                      row.request.discountBps >= 3000
                        ? 'var(--color-alarm-400)'
                        : row.request.discountBps >= 2000
                          ? 'var(--color-warn-500)'
                          : 'var(--fg)',
                  }}
                >
                  {pct(row.request.discountBps)}
                </strong>
              </span>
              {quote && (
                <span>
                  <span className="eyebrow">ARR</span>
                  <br />
                  <strong>{moneyCompact(quote.quote.arrCents)}</strong>
                </span>
              )}
              <span>
                <span className="eyebrow">Requested by</span>
                <br />
                {row.requesterName ?? '—'}
              </span>
              <span>
                <span className="eyebrow">Submitted</span>
                <br />
                {dateTime(row.request.submittedAt)}
              </span>
            </div>

            {row.request.justification && (
              <p
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.75rem',
                  color: 'var(--fg-muted)',
                  borderLeft: '2px solid var(--rule-strong)',
                  paddingLeft: '0.5rem',
                }}
              >
                {row.request.justification}
              </p>
            )}

            {/* --- the chain ------------------------------------------------ */}
            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.625rem', flexWrap: 'wrap' }}>
              {steps.map((s) => (
                <span
                  key={s.step.id}
                  className={
                    s.step.status === 'approved'
                      ? 'tag tag-good'
                      : s.step.status === 'rejected'
                        ? 'tag tag-alarm'
                        : s.step.sequence === row.request.currentStep
                          ? 'tag tag-signal'
                          : 'tag'
                  }
                  title={`Step ${s.step.sequence} · threshold ${pct(s.step.thresholdBps ?? 0, 0)} · ${
                    s.approverName ?? 'unassigned'
                  }`}
                >
                  {s.step.sequence}. {humanise(s.step.approverRoleKey)}
                  {s.step.status === 'approved' ? ' ✓' : s.step.status === 'rejected' ? ' ✕' : ''}
                </span>
              ))}
            </div>
          </div>

          {row.request.status === 'pending' && (
            <ApprovalDecision
              requestId={row.request.id}
              canDecide={authority.allowed}
              reason={authority.reason}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Discount and non-standard-terms approvals. Each policy row whose threshold is exceeded adds a step, producing an escalating chain rather than one approver absorbing the whole concession."
      />

      <Grid cols={4}>
        <StatTile label="Awaiting you" value={num(myQueue.length)} sub="you hold the current step" tone={myQueue.length > 0 ? 'signal' : 'good'} />
        <StatTile label="Pending overall" value={num(pending.length)} sub={moneyCompact(pendingValue)} />
        <StatTile label="SLA breached" value={num(breached.length)} sub="past decision deadline" tone={breached.length > 0 ? 'alarm' : 'good'} />
        <StatTile label="Decided" value={num(decided.length)} sub="in the last 80 requests" />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <Panel title="Awaiting your decision" eyebrow={`${num(myQueue.length)} requests`}>
          {myQueue.length === 0 ? (
            <Empty>Nothing is waiting on you.</Empty>
          ) : (
            myQueue.map(renderRequest)
          )}
        </Panel>

        <Panel title="All pending requests" eyebrow={`${num(pending.length)} in flight`}>
          {pending.length === 0 ? <Empty>No pending approvals.</Empty> : pending.map(renderRequest)}
        </Panel>

        <Panel title="Decision history" eyebrow="Approval history is part of the audit record">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Kind</th>
                  <th className="num">Amount</th>
                  <th className="num">Discount</th>
                  <th>Outcome</th>
                  <th>Chain</th>
                  <th className="num">Submitted</th>
                  <th className="num">Completed</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((row) => {
                  const steps = stepsByRequest.get(row.request.id) ?? [];
                  const quote = quoteById.get(row.request.recordId);
                  return (
                    <tr key={row.request.id}>
                      <td>
                        {quote ? (
                          <Link href={`/o/quotes/${quote.quote.id}`}>
                            {quote.accountName} — {quote.quote.number}
                          </Link>
                        ) : (
                          row.request.recordId.slice(0, 14)
                        )}
                      </td>
                      <td>{humanise(row.request.kind)}</td>
                      <td className="num">{moneyCompact(row.request.amountCents)}</td>
                      <td className="num">{pct(row.request.discountBps)}</td>
                      <td>
                        <Tag value={row.request.status} />
                      </td>
                      <td style={{ fontSize: '0.625rem' }}>
                        {steps.map((s) => humanise(s.step.approverRoleKey)).join(' → ')}
                      </td>
                      <td className="num">{dateTime(row.request.submittedAt)}</td>
                      <td className="num">{dateTime(row.request.completedAt)}</td>
                    </tr>
                  );
                })}
                {decided.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <Empty>No decisions recorded yet.</Empty>
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
