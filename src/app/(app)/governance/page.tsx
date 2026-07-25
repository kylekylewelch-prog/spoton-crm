import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import {
  auditLog,
  dataQualityIssues,
  duplicateCandidates,
  ownershipHistory,
  roles,
  territoryAssignments,
  users,
  validationRules,
  workflowDefinitions,
  workflowRuns,
} from '@/db/schema';
import { Empty, Grid, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { date, dateTime, humanise, num, pct, truncate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Data governance and administration.
 *
 * Effective-dated ownership is the part that matters most here: replacing an owner
 * field without dated history makes historical attainment and commission
 * unreconstructable, so every change is recorded with a range rather than overwritten.
 */
export default async function GovernancePage() {
  await requireUser();
  const db = await getDb();

  const [dq, dupes, rules, workflows, roleRows] = await Promise.all([
    db.select().from(dataQualityIssues).where(eq(dataQualityIssues.status, 'open')).limit(30),
    db.select().from(duplicateCandidates).where(eq(duplicateCandidates.status, 'open')).limit(20),
    db.select().from(validationRules).orderBy(validationRules.objectType).limit(30),
    db
      .select({ def: workflowDefinitions, ownerName: users.name })
      .from(workflowDefinitions)
      .leftJoin(users, eq(workflowDefinitions.ownerUserId, users.id))
      .limit(20),
    db.select().from(roles).orderBy(desc(roles.discountAuthorityBps)),
  ]);

  const ownership = await db
    .select({ history: ownershipHistory, userName: users.name })
    .from(ownershipHistory)
    .leftJoin(users, eq(ownershipHistory.userId, users.id))
    .orderBy(desc(ownershipHistory.createdAt))
    .limit(25);

  const coverage = await db
    .select({ assignment: territoryAssignments, userName: users.name })
    .from(territoryAssignments)
    .leftJoin(users, eq(territoryAssignments.userId, users.id))
    .orderBy(desc(territoryAssignments.effectiveFrom))
    .limit(20);

  const overrides = await db
    .select({ log: auditLog, userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(eq(auditLog.action, 'override'))
    .orderBy(desc(auditLog.at))
    .limit(15);

  const auditCount = await db.select({ value: sql<number>`count(*)::int` }).from(auditLog);
  const runs = await db
    .select({ status: workflowRuns.status, value: sql<number>`count(*)::int` })
    .from(workflowRuns)
    .groupBy(workflowRuns.status);

  const errors = dq.filter((d) => d.severity === 'error');
  const crossObjectDupes = dupes.filter((d) => d.crossObject);

  return (
    <>
      <PageHeader
        title="Governance"
        subtitle="Role permissions, field-level security, validation, duplicate management, effective-dated ownership and the audit trail behind every change."
      />

      <Grid cols={6}>
        <StatTile label="Audit entries" value={num(Number(auditCount[0]?.value ?? 0))} sub="field-level history" tone="signal" />
        <StatTile label="Open data-quality issues" value={num(dq.length)} sub={`${num(errors.length)} errors`} tone={errors.length > 0 ? 'alarm' : 'warn'} />
        <StatTile
          label="Duplicate candidates"
          value={num(dupes.length)}
          sub={`${num(crossObjectDupes.length)} cross-object`}
          tone={dupes.length > 0 ? 'warn' : 'good'}
        />
        <StatTile label="Validation rules" value={num(rules.length)} sub="declarative, per object" />
        <StatTile label="Workflows" value={num(workflows.length)} sub="each with an owner and SLA" />
        <StatTile label="Gate overrides" value={num(overrides.length)} sub="each with a mandatory reason" tone={overrides.length > 0 ? 'warn' : 'good'} />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: '0.75rem' }}>
        <Panel title="Roles and discount authority" eyebrow="Object permissions and field security per role">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th className="num">Discount authority</th>
                  <th className="num">Objects granted</th>
                  <th className="num">Field rules</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {roleRows.map((r) => {
                  const perms = (r.permissions ?? {}) as Record<string, unknown>;
                  const fls = (r.fieldSecurity ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/o/roles/${r.id}`}>{r.name}</Link>
                        <div style={{ fontSize: '0.5625rem', color: 'var(--fg-muted)' }}>
                          <code>{r.key}</code>
                        </div>
                      </td>
                      <td className="num">
                        {r.discountAuthorityBps > 0 ? pct(r.discountAuthorityBps, 0) : '—'}
                      </td>
                      <td className="num">{num(Object.keys(perms).length)}</td>
                      <td className="num">{num(Object.keys(fls).length)}</td>
                      <td>{r.isAdmin ? <span className="tag tag-alarm">Yes</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Effective-dated ownership history" eyebrow="Never overwritten, always dated">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Role</th>
                  <th>Owner</th>
                  <th className="num">From</th>
                  <th className="num">To</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {ownership.map((o) => (
                  <tr key={o.history.id}>
                    <td style={{ fontSize: '0.6875rem' }}>
                      <Link href={`/o/${o.history.objectType}/${o.history.recordId}`}>
                        {humanise(o.history.objectType)}
                      </Link>
                    </td>
                    <td style={{ fontSize: '0.6875rem' }}>{humanise(o.history.role)}</td>
                    <td style={{ fontSize: '0.6875rem' }}>{o.userName ?? '—'}</td>
                    <td className="num" style={{ fontSize: '0.6875rem' }}>
                      {date(o.history.effectiveFrom)}
                    </td>
                    <td className="num" style={{ fontSize: '0.6875rem' }}>
                      {o.history.effectiveTo ? date(o.history.effectiveTo) : 'current'}
                    </td>
                    <td style={{ fontSize: '0.625rem', color: 'var(--fg-muted)' }}>
                      {truncate(o.history.reason, 26)}
                    </td>
                  </tr>
                ))}
                {ownership.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <Empty>No ownership changes recorded.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Territory coverage" eyebrow="Including temporary cover">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th className="num">From</th>
                  <th className="num">To</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((c) => (
                  <tr key={c.assignment.id}>
                    <td style={{ fontSize: '0.6875rem' }}>{c.userName ?? '—'}</td>
                    <td style={{ fontSize: '0.6875rem' }}>{humanise(c.assignment.role)}</td>
                    <td className="num" style={{ fontSize: '0.6875rem' }}>
                      {date(c.assignment.effectiveFrom)}
                    </td>
                    <td className="num" style={{ fontSize: '0.6875rem' }}>
                      {c.assignment.effectiveTo ? date(c.assignment.effectiveTo) : 'open'}
                    </td>
                    <td>
                      {c.assignment.isTemporaryCoverage ? (
                        <span className="tag tag-warn">Temporary cover</span>
                      ) : (
                        <span className="tag">Standing</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Workflows" eyebrow="Owner, entry criteria, SLA and exception queue">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Object</th>
                  <th>Trigger</th>
                  <th>Owner</th>
                  <th className="num">SLA</th>
                  <th>Exception queue</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((w) => (
                  <tr key={w.def.id}>
                    <td>
                      <Link href={`/o/workflow_definitions/${w.def.id}`}>
                        {truncate(w.def.name, 30)}
                      </Link>
                    </td>
                    <td style={{ fontSize: '0.6875rem' }}>{humanise(w.def.objectType)}</td>
                    <td style={{ fontSize: '0.6875rem' }}>{humanise(w.def.trigger)}</td>
                    <td style={{ fontSize: '0.6875rem' }}>{w.ownerName ?? '—'}</td>
                    <td className="num" style={{ fontSize: '0.6875rem' }}>
                      {w.def.slaMinutes ? `${num(w.def.slaMinutes)}m` : '—'}
                    </td>
                    <td style={{ fontSize: '0.6875rem' }}>
                      <code>{w.def.exceptionQueue}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {runs.length > 0 && (
            <div style={{ padding: '0.625rem 0.875rem', borderTop: '1px solid var(--rule)', fontSize: '0.6875rem' }}>
              Runs:{' '}
              {runs.map((r) => (
                <span key={r.status} style={{ marginRight: '0.75rem' }}>
                  <Tag value={r.status} label={`${humanise(r.status)} ${r.value}`} />
                </span>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: '0.75rem' }}>
        <Panel title="Open data-quality issues" eyebrow="Detected by the declarative rules">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Rule</th>
                  <th>Field</th>
                  <th>Severity</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {dq.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontSize: '0.6875rem' }}>
                      <Link href={`/o/${d.objectType}/${d.recordId}`}>{humanise(d.objectType)}</Link>
                    </td>
                    <td style={{ fontSize: '0.6875rem' }}>{truncate(d.rule, 34)}</td>
                    <td style={{ fontSize: '0.6875rem' }}>{d.field ? humanise(d.field) : '—'}</td>
                    <td>
                      <Tag value={d.severity === 'error' ? 'critical' : 'medium'} label={d.severity} />
                    </td>
                    <td style={{ fontSize: '0.625rem', color: 'var(--fg-muted)' }}>
                      {truncate(d.detail, 46)}
                    </td>
                  </tr>
                ))}
                {dq.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <Empty>No open data-quality issues.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Duplicate candidates" eyebrow="Cross-object matches resolve differently">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th className="num">Confidence</th>
                  <th>Matched on</th>
                  <th>Kind</th>
                  <th>Suggested action</th>
                </tr>
              </thead>
              <tbody>
                {dupes.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontSize: '0.6875rem' }}>
                      <Link href={`/o/${d.objectType}/${d.recordAId}`}>{humanise(d.objectType)}</Link>
                    </td>
                    <td className="num">{pct(d.scoreBps, 0)}</td>
                    <td style={{ fontSize: '0.6875rem' }}>
                      {Array.isArray(d.matchedOn) ? (d.matchedOn as string[]).join(', ') : '—'}
                    </td>
                    <td>
                      {d.crossObject ? (
                        <span className="tag tag-warn">Cross-object</span>
                      ) : (
                        <span className="tag">Same object</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.625rem', color: 'var(--fg-muted)' }}>
                      {d.crossObject
                        ? `Attach to the existing ${humanise(d.otherObjectType ?? 'record').toLowerCase()}`
                        : 'Merge, keeping the richer record'}
                    </td>
                  </tr>
                ))}
                {dupes.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <Empty>No duplicate candidates.</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {overrides.length > 0 && (
        <>
          <div style={{ height: '0.75rem' }} />
          <Panel title="Stage-gate overrides" eyebrow="Visible exceptions beat invisible workarounds">
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="num">When</th>
                    <th>Record</th>
                    <th>What</th>
                    <th>By</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((o) => (
                    <tr key={o.log.id}>
                      <td className="num" style={{ fontSize: '0.6875rem' }}>
                        {dateTime(o.log.at)}
                      </td>
                      <td style={{ fontSize: '0.6875rem' }}>
                        <Link href={`/o/${o.log.objectType}/${o.log.recordId}`}>
                          {humanise(o.log.objectType)}
                        </Link>
                      </td>
                      <td style={{ fontSize: '0.6875rem' }}>
                        <code>{o.log.field}</code>
                      </td>
                      <td style={{ fontSize: '0.6875rem' }}>{o.userName ?? 'system'}</td>
                      <td style={{ fontSize: '0.6875rem' }}>{truncate(o.log.reason, 60)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
