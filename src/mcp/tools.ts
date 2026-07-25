import { z } from 'zod';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  accounts,
  activities,
  aiInsights,
  cases,
  contacts,
  opportunities,
  renewals,
  subscriptions,
  tasks,
  users,
} from '@/db/schema';
import type { AuthenticatedUser } from '@/server/auth';
import { resolveIntegrationUser } from '@/server/auth';
import { assertCan, fieldAccess, AccessError, ValidationError } from '@/server/rbac';
import { list, update as updateRecord, create as createRecord } from '@/server/repository';
import { getObject, objectKeys } from '@/server/objects';
import {
  arrWaterfall,
  atRiskAccounts,
  executiveDashboard,
  expansionWhitespace,
  forecastForPeriod,
  pipelineByStage,
  renewalBook,
  retentionMetrics,
} from '@/server/services/analytics';
import { accountSupportSummary } from '@/server/services/cases';
import { collectHealthInputs } from '@/server/services/health';
import { changeStage, previewStageChange } from '@/server/services/opportunities';
import { priceQuote } from '@/server/services/quotes';
import { inspectOpportunity, meetingPrep } from '@/domain/insights';
import { fiscalQuarter, quarterBounds, today } from '@/domain/dates';
import { formatMoney, formatBps } from '@/domain/money';
import { STAGES, type StageKey } from '@/domain/stages';
import type { AuditContext } from '@/server/audit';

/**
 * The MCP surface.
 *
 * Two principles shape this. First, every call runs as a real SpotOn user, so the
 * same object permissions, record scope, field-level security and audit trail apply
 * to Claude as to a person in the browser — there is no privileged back door.
 * Second, write tools are deliberately narrow: log an activity, create a task,
 * update a small set of opportunity fields, price a quote. Nothing here can approve
 * a discount, book revenue or churn a subscription, because those need a human and
 * an audit row.
 */

export type ToolContext = {
  user: AuthenticatedUser;
  audit: AuditContext;
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /** Read-only tools are safe to call speculatively. */
  readOnly: boolean;
  handler: (input: any, ctx: ToolContext) => Promise<string>;
};

/* --------------------------------------------------------------- formatting */

function table(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '(no rows)';
  const cols = columns ?? Object.keys(rows[0]);
  const header = cols.join(' | ');
  const divider = cols.map(() => '---').join(' | ');
  const body = rows
    .map((r) =>
      cols
        .map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return '—';
          if (v instanceof Date) return v.toISOString().slice(0, 10);
          return String(v);
        })
        .join(' | '),
    )
    .join('\n');
  return `${header}\n${divider}\n${body}`;
}

const m = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '—' : formatMoney(cents, 'USD', { compact: true });

/* ------------------------------------------------------------------- tools */

