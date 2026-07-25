import type { AuthenticatedUser } from './auth';

/**
 * Authorisation.
 *
 * Three independent layers, because collapsing them is how CRMs end up granting
 * edit rights to everyone who needs to read something:
 *
 *   1. Object level — may this role touch quotes at all?
 *   2. Record level — is this particular account theirs, their team's, or in their
 *      territory?
 *   3. Field level — may they see the ARR column, and may they change it?
 *
 * A user can therefore collaborate on a record they do not own without acquiring
 * the right to modify its commercial terms.
 */

export type Action = 'read' | 'create' | 'update' | 'delete' | 'approve' | 'export';

export type RecordScope = 'own' | 'team' | 'territory' | 'all' | 'none';

/** The ownership-bearing shape of any record the access check needs. */
export type OwnedRecord = {
  ownerId?: string | null;
  accountExecutiveId?: string | null;
  csmId?: string | null;
  renewalManagerId?: string | null;
  supportOwnerId?: string | null;
  channelManagerId?: string | null;
  teamId?: string | null;
  territoryId?: string | null;
  createdById?: string | null;
  /** Explicit collaborators from account_team / opportunity_team. */
  teamMemberIds?: string[];
};

export function can(user: AuthenticatedUser, objectType: string, action: Action): boolean {
  if (user.isAdmin) return true;
  const granted = user.permissions[objectType] ?? user.permissions['*'] ?? [];
  return granted.includes(action) || granted.includes('*');
}

export function assertCan(
  user: AuthenticatedUser,
  objectType: string,
  action: Action,
): void {
  if (!can(user, objectType, action)) {
    throw new AccessError(
      `${user.roleName} is not permitted to ${action} ${objectType.replace(/_/g, ' ')}`,
    );
  }
}

export class AccessError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

