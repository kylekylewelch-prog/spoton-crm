import { requireUser } from '@/server/session';
import { signOut } from '../login/actions';
import { Nav, ThemeToggle, type NavSection } from '@/components/nav';
import { GROUP_LABELS, objectsByGroup } from '@/server/objects';
import { can } from '@/server/rbac';
import { getDb } from '@/db';
import { approvalRequests, approvalSteps, cases, notifications } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';

/**
 * The authenticated shell.
 *
 * Navigation is built from the object registry filtered by the signed-in role's
 * permissions, so a support engineer does not see a Quotes link they cannot open.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();

  const pendingApprovals = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(approvalSteps)
    .innerJoin(approvalRequests, eq(approvalSteps.requestId, approvalRequests.id))
    .where(and(eq(approvalSteps.status, 'pending'), eq(approvalRequests.status, 'pending')));

  const escalated = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(cases)
    .where(eq(cases.isEscalated, true));

  const unread = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`));

  const workspaces: NavSection = {
    label: 'Workspaces',
    items: [
      { href: '/', label: 'Dashboard' },
      { href: '/pipeline', label: 'Pipeline' },
      { href: '/forecast', label: 'Forecast' },
      { href: '/revenue', label: 'ARR Movement' },
      { href: '/renewals', label: 'Renewal Desk' },
      { href: '/approvals', label: 'Approvals', badge: Number(pendingApprovals[0]?.value ?? 0) },
      { href: '/health', label: 'Customer Health' },
      { href: '/service', label: 'Service', badge: Number(escalated[0]?.value ?? 0) },
      { href: '/demand', label: 'Demand & Attribution' },
      { href: '/partners', label: 'Partners' },
      { href: '/insights', label: 'Insights' },
      { href: '/governance', label: 'Governance' },
      { href: '/integrations', label: 'Integrations' },
      { href: '/notifications', label: 'Notifications', badge: Number(unread[0]?.value ?? 0) },
    ],
  };

  const grouped = objectsByGroup();
  const objectSections: NavSection[] = Object.entries(grouped)
    .map(([group, defs]) => ({
      label: GROUP_LABELS[group as keyof typeof GROUP_LABELS] ?? group,
      items: defs
        .filter((d) => can(user, d.key, 'read'))
        .map((d) => ({ href: `/o/${d.key}`, label: d.labelPlural })),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Nav
        sections={[workspaces, ...objectSections]}
        user={{ name: user.name, roleName: user.roleName, email: user.email }}
        onSignOut={
          <form action={signOut} style={{ display: 'flex', gap: '0.375rem' }}>
            <button className="btn" type="submit">
              Sign out
            </button>
            <ThemeToggle />
          </form>
        }
      />
      <main style={{ flex: 1, minWidth: 0, padding: '1.25rem 1.5rem 3rem' }}>{children}</main>
    </div>
  );
}