export const TOOLS: ToolDefinition[] = [
  /* ---------------------------------------------------------------- search */
  {
    name: 'spoton_search',
    title: 'Search across the CRM',
    description:
      'Free-text search across accounts, contacts, opportunities, renewals and service tickets. Use this first when the user names a company or person and you need its record id.',
    readOnly: true,
    inputSchema: z.object({
      query: z.string().min(1).describe('Company name, person name, email or ticket number'),
      limit: z.number().int().min(1).max(50).optional().default(10),
    }),
    async handler({ query, limit }, ctx) {
      const db = await getDb();
      const like = `%${query}%`;
      const out: string[] = [];

      const accountRows = await db
        .select({ id: accounts.id, name: accounts.name, arr: accounts.currentArrCents, health: accounts.healthScore, tier: accounts.tier })
        .from(accounts)
        .where(or(ilike(accounts.name, like), ilike(accounts.domain, like)))
        .limit(limit);
      if (accountRows.length) {
        out.push(
          `## Accounts\n${table(
            accountRows.map((a) => ({ id: a.id, name: a.name, tier: a.tier, arr: m(a.arr), health: a.health ?? '—' })),
          )}`,
        );
      }

      const contactRows = await db
        .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, role: contacts.roleType, accountId: contacts.accountId })
        .from(contacts)
        .where(or(ilike(contacts.lastName, like), ilike(contacts.email, like), ilike(contacts.firstName, like)))
        .limit(limit);
      if (contactRows.length) {
        out.push(
          `## Contacts\n${table(
            contactRows.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, email: c.email, role: c.role, accountId: c.accountId })),
          )}`,
        );
      }

      const oppRows = await db
        .select({ id: opportunities.id, name: opportunities.name, stage: opportunities.stage, arr: opportunities.arrCents, closeDate: opportunities.closeDate })
        .from(opportunities)
        .where(ilike(opportunities.name, like))
        .limit(limit);
      if (oppRows.length) {
        out.push(
          `## Opportunities\n${table(
            oppRows.map((o) => ({ id: o.id, name: o.name, stage: o.stage, arr: m(o.arr), closeDate: o.closeDate })),
          )}`,
        );
      }

      const caseRows = await db
        .select({ id: cases.id, number: cases.number, subject: cases.subject, status: cases.status, severity: cases.severity })
        .from(cases)
        .where(or(ilike(cases.subject, like), ilike(cases.number, like)))
        .limit(limit);
      if (caseRows.length) {
        out.push(`## Service tickets\n${table(caseRows)}`);
      }

      void ctx;
      return out.length > 0 ? out.join('\n\n') : `No records matched “${query}”.`;
    },
  },

  /* -------------------------------------------------------- account 360 */
  {
    name: 'spoton_get_account',
    title: 'Account 360 view',
    description:
      'The consolidated view of one account: ARR, subscriptions, health with its dimensions, open pipeline, renewals, support posture, stakeholders and recent activity.',
    readOnly: true,
    inputSchema: z.object({
      accountId: z.string().describe('Account id, from spoton_search'),
    }),
    async handler({ accountId }, ctx) {
      assertCan(ctx.user, 'accounts', 'read');
      const db = await getDb();

      const accountRows = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      const account = accountRows[0];
      if (!account) return `No account with id ${accountId}.`;

      const [subs, opps, rens, contactRows, support, healthInputs, acts] = await Promise.all([
        db.select().from(subscriptions).where(eq(subscriptions.accountId, accountId)),
        db.select().from(opportunities).where(and(eq(opportunities.accountId, accountId), eq(opportunities.isClosed, false))),
        db.select().from(renewals).where(eq(renewals.accountId, accountId)),
        db.select().from(contacts).where(eq(contacts.accountId, accountId)),
        accountSupportSummary(accountId),
        collectHealthInputs(accountId),
        db.select().from(activities).where(eq(activities.accountId, accountId)).orderBy(desc(activities.occurredAt)).limit(6),
      ]);

      const owner = account.ownerId
        ? (await db.select({ name: users.name }).from(users).where(eq(users.id, account.ownerId)).limit(1))[0]?.name
        : null;

      const sections = [
        `# ${account.name}`,
        `**Tier** ${account.tier} · **Region** ${account.region ?? '—'} · **Industry** ${account.industry ?? '—'} · **Lifecycle** ${account.lifecycleStage}`,
        `**Current ARR** ${m(account.currentArrCents)} · **Potential** ${m(account.potentialArrCents)} · **Health** ${account.healthScore ?? '—'} (${account.healthBand ?? 'unscored'}, trend ${account.healthTrend ?? 0})`,
        `**Owner** ${owner ?? '—'} · **Account id** \`${account.id}\``,
      ];

      if (subs.length) {
        sections.push(
          `## Subscriptions\n${table(
            subs.map((s) => ({
              number: s.number,
              status: s.status,
              term: `${s.startDate} → ${s.endDate}`,
              currentArr: m(s.currentArrCents),
              coTermedAdditions: m(s.coTermedAdditionsArrCents),
              autoRenew: s.autoRenew,
              noticeDate: s.noticeDate,
            })),
          )}`,
        );
      }

      if (rens.length) {
        sections.push(
          `## Renewals\n${table(
            rens.map((r) => ({
              renewalDate: r.renewalDate,
              status: r.status,
              renewableArr: m(r.renewableArrCents),
              expectedArr: m(r.expectedArrCents),
              risk: r.riskLevel,
              likelihood: r.renewalLikelihoodBps ? formatBps(r.renewalLikelihoodBps, 0) : '—',
              forecast: r.forecastCategory,
            })),
          )}`,
        );
      }

      if (opps.length) {
        sections.push(
          `## Open pipeline\n${table(
            opps.map((o) => ({
              id: o.id,
              name: o.name,
              type: o.type,
              stage: `${STAGES[o.stage as StageKey].displayNumber} ${STAGES[o.stage as StageKey].label}`,
              arr: m(o.arrCents),
              closeDate: o.closeDate,
              forecast: o.forecastCategory,
              nextStep: o.nextStep ?? '—',
            })),
          )}`,
        );
      }

      sections.push(
        `## Support posture\nOpen cases ${support.openCases} · severity-1 ${support.severity1Cases} · escalations ${support.openEscalations} · SLA breaches in 90 days ${support.slaBreaches90d} · average CSAT ${support.averageCsat ?? '—'}`,
      );

      sections.push(
        `## Adoption\nLicensed ${healthInputs.licensedUsers ?? '—'} · active ${healthInputs.activeUsers ?? '—'} · feature adoption ${
          healthInputs.featureAdoptionBps ? formatBps(healthInputs.featureAdoptionBps, 0) : '—'
        } · days since activity ${healthInputs.daysSinceLastActivity ?? '—'} · champion present ${healthInputs.championPresent ?? '—'}${
          healthInputs.championTurnover ? ' · **champion has left**' : ''
        }`,
      );

      if (contactRows.length) {
        sections.push(
          `## Stakeholders\n${table(
            contactRows.map((c) => ({
              id: c.id,
              name: `${c.firstName} ${c.lastName}`,
              title: c.title ?? '—',
              role: c.roleType,
              strength: c.relationshipStrength,
              sentiment: c.sentiment,
              engagement: c.engagementScore,
              departed: c.hasLeftCompany ? 'yes' : '',
            })),
          )}`,
        );
      }

      if (acts.length) {
        sections.push(
          `## Recent activity\n${table(
            acts.map((a) => ({
              date: a.occurredAt.toISOString().slice(0, 10),
              type: a.type,
              subject: a.subject,
              direction: a.direction,
              sentiment: a.sentiment ?? '—',
            })),
          )}`,
        );
      }

      return sections.join('\n\n');
    },
  },

  /* ------------------------------------------------------------- pipeline */
  {
    name: 'spoton_pipeline',
    title: 'Pipeline and forecast',
    description:
      'Pipeline by stage plus the forecast roll-up for a fiscal quarter: closed won, commit, best case, coverage and gap to quota.',
    readOnly: true,
    inputSchema: z.object({
      fiscalQuarter: z.string().optional().describe('e.g. 2026-Q3. Defaults to the current quarter.'),
      ownerId: z.string().optional().describe('Restrict to one owner'),
    }),
    async handler({ fiscalQuarter: q, ownerId }, ctx) {
      assertCan(ctx.user, 'opportunities', 'read');
      const period = q ?? fiscalQuarter(today());
      const [byStage, forecast] = await Promise.all([
        pipelineByStage(),
        forecastForPeriod(period, ownerId ?? null),
      ]);

      return [
        `# Pipeline — ${period}`,
        table(
          byStage.map((s) => ({
            stage: `${STAGES[s.stage].displayNumber} ${STAGES[s.stage].label}`,
            deals: s.count,
            arr: m(s.arrCents),
            defaultProbability: formatBps(STAGES[s.stage].defaultProbabilityBps, 0),
          })),
        ),
        `## Forecast`,
        `Closed won ${m(forecast.closedWonCents)} · commit ${m(forecast.commitCents)} · **call ${m(forecast.callCents)}**`,
        `Best case ${m(forecast.bestCaseCents)} · pipeline ${m(forecast.pipelineCents)} · omitted ${m(forecast.omittedCents)}`,
        `Stage-weighted ${m(forecast.weightedCents)} (computed) · quota ${m(forecast.quotaCents)} · attainment ${formatBps(forecast.attainmentBps, 0)}`,
        `Gap to quota ${m(forecast.gapToQuotaCents)} · coverage ${(forecast.coverageBps / 10_000).toFixed(1)}x`,
      ].join('\n\n');
    },
  },

  /* -------------------------------------------------------- deal inspection */
  {
    name: 'spoton_inspect_opportunity',
    title: 'Inspect a deal for risk',
    description:
      'Deal inspection: returns the execution-risk signals on an opportunity with the evidence behind each one, plus what the stage gate requires to advance.',
    readOnly: true,
    inputSchema: z.object({ opportunityId: z.string() }),
    async handler({ opportunityId }, ctx) {
      assertCan(ctx.user, 'opportunities', 'read');
      const db = await getDb();

      const rows = await db
        .select({ opp: opportunities, accountName: accounts.name })
        .from(opportunities)
        .innerJoin(accounts, eq(opportunities.accountId, accounts.id))
        .where(eq(opportunities.id, opportunityId))
        .limit(1);
      const row = rows[0];
      if (!row) return `No opportunity with id ${opportunityId}.`;

      const roleCount = await db
        .select({ value: sql<number>`count(*)::int` })
        .from((await import('@/db/schema')).opportunityContactRoles)
        .where(eq((await import('@/db/schema')).opportunityContactRoles.opportunityId, opportunityId));

      const recentActs = await db
        .select()
        .from(activities)
        .where(eq(activities.opportunityId, opportunityId))
        .orderBy(desc(activities.occurredAt))
        .limit(20);

      const lastResponse = recentActs.find((a) => a.isCustomerResponse)?.occurredAt ?? null;
      const objections = recentActs.flatMap((a) => (Array.isArray(a.objections) ? a.objections : []));
      const competitorMentions = recentActs.flatMap((a) =>
        Array.isArray(a.competitorMentions) ? a.competitorMentions : [],
      );

      const daysInStage = row.opp.stageEnteredAt
        ? Math.round((Date.now() - row.opp.stageEnteredAt.getTime()) / 86_400_000)
        : 0;

      const insights = inspectOpportunity({
        id: row.opp.id,
        accountId: row.opp.accountId,
        name: row.opp.name,
        stage: row.opp.stage as StageKey,
        amountCents: row.opp.amountCents,
        closeDate: row.opp.closeDate,
        daysInStage,
        pushCount: row.opp.pushCount,
        nextStep: row.opp.nextStep,
        nextMeetingAt: row.opp.nextMeetingAt,
        lastCustomerResponseAt: lastResponse,
        contactRoleCount: Number(roleCount[0]?.value ?? 0),
        hasEconomicBuyer: Number(roleCount[0]?.value ?? 0) > 1,
        hasMutualActionPlan: false,
        competitorMentions: competitorMentions.length,
        openObjections: objections.length,
        singleThreaded: Number(roleCount[0]?.value ?? 0) <= 1,
        asOf: today(),
      });

      const def = STAGES[row.opp.stage as StageKey];
      const nextStages = Object.values(STAGES)
        .filter((s) => s.ordinal === def.ordinal + 1)
        .map((s) => s.key);

      const gate =
        nextStages.length > 0 ? await previewStageChange(opportunityId, nextStages[0]) : null;

      const out = [
        `# ${row.opp.name}`,
        `${row.accountName} · ${def.displayNumber} ${def.label} · ${m(row.opp.arrCents)} ARR · closes ${row.opp.closeDate} · ${daysInStage} days in stage`,
      ];

      if (insights.length === 0) {
        out.push('No material risk signals detected.');
      } else {
        for (const i of insights) {
          out.push(
            `## ${i.title}\n**Severity** ${i.severity} · **Confidence** ${formatBps(i.confidenceBps, 0)}\n\n${i.detail}\n\n**Evidence**\n${i.evidence
              .map((e) => `- ${e}`)
              .join('\n')}\n\n**Recommended** ${i.recommendedAction ?? '—'}`,
          );
        }
      }

      if (gate) {
        out.push(
          `## To advance to ${STAGES[nextStages[0]].label}\n${gate.criteria
            .map((c) => `- [${c.met ? 'x' : ' '}] ${c.label}`)
            .join('\n')}`,
        );
      }

      return out.join('\n\n');
    },
  },

  /* ------------------------------------------------------------- renewals */
  {
    name: 'spoton_renewals',
    title: 'Renewal book',
    description:
      'The renewal book with risk, likelihood and forecast category. Renewable ARR includes the annualised value of mid-term additions co-termed onto the subscription.',
    readOnly: true,
    inputSchema: z.object({
      horizonDays: z.number().int().min(1).max(730).optional().default(180),
      riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    }),
    async handler({ horizonDays, riskLevel }, ctx) {
      assertCan(ctx.user, 'renewals', 'read');
      const book = await renewalBook(horizonDays);
      const rows = riskLevel ? book.rows.filter((r) => r.riskLevel === riskLevel) : book.rows;

      return [
        `# Renewal book — next ${horizonDays} days`,
        `Renewable ${m(book.totals.renewableArrCents)} · expected ${m(book.totals.expectedArrCents)} · committed ${m(
          book.totals.committedArrCents,
        )} · at risk ${m(book.totals.atRiskArrCents)} across ${book.totals.count} renewals`,
        table(
          rows.slice(0, 40).map((r) => ({
            account: r.accountName,
            renewalDate: r.renewalDate,
            noticeDate: r.noticeDate ?? '—',
            renewableArr: m(r.renewableArrCents),
            coTermedAdditions: m(r.coTermedAdditionsArrCents),
            expectedArr: m(r.expectedArrCents),
            risk: r.riskLevel,
            forecast: r.forecastCategory,
            health: r.healthScore ?? '—',
            autoRenew: r.autoRenew,
            daysToRenewal: r.daysToRenewal,
          })),
        ),
      ].join('\n\n');
    },
  },

  /* ------------------------------------------------------------------- ARR */
  {
    name: 'spoton_arr_movement',
    title: 'ARR movement and retention',
    description:
      'The ARR waterfall (new, expansion, uplift, contraction, churn) and gross/net retention for a date range, summed from the immutable movement ledger.',
    readOnly: true,
    inputSchema: z.object({
      from: z.string().optional().describe('ISO date, defaults to the start of the current quarter'),
      to: z.string().optional().describe('ISO date, defaults to today'),
    }),
    async handler({ from, to }, ctx) {
      assertCan(ctx.user, 'subscriptions', 'read');
      const q = quarterBounds(fiscalQuarter(today()));
      const start = from ?? q.start;
      const end = to ?? today();

      const [waterfall, ret] = await Promise.all([
        arrWaterfall(start, end),
        retentionMetrics(start, end),
      ]);

      return [
        `# ARR movement ${start} to ${end}`,
        table(
          waterfall.periods.map((p) => ({
            period: p.period,
            beginning: m(p.beginningArrCents),
            new: m(p.newArrCents),
            expansion: m(p.expansionArrCents),
            uplift: m(p.upliftArrCents),
            contraction: m(p.contractionArrCents),
            churn: m(p.churnArrCents),
            ending: m(p.endingArrCents),
          })),
        ),
        `## Retention\nGross revenue retention ${formatBps(ret.grossRetentionBps, 1)} · net revenue retention ${formatBps(
          ret.netRetentionBps,
          1,
        )} · renewal rate ${formatBps(ret.renewalRateBps, 1)} · logo retention ${formatBps(ret.logoRetentionBps, 1)}`,
      ].join('\n\n');
    },
  },

  /* ----------------------------------------------------------- health/risk */
  {
    name: 'spoton_at_risk',
    title: 'Accounts at risk and expansion whitespace',
    description:
      'Accounts below the health threshold with their support load and renewal proximity, plus the largest expansion whitespace by account.',
    readOnly: true,
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional().default(15) }),
    async handler({ limit }, ctx) {
      assertCan(ctx.user, 'accounts', 'read');
      const [risk, white] = await Promise.all([atRiskAccounts(limit), expansionWhitespace(limit)]);

      return [
        `# Accounts at risk`,
        table(
          risk.map((r) => ({
            account: r.name,
            arr: m(r.currentArrCents),
            health: r.healthScore ?? '—',
            band: r.healthBand ?? '—',
            openCases: r.openCases,
            daysToRenewal: r.daysToRenewal ?? '—',
            csm: r.csmName ?? '—',
          })),
        ),
        `# Expansion whitespace`,
        table(
          white.map((w) => ({
            account: w.name,
            currentArr: m(w.currentArrCents),
            whitespace: m(w.whitespaceArrCents),
            penetration: formatBps(w.penetrationBps, 0),
            notYetSold: w.missingFamilies.join(', ') || '—',
          })),
        ),
      ].join('\n\n');
    },
  },

  /* -------------------------------------------------------- meeting prep */
  {
    name: 'spoton_meeting_prep',
    title: 'Prepare for a customer meeting',
    description:
      'A briefing for an upcoming conversation, assembled from existing records: health, open issues, live deals, renewal proximity, outstanding commitments and who to handle carefully.',
    readOnly: true,
    inputSchema: z.object({ accountId: z.string() }),
    async handler({ accountId }, ctx) {
      assertCan(ctx.user, 'accounts', 'read');
      const db = await getDb();

      const accountRows = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      const account = accountRows[0];
      if (!account) return `No account with id ${accountId}.`;

      const [support, opps, rens, contactRows, acts] = await Promise.all([
        accountSupportSummary(accountId),
        db.select().from(opportunities).where(and(eq(opportunities.accountId, accountId), eq(opportunities.isClosed, false))),
        db.select().from(renewals).where(and(eq(renewals.accountId, accountId), inArray(renewals.status, ['not_started', 'in_progress', 'quoted', 'committed']))),
        db.select().from(contacts).where(eq(contacts.accountId, accountId)),
        db.select().from(activities).where(eq(activities.accountId, accountId)).orderBy(desc(activities.occurredAt)).limit(10),
      ]);

      const commitments = acts.flatMap((a) => (Array.isArray(a.commitments) ? (a.commitments as string[]) : []));
      const daysToRenewal = rens[0]
        ? Math.round((new Date(rens[0].renewalDate).getTime() - Date.now()) / 86_400_000)
        : null;

      const brief = meetingPrep({
        accountId,
        accountName: account.name,
        currentArrCents: account.currentArrCents,
        healthScore: account.healthScore,
        openCases: support.openCases,
        severity1Cases: support.severity1Cases,
        openOpportunities: opps.map((o) => ({
          name: o.name,
          stage: o.stage as StageKey,
          amountCents: o.amountCents,
        })),
        daysToRenewal,
        lastMeetingSummary: acts.find((a) => a.type === 'meeting')?.summary ?? null,
        openCommitments: commitments,
        attendees: contactRows.map((c) => ({
          name: `${c.firstName} ${c.lastName}`,
          title: c.title,
          role: c.roleType,
          sentiment: c.sentiment,
        })),
      });

      return [
        `# ${brief.title}`,
        brief.detail,
        `## Context\n${brief.evidence.map((e) => `- ${e}`).join('\n')}`,
        `## How to open\n${brief.recommendedAction}`,
      ].join('\n\n');
    },
  },

  /* --------------------------------------------------------- generic query */
  {
    name: 'spoton_query',
    title: 'Query any CRM object',
    description: `Filtered, permission-aware read of any registered object. Available objects: ${objectKeys()
      .slice(0, 40)
      .join(', ')} and more. Use spoton_describe_object first if unsure of field names.`,
    readOnly: true,
    inputSchema: z.object({
      object: z.string().describe('Object key, e.g. opportunities'),
      filters: z
        .array(
          z.object({
            field: z.string(),
            op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'is_null', 'not_null']),
            value: z.any().optional(),
          }),
        )
        .optional(),
      search: z.string().optional(),
      sortField: z.string().optional(),
      sortDirection: z.enum(['asc', 'desc']).optional(),
      limit: z.number().int().min(1).max(200).optional().default(25),
    }),
    async handler(input, ctx) {
      const result = await list(ctx.user, input.object, {
        filters: input.filters,
        search: input.search,
        sort: input.sortField
          ? { field: input.sortField, direction: input.sortDirection ?? 'desc' }
          : undefined,
        limit: input.limit,
      });

      const def = getObject(input.object);

      /**
       * Column selection has to respect field-level security as well as the values
       * do. Rendering a hidden field as an empty cell still discloses that the
       * field exists and is populated for that record, which is most of what the
       * restriction was protecting.
       */
      const cols = def.fields
        .filter((f) => f.inList && fieldAccess(ctx.user, input.object, f.name) !== 'hidden')
        .map((f) => f.name);

      return [
        `# ${def.labelPlural} — ${result.total} matching, showing ${result.rows.length}`,
        table(result.rows as Record<string, unknown>[], ['id', ...cols]),
      ].join('\n\n');
    },
  },

  {
    name: 'spoton_describe_object',
    title: 'Describe an object',
    description:
      'The field metadata for an object: names, types, whether required, and reference targets. Use this before spoton_query or a write tool.',
    readOnly: true,
    inputSchema: z.object({ object: z.string().optional() }),
    async handler({ object }, ctx) {
      if (!object) {
        return `# Available objects\n${objectKeys().join(', ')}`;
      }
      const def = getObject(object);
      return [
        `# ${def.labelPlural} (\`${def.key}\`)`,
        def.description ?? '',
        def.systemManaged ? '**System managed** — created by the platform, not directly.' : '',
        table(
          def.fields.map((f) => ({
            field: f.name,
            label: f.label,
            type: f.type,
            required: f.required ? 'yes' : '',
            references: f.referenceTo ?? '',
            options: f.options ? f.options.join('|') : '',
            derived: f.derived ? 'yes' : '',
          })),
        ),
        `Your role (${ctx.user.roleName}) permissions on this object: ${
          (ctx.user.permissions[def.key] ?? ctx.user.permissions['*'] ?? []).join(', ') || 'none'
        }`,
      ]
        .filter(Boolean)
        .join('\n\n');
    },
  },

  /* -------------------------------------------------------------- insights */
  {
    name: 'spoton_insights',
    title: 'Open insights and recommendations',
    description:
      'Stored insights with their evidence, confidence and recommended action. Nothing here has been applied to a record — each one needs a human decision.',
    readOnly: true,
    inputSchema: z.object({
      kind: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional().default(20),
    }),
    async handler({ kind, limit }, ctx) {
      assertCan(ctx.user, 'ai_insights', 'read');
      const db = await getDb();
      const rows = await db
        .select({ insight: aiInsights, accountName: accounts.name })
        .from(aiInsights)
        .leftJoin(accounts, eq(aiInsights.accountId, accounts.id))
        .where(and(eq(aiInsights.status, 'open'), kind ? eq(aiInsights.kind, kind as never) : sql`true`))
        .orderBy(desc(aiInsights.confidenceBps))
        .limit(limit);

      if (rows.length === 0) return 'No open insights.';

      return rows
        .map(
          ({ insight, accountName }) =>
            `## ${insight.title}\n${accountName ? `**Account** ${accountName} · ` : ''}**Kind** ${
              insight.kind
            } · **Severity** ${insight.severity} · **Confidence** ${formatBps(insight.confidenceBps, 0)}\n\n${
              insight.detail
            }\n\n**Evidence**\n${(Array.isArray(insight.evidence) ? (insight.evidence as string[]) : [])
              .map((e) => `- ${e}`)
              .join('\n')}\n\n**Recommended** ${insight.recommendedAction ?? '—'}\n\nRecord: \`${
              insight.objectType
            }/${insight.recordId}\``,
        )
        .join('\n\n');
    },
  },

  /* ============================ write tools ============================== */

  {
    name: 'spoton_log_activity',
    title: 'Log a customer interaction',
    description:
      'Records a call, meeting, email or note against an account and optionally a contact and opportunity. Use this to capture what was discussed, objections raised and commitments made.',
    readOnly: false,
    inputSchema: z.object({
      accountId: z.string(),
      type: z.enum(['email', 'call', 'meeting', 'note', 'demo', 'chat']),
      subject: z.string().min(3),
      body: z.string().optional(),
      contactId: z.string().optional(),
      opportunityId: z.string().optional(),
      occurredAt: z.string().optional().describe('ISO datetime, defaults to now'),
      durationMinutes: z.number().int().optional(),
      direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
      sentiment: z.enum(['very_negative', 'negative', 'neutral', 'positive', 'very_positive']).optional(),
      summary: z.string().optional(),
      nextSteps: z.string().optional(),
      objections: z.array(z.string()).optional(),
      competitorMentions: z.array(z.string()).optional(),
      commitments: z.array(z.string()).optional(),
      isCustomerResponse: z.boolean().optional(),
    }),
    async handler(input, ctx) {
      const created = await createRecord(
        ctx.user,
        'activities',
        {
          accountId: input.accountId,
          contactId: input.contactId ?? null,
          opportunityId: input.opportunityId ?? null,
          type: input.type,
          subject: input.subject,
          body: input.body ?? null,
          occurredAt: input.occurredAt ?? new Date().toISOString(),
          durationMinutes: input.durationMinutes ?? null,
          direction: input.direction ?? 'outbound',
          sentiment: input.sentiment ?? null,
          summary: input.summary ?? null,
          nextSteps: input.nextSteps ?? null,
          objections: input.objections ?? [],
          competitorMentions: input.competitorMentions ?? [],
          commitments: input.commitments ?? [],
          isCustomerResponse: input.isCustomerResponse ?? false,
          source: 'mcp',
        },
        ctx.audit,
      );
      return `Logged ${input.type} “${input.subject}” as activity \`${created.id}\`. Recorded against account ${input.accountId} by ${ctx.user.name} via MCP, with an audit entry.`;
    },
  },

  {
    name: 'spoton_create_task',
    title: 'Create a follow-up task',
    description: 'Creates a task with an owner and a due date, optionally linked to an account, opportunity, renewal or ticket.',
    readOnly: false,
    inputSchema: z.object({
      title: z.string().min(3),
      description: z.string().optional(),
      ownerId: z.string().optional().describe('Defaults to the calling user'),
      dueDate: z.string().optional().describe('ISO date'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      accountId: z.string().optional(),
      opportunityId: z.string().optional(),
      renewalId: z.string().optional(),
      caseId: z.string().optional(),
    }),
    async handler(input, ctx) {
      const created = await createRecord(
        ctx.user,
        'tasks',
        {
          title: input.title,
          description: input.description ?? null,
          ownerId: input.ownerId ?? ctx.user.id,
          dueDate: input.dueDate ?? null,
          priority: input.priority ?? 'medium',
          status: 'open',
          accountId: input.accountId ?? null,
          opportunityId: input.opportunityId ?? null,
          renewalId: input.renewalId ?? null,
          caseId: input.caseId ?? null,
          source: 'mcp',
        },
        ctx.audit,
      );
      return `Created task \`${created.id}\`: “${input.title}”, owned by ${
        input.ownerId ?? ctx.user.name
      }${input.dueDate ? `, due ${input.dueDate}` : ''}.`;
    },
  },

  {
    name: 'spoton_update_opportunity',
    title: 'Update opportunity working fields',
    description:
      'Updates the working fields on a deal: next step, next meeting, close plan, competitors, description and forecast category. Cannot change stage, amount or owner — those go through their own governed paths.',
    readOnly: false,
    inputSchema: z.object({
      opportunityId: z.string(),
      nextStep: z.string().optional(),
      nextMeetingAt: z.string().optional().describe('ISO datetime'),
      closePlan: z.string().optional(),
      competitors: z.array(z.string()).optional(),
      description: z.string().optional(),
      forecastCategory: z.enum(['commit', 'best_case', 'pipeline', 'omitted']).optional(),
    }),
    async handler(input, ctx) {
      const { opportunityId, ...rest } = input;
      const patch = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(patch).length === 0) return 'Nothing to update — supply at least one field.';

      await updateRecord(ctx.user, 'opportunities', opportunityId, patch, ctx.audit);
      return `Updated ${Object.keys(patch).join(', ')} on opportunity \`${opportunityId}\`. Each change is recorded field-by-field in the audit trail, attributed to ${ctx.user.name} via MCP.`;
    },
  },

  {
    name: 'spoton_advance_stage',
    title: 'Advance an opportunity stage',
    description:
      'Moves a deal to the next stage, enforcing that stage\'s objective exit criteria. If the gate is not met the tool reports exactly which criteria are outstanding and changes nothing. Cannot force an override.',
    readOnly: false,
    inputSchema: z.object({
      opportunityId: z.string(),
      toStage: z.enum([
        'srl',
        'discovery',
        'solution_design',
        'proposal',
        'negotiation',
        'contract',
        're_nurture',
        'closed_lost',
      ]),
      lossReason: z.string().optional().describe('Required when moving to closed_lost or re_nurture'),
      reNurtureUntil: z.string().optional().describe('Required when moving to re_nurture'),
    }),
    async handler(input, ctx) {
      const patch: Record<string, unknown> = {};
      if (input.lossReason) patch.lossReason = input.lossReason;
      if (input.reNurtureUntil) patch.reNurtureUntil = input.reNurtureUntil;

      const result = await changeStage(
        ctx.user,
        input.opportunityId,
        input.toStage as StageKey,
        ctx.audit,
        { patch },
      );

      if (!result.ok) {
        return [
          `Stage change blocked. The opportunity remains in ${STAGES[result.stage].label}.`,
          result.illegalTransition
            ? 'That transition is not permitted by the sales process.'
            : `Outstanding exit criteria:\n${result.failures.map((f) => `- ${f.label}`).join('\n')}`,
          'Nothing was changed. Resolve the criteria and try again.',
        ].join('\n\n');
      }

      return `Advanced opportunity \`${input.opportunityId}\` to ${STAGES[result.stage].displayNumber} ${
        STAGES[result.stage].label
      }.`;
    },
  },

  {
    name: 'spoton_price_quote',
    title: 'Price a quote without saving it',
    description:
      'Prices a set of lines against a price book, including volume tiers, co-termination and proration, and reports the blended discount and the approval chain it would trigger. Read-only: nothing is persisted.',
    readOnly: true,
    inputSchema: z.object({
      opportunityId: z.string(),
      accountId: z.string(),
      priceBookId: z.string(),
      termMonths: z.number().int().min(1).max(60),
      startDate: z.string(),
      coTermSubscriptionId: z.string().optional().describe('Supply to co-term onto an existing subscription'),
      lines: z
        .array(
          z.object({
            productId: z.string(),
            quantity: z.number().int().min(1),
            discountBps: z.number().int().min(0).max(10_000).optional(),
          }),
        )
        .min(1),
    }),
    async handler(input, ctx) {
      assertCan(ctx.user, 'quotes', 'read');
      const priced = await priceQuote({
        opportunityId: input.opportunityId,
        accountId: input.accountId,
        priceBookId: input.priceBookId,
        termMonths: input.termMonths,
        startDate: input.startDate,
        coTermSubscriptionId: input.coTermSubscriptionId ?? null,
        lines: input.lines,
      });

      const { planApprovals } = await import('@/domain/approvals');
      const db = await getDb();
      const policies = await db.select().from((await import('@/db/schema')).discountPolicies);

      const plan = planApprovals(
        policies.map((p) => ({
          id: p.id,
          name: p.name,
          sequence: p.sequence,
          thresholdBps: p.thresholdBps,
          approverRoleKey: p.approverRoleKey,
          appliesToProductFamily: p.appliesToProductFamily,
          appliesToOpportunityType: p.appliesToOpportunityType,
          minAmountCents: p.minAmountCents,
          triggersOnNonStandardTerms: p.triggersOnNonStandardTerms,
          slaHours: p.slaHours,
          escalateToRoleKey: p.escalateToRoleKey,
          active: p.active,
        })),
        {
          discountBps: priced.totals.effectiveDiscountBps,
          amountCents: priced.totals.netTotalCents,
          productFamilies: priced.productFamilies,
          requesterAuthorityBps: ctx.user.discountAuthorityBps,
        },
      );

      return [
        `# Quote pricing (not saved)`,
        `Term ${input.termMonths} months · ${priced.startDate} → ${priced.endDate}${
          priced.isCoTermed ? ' · **co-termed**' : ''
        }`,
        table(
          priced.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            listUnit: m(l.listUnitCents),
            netUnit: m(l.netUnitCents),
            discount: formatBps(l.discountBps, 1),
            arr: m(l.arrCents),
            billedNow: m(l.proratedAmountCents),
          })),
        ),
        `## Totals\nList ${m(priced.totals.listTotalCents)} · discount ${m(
          priced.totals.discountTotalCents,
        )} · net ${m(priced.totals.netTotalCents)}`,
        `**Blended discount ${formatBps(priced.totals.effectiveDiscountBps, 1)}** · ARR ${m(
          priced.totals.arrCents,
        )} · annualised ARR ${m(priced.totals.annualizedArrCents)} · billed now ${m(
          priced.totals.proratedAmountCents,
        )} · TCV ${m(priced.totals.tcvCents)}`,
        `## Approval\n${plan.summary}${
          plan.required
            ? `\n${plan.steps.map((s) => `${s.sequence}. ${s.approverRoleKey} — ${s.reason}`).join('\n')}`
            : ''
        }`,
        priced.isCoTermed
          ? `\n_Co-terming means this addition is billed pro rata for the remainder of the term, while its full annual value of ${m(
              priced.totals.annualizedArrCents,
            )} is what the next renewal will inherit._`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
    },
  },
];