export class ValidationError extends Error {
  readonly status = 422;
  readonly failures: { field: string; message: string }[];
  constructor(message: string, failures: { field: string; message: string }[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.failures = failures;
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'Record not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * The record-level scope a role gets for an object. Read is deliberately wider
 * than write throughout: a seller should see the whole account landscape but only
 * change what they are accountable for.
 */
export function scopeFor(
  user: AuthenticatedUser,
  objectType: string,
  action: Action,
): RecordScope {
  if (user.isAdmin) return 'all';

  // An object-specific scope wins over the wildcard, which lets a role widen
  // access generally and then narrow one object, or the reverse.
  const scopes = (user.permissions[`${objectType}:scope`] ??
    user.permissions['*:scope'] ??
    []) as unknown as string[];
  if (Array.isArray(scopes) && scopes.length > 0) {
    return scopes[0] as RecordScope;
  }

  // Reading is open across the business; writing is scoped to ownership.
  if (action === 'read' || action === 'export') return 'all';
  return 'own';
}

export function canAccessRecord(
  user: AuthenticatedUser,
  objectType: string,
  action: Action,
  record: OwnedRecord,
  ctx: { teamUserIds?: string[]; territoryIds?: string[] } = {},
): boolean {
  if (!can(user, objectType, action)) return false;

  const scope = scopeFor(user, objectType, action);
  if (scope === 'all') return true;
  if (scope === 'none') return false;

  const ownerFields = [
    record.ownerId,
    record.accountExecutiveId,
    record.csmId,
    record.renewalManagerId,
    record.supportOwnerId,
    record.channelManagerId,
    record.createdById,
  ];

  if (ownerFields.includes(user.id)) return true;
  if (record.teamMemberIds?.includes(user.id)) return true;

  if (scope === 'team') {
    if (record.teamId && record.teamId === user.teamId) return true;
    if (ctx.teamUserIds && ownerFields.some((o) => o && ctx.teamUserIds!.includes(o))) return true;
  }

  if (scope === 'territory') {
    if (record.territoryId && ctx.territoryIds?.includes(record.territoryId)) return true;
  }

  return false;
}

export function assertCanAccessRecord(
  user: AuthenticatedUser,
  objectType: string,
  action: Action,
  record: OwnedRecord,
  ctx: { teamUserIds?: string[]; territoryIds?: string[] } = {},
): void {
  if (!canAccessRecord(user, objectType, action, record, ctx)) {
    throw new AccessError(
      `You do not have ${action} access to this ${objectType.replace(/_/g, ' ').replace(/s$/, '')}`,
    );
  }
}

/* ------------------------------------------------------------ field security */

export type FieldAccess = 'hidden' | 'read' | 'write';

/**
 * Field-level security. Defaults to `write` when unspecified so the matrix only
 * has to record exceptions, and a hidden field is never merely masked in the UI —
 * `redact` removes it from the payload entirely.
 */
export function fieldAccess(
  user: AuthenticatedUser,
  objectType: string,
  field: string,
): FieldAccess {
  if (user.isAdmin) return 'write';
  const key = `${objectType}.${field}`;
  const explicit = user.fieldSecurity[key] ?? user.fieldSecurity[`*.${field}`];
  if (explicit === 'hidden' || explicit === 'read' || explicit === 'write') return explicit;
  return 'write';
}

export function redact<T extends Record<string, unknown>>(
  user: AuthenticatedUser,
  objectType: string,
  record: T,
): Partial<T> {
  if (user.isAdmin) return record;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (fieldAccess(user, objectType, k) !== 'hidden') out[k] = v;
  }
  return out as Partial<T>;
}

export function redactMany<T extends Record<string, unknown>>(
  user: AuthenticatedUser,
  objectType: string,
  records: T[],
): Partial<T>[] {
  return records.map((r) => redact(user, objectType, r));
}

/** Strips fields the user may not write, returning what was dropped. */
export function filterWritable<T extends Record<string, unknown>>(
  user: AuthenticatedUser,
  objectType: string,
  patch: T,
): { allowed: Partial<T>; rejected: string[] } {
  const allowed: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (fieldAccess(user, objectType, k) === 'write') allowed[k] = v;
    else rejected.push(k);
  }
  return { allowed: allowed as Partial<T>, rejected };
}

/* ------------------------------------------------------------- role catalogue */

/**
 * The seeded role set. Read access is broad because a revenue team cannot operate
 * on partial visibility; write access is tight and follows accountability.
 */
export const ROLE_DEFINITIONS = [
  {
    key: 'admin',
    name: 'System Administrator',
    isAdmin: true,
    discountAuthorityBps: 10_000,
    permissions: { '*': ['*'] },
    fieldSecurity: {},
  },
  {
    key: 'cro',
    name: 'Chief Revenue Officer',
    isAdmin: false,
    discountAuthorityBps: 4000,
    permissions: {
      '*': ['read', 'export'],
      opportunities: ['read', 'update', 'approve', 'export'],
      quotes: ['read', 'update', 'approve', 'export'],
      renewals: ['read', 'update', 'approve', 'export'],
      forecasts: ['read', 'create', 'update', 'export'],
      approval_requests: ['read', 'update', 'approve'],
      accounts: ['read', 'update', 'export'],
    },
    fieldSecurity: {},
  },
  {
    key: 'cfo',
    name: 'Chief Financial Officer',
    isAdmin: false,
    discountAuthorityBps: 10_000,
    permissions: {
      '*': ['read', 'export'],
      approval_requests: ['read', 'update', 'approve'],
      quotes: ['read', 'approve'],
      contracts: ['read', 'update', 'approve'],
      invoices: ['read', 'update'],
    },
    fieldSecurity: {},
  },
  {
    key: 'vp_sales',
    name: 'VP Sales',
    isAdmin: false,
    discountAuthorityBps: 3000,
    permissions: {
      '*': ['read', 'export'],
      opportunities: ['read', 'create', 'update', 'approve', 'export'],
      quotes: ['read', 'create', 'update', 'approve', 'export'],
      approval_requests: ['read', 'update', 'approve'],
      accounts: ['read', 'create', 'update', 'export'],
      contacts: ['read', 'create', 'update'],
      leads: ['read', 'create', 'update'],
      forecasts: ['read', 'create', 'update', 'export'],
      tasks: ['read', 'create', 'update'],
      activities: ['read', 'create', 'update'],
    },
    fieldSecurity: {},
  },
  {
    key: 'sales_manager',
    name: 'Sales Manager',
    isAdmin: false,
    discountAuthorityBps: 2000,
    permissions: {
      '*': ['read'],
      opportunities: ['read', 'create', 'update', 'approve', 'export'],
      'opportunities:scope': ['team'],
      quotes: ['read', 'create', 'update', 'approve'],
      'quotes:scope': ['team'],
      approval_requests: ['read', 'update', 'approve'],
      accounts: ['read', 'create', 'update'],
      'accounts:scope': ['team'],
      contacts: ['read', 'create', 'update'],
      leads: ['read', 'create', 'update'],
      forecasts: ['read', 'create', 'update'],
      tasks: ['read', 'create', 'update'],
      activities: ['read', 'create', 'update'],
    },
    fieldSecurity: {},
  },
  {
    key: 'account_executive',
    name: 'Account Executive',
    isAdmin: false,
    discountAuthorityBps: 1000,
    permissions: {
      '*': ['read'],
      opportunities: ['read', 'create', 'update'],
      quotes: ['read', 'create', 'update'],
      accounts: ['read', 'create', 'update'],
      contacts: ['read', 'create', 'update'],
      leads: ['read', 'create', 'update'],
      activities: ['read', 'create', 'update'],
      tasks: ['read', 'create', 'update'],
      opportunity_products: ['read', 'create', 'update', 'delete'],
      quote_lines: ['read', 'create', 'update', 'delete'],
      opportunity_contact_roles: ['read', 'create', 'update', 'delete'],
      buying_committees: ['read', 'create', 'update'],
      buying_committee_members: ['read', 'create', 'update', 'delete'],
      mutual_action_plans: ['read', 'create', 'update'],
      mutual_action_plan_items: ['read', 'create', 'update', 'delete'],
      forecasts: ['read', 'create', 'update'],
    },
    // Sellers see margin-sensitive figures but must not overwrite them directly;
    // those move through the quoting and approval path instead.
    fieldSecurity: {
      'accounts.potentialArrCents': 'read',
      'subscriptions.originalArrCents': 'read',
      'quotes.effectiveDiscountBps': 'read',
    },
  },
  {
    key: 'bdr',
    name: 'Business Development Rep',
    isAdmin: false,
    discountAuthorityBps: 0,
    permissions: {
      '*': ['read'],
      leads: ['read', 'create', 'update'],
      contacts: ['read', 'create', 'update'],
      accounts: ['read', 'create'],
      activities: ['read', 'create', 'update'],
      tasks: ['read', 'create', 'update'],
      campaign_members: ['read', 'create', 'update'],
      campaign_responses: ['read', 'create'],
      opportunities: ['read', 'create'],
    },
    fieldSecurity: {
      'accounts.currentArrCents': 'read',
      'accounts.potentialArrCents': 'hidden',
      'opportunities.arrCents': 'read',
    },
  },
  {
    key: 'customer_success_manager',
    name: 'Customer Success Manager',
    isAdmin: false,
    discountAuthorityBps: 500,
    permissions: {
      '*': ['read'],
      accounts: ['read', 'update'],
      contacts: ['read', 'create', 'update'],
      success_plans: ['read', 'create', 'update'],
      success_plan_objectives: ['read', 'create', 'update', 'delete'],
      success_plan_milestones: ['read', 'create', 'update', 'delete'],
      risks: ['read', 'create', 'update'],
      calls_to_action: ['read', 'create', 'update'],
      business_reviews: ['read', 'create', 'update'],
      health_scores: ['read'],
      activities: ['read', 'create', 'update'],
      tasks: ['read', 'create', 'update'],
      opportunities: ['read', 'create', 'update'],
      renewals: ['read', 'update'],
      cases: ['read', 'create', 'update'],
      usage_signals: ['read', 'update'],
    },
    fieldSecurity: {},
  },
  {
    key: 'renewal_manager',
    name: 'Renewal Manager',
    isAdmin: false,
    discountAuthorityBps: 1000,
    permissions: {
      '*': ['read'],
      renewals: ['read', 'create', 'update', 'export'],
      subscriptions: ['read', 'update'],
      subscription_amendments: ['read', 'create', 'update'],
      opportunities: ['read', 'create', 'update'],
      quotes: ['read', 'create', 'update'],
      accounts: ['read', 'update'],
      contacts: ['read', 'create', 'update'],
      activities: ['read', 'create', 'update'],
      tasks: ['read', 'create', 'update'],
      risks: ['read', 'create', 'update'],
      forecasts: ['read', 'create', 'update'],
    },
    fieldSecurity: {},
  },
  {
    key: 'renewal_director',
    name: 'Renewals Director',
    isAdmin: false,
    discountAuthorityBps: 2000,
    permissions: {
      '*': ['read', 'export'],
      renewals: ['read', 'create', 'update', 'approve', 'export'],
      subscriptions: ['read', 'update'],
      approval_requests: ['read', 'update', 'approve'],
      opportunities: ['read', 'create', 'update'],
      quotes: ['read', 'create', 'update', 'approve'],
      forecasts: ['read', 'create', 'update'],
    },
    fieldSecurity: {},
  },
  {
    key: 'support_engineer',
    name: 'Support Engineer',
    isAdmin: false,
    discountAuthorityBps: 0,
    permissions: {
      '*': ['read'],
      cases: ['read', 'create', 'update'],
      case_comments: ['read', 'create'],
      product_defects: ['read', 'create', 'update'],
      activities: ['read', 'create'],
      tasks: ['read', 'create', 'update'],
      contacts: ['read', 'update'],
    },
    fieldSecurity: {
      'accounts.currentArrCents': 'read',
      'accounts.potentialArrCents': 'hidden',
      'opportunities.amountCents': 'hidden',
      'quotes.netTotalCents': 'hidden',
    },
  },
  {
    key: 'support_manager',
    name: 'Support Manager',
    isAdmin: false,
    discountAuthorityBps: 0,
    permissions: {
      '*': ['read'],
      cases: ['read', 'create', 'update', 'export'],
      case_comments: ['read', 'create'],
      product_defects: ['read', 'create', 'update'],
      sla_timers: ['read', 'update'],
      activities: ['read', 'create'],
      tasks: ['read', 'create', 'update'],
    },
    fieldSecurity: {
      'accounts.potentialArrCents': 'hidden',
    },
  },
  {
    key: 'support_director',
    name: 'Support Director',
    isAdmin: false,
    discountAuthorityBps: 0,
    permissions: {
      '*': ['read', 'export'],
      cases: ['read', 'create', 'update', 'export'],
      case_comments: ['read', 'create'],
      product_defects: ['read', 'create', 'update'],
      sla_timers: ['read', 'update'],
      risks: ['read', 'create', 'update'],
      tasks: ['read', 'create', 'update'],
    },
    fieldSecurity: {},
  },
  {
    key: 'vp_customer_success',
    name: 'VP Customer Success',
    isAdmin: false,
    discountAuthorityBps: 1500,
    permissions: {
      '*': ['read', 'export'],
      success_plans: ['read', 'create', 'update'],
      risks: ['read', 'create', 'update'],
      renewals: ['read', 'update', 'approve'],
      accounts: ['read', 'update'],
      approval_requests: ['read', 'update', 'approve'],
      health_models: ['read', 'update'],
      tasks: ['read', 'create', 'update'],
    },
    fieldSecurity: {},
  },
  {
    key: 'channel_manager',
    name: 'Channel Manager',
    isAdmin: false,
    discountAuthorityBps: 1500,
    permissions: {
      '*': ['read'],
      partner_profiles: ['read', 'create', 'update'],
      deal_registrations: ['read', 'create', 'update', 'approve'],
      partner_lead_distributions: ['read', 'create', 'update'],
      accounts: ['read', 'create', 'update'],
      contacts: ['read', 'create', 'update'],
      opportunities: ['read', 'create', 'update'],
      leads: ['read', 'create', 'update'],
      activities: ['read', 'create', 'update'],
      tasks: ['read', 'create', 'update'],
    },
    fieldSecurity: {},
  },
  {
    key: 'deal_desk',
    name: 'Deal Desk',
    isAdmin: false,
    discountAuthorityBps: 2500,
    permissions: {
      '*': ['read', 'export'],
      quotes: ['read', 'create', 'update', 'approve'],
      quote_lines: ['read', 'create', 'update', 'delete'],
      approval_requests: ['read', 'update', 'approve'],
      contracts: ['read', 'create', 'update'],
      orders: ['read', 'create', 'update'],
      price_books: ['read', 'update'],
      price_book_entries: ['read', 'create', 'update'],
      discount_policies: ['read', 'update'],
      products: ['read', 'update'],
      subscriptions: ['read', 'update'],
      subscription_amendments: ['read', 'create', 'update'],
      opportunities: ['read', 'update'],
    },
    fieldSecurity: {},
  },
  {
    key: 'marketing_manager',
    name: 'Marketing Manager',
    isAdmin: false,
    discountAuthorityBps: 0,
    permissions: {
      '*': ['read', 'export'],
      campaigns: ['read', 'create', 'update'],
      campaign_members: ['read', 'create', 'update', 'delete'],
      campaign_responses: ['read', 'create'],
      leads: ['read', 'create', 'update'],
      contacts: ['read', 'create', 'update'],
      attribution_touches: ['read'],
      routing_rules: ['read', 'update'],
      tasks: ['read', 'create', 'update'],
    },
    fieldSecurity: {
      'opportunities.amountCents': 'read',
    },
  },
  {
    key: 'rev_ops',
    name: 'Revenue Operations',
    isAdmin: false,
    discountAuthorityBps: 0,
    permissions: {
      '*': ['read', 'create', 'update', 'export'],
      approval_requests: ['read'],
    },
    fieldSecurity: {},
  },
  {
    key: 'integration',
    name: 'Integration Service Account',
    isAdmin: false,
    discountAuthorityBps: 0,
    permissions: {
      '*': ['read', 'create', 'update'],
      /**
       * An integration principal acts on records it does not own — that is the
       * whole point of it. Scoping its writes to "own" would break every inbound
       * sync. It is not an administrator: it cannot delete or approve anything,
       * and every write is attributed to this named principal in the audit trail,
       * which is what makes machine activity reviewable rather than anonymous.
       */
      '*:scope': ['all'],
      users: ['read'],
      roles: ['read'],
    },
    fieldSecurity: {},
  },
  {
    key: 'readonly',
    name: 'Read Only',
    isAdmin: false,
    discountAuthorityBps: 0,
    permissions: { '*': ['read'] },
    fieldSecurity: {},
  },
] as const;
