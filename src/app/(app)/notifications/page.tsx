import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { getDb } from '@/db';
import { notifications, tasks } from '@/db/schema';
import { Empty, Grid, PageHeader, Panel, StatTile, Tag } from '@/components/ui';
import { date, dateTime, humanise, num } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Notifications and the signed-in user's own task queue. */
export default async function NotificationsPage() {
  const user = await requireUser();
  const db = await getDb();

  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  const myTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.ownerId, user.id))
    .orderBy(tasks.dueDate)
    .limit(40);

  const open = myTasks.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const overdue = open.filter((t) => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10));

  return (
    <>
      <PageHeader
        title="Your queue"
        subtitle="Notifications and the tasks you own. Who owns the next action should never be ambiguous."
      />

      <Grid cols={4}>
        <StatTile label="Notifications" value={num(rows.length)} sub={`${num(rows.filter((r) => !r.readAt).length)} unread`} tone="signal" />
        <StatTile label="Open tasks" value={num(open.length)} />
        <StatTile label="Overdue" value={num(overdue.length)} tone={overdue.length > 0 ? 'alarm' : 'good'} />
        <StatTile label="Completed" value={num(myTasks.filter((t) => t.status === 'completed').length)} tone="good" />
      </Grid>

      <div style={{ height: '0.75rem' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '0.75rem' }}>
        <Panel title="Notifications">
          {rows.length === 0 ? (
            <Empty>Nothing to report.</Empty>
          ) : (
            rows.map((n) => (
              <div
                key={n.id}
                style={{
                  padding: '0.625rem 0.875rem',
                  borderBottom: '1px solid var(--rule)',
                  borderLeft: n.readAt ? '3px solid transparent' : '3px solid var(--color-signal-500)',
                }}
              >
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Tag value={n.level} label={humanise(n.level)} />
                  <strong style={{ fontSize: '0.8125rem' }}>{n.title}</strong>
                  <span style={{ fontSize: '0.5625rem', color: 'var(--fg-muted)' }}>
                    {dateTime(n.createdAt)}
                  </span>
                </div>
                {n.body && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.25rem' }}>
                    {n.body}
                  </p>
                )}
                {n.link && (
                  <Link href={n.link} className="btn" style={{ marginTop: '0.375rem' }}>
                    Open
                  </Link>
                )}
              </div>
            ))
          )}
        </Panel>

        <Panel title="Your tasks">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th className="num">Due</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {myTasks.map((t) => {
                  const isOverdue =
                    t.dueDate &&
                    t.dueDate < new Date().toISOString().slice(0, 10) &&
                    t.status !== 'completed';
                  return (
                    <tr key={t.id}>
                      <td>
                        <Link href={`/o/tasks/${t.id}`}>{t.title}</Link>
                      </td>
                      <td>
                        <Tag value={t.status} label={humanise(t.status)} />
                      </td>
                      <td>
                        <Tag value={t.priority} label={humanise(t.priority)} />
                      </td>
                      <td className="num" style={{ color: isOverdue ? 'var(--color-alarm-400)' : undefined }}>
                        {date(t.dueDate)}
                      </td>
                      <td style={{ fontSize: '0.625rem', color: 'var(--fg-muted)' }}>
                        {humanise(t.source)}
                      </td>
                    </tr>
                  );
                })}
                {myTasks.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <Empty>No tasks assigned to you.</Empty>
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