/* ---------------------------------------------------------------- dispatch */

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Runs a tool, converting domain errors into readable text for the model. */
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<{ ok: boolean; text: string }> {
  const tool = findTool(name);
  if (!tool) return { ok: false, text: `Unknown tool: ${name}` };

  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      text: `Invalid input for ${name}:\n${parsed.error.issues
        .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n')}`,
    };
  }

  try {
    return { ok: true, text: await tool.handler(parsed.data, ctx) };
  } catch (err) {
    if (err instanceof AccessError) {
      return { ok: false, text: `Not permitted: ${err.message}` };
    }
    if (err instanceof ValidationError) {
      return {
        ok: false,
        text: `Validation failed: ${err.message}${
          err.failures.length ? `\n${err.failures.map((f) => `- ${f.field}: ${f.message}`).join('\n')}` : ''
        }`,
      };
    }
    return { ok: false, text: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Resolves the SpotOn identity a session acts as. Defaults to the integration
 * service account, which holds broad read access and narrow write access —
 * deliberately not an administrator.
 */
export async function resolveMcpUser(email?: string): Promise<AuthenticatedUser> {
  const target = email ?? process.env.MCP_USER_EMAIL ?? 'integration@spoton.dev';
  const user = await resolveIntegrationUser(target);
  if (!user) {
    throw new Error(
      `MCP user ${target} not found. Seed the database or set MCP_USER_EMAIL to an existing user.`,
    );
  }
  return user;
}
