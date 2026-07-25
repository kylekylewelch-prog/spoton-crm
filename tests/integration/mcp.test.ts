import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as s from '@/db/schema';
import { setupDatabase, type TestHarness } from '../helpers/db';
import { TOOLS, runTool, type ToolContext } from '@/mcp/tools';
import { zodToJsonSchema } from '@/mcp/json-schema';

/**
 * The MCP surface, exercised exactly as Claude would call it.
 *
 * The two properties under test are that every tool works against real data, and
 * that the MCP session is bound by the same permissions and audit trail as a person
 * in the browser — no privileged back door.
 */

let h: TestHarness;
let ctx: ToolContext;

beforeAll(async () => {
  h = await setupDatabase({ withSeed: true });
  const user = await h.as('integration@spoton.dev');
  ctx = { user, audit: { user: { id: user.id }, source: 'mcp' } };
}, 240_000);

afterAll(async () => {
  await h?.close();
});

async function call(name: string, input: unknown = {}) {
  const result = await runTool(name, input, ctx);
  return result;
}

describe('tool declarations', () => {
  it('exposes a usable set of tools', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(12);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^spoton_/);
      expect(tool.description.length).toBeGreaterThan(40);
      expect(typeof tool.readOnly).toBe('boolean');
    }
  });

  it('produces valid MCP JSON Schema for every tool', () => {
    for (const tool of TOOLS) {
      const schema = zodToJsonSchema(tool.inputSchema) as {
        type: string;
        properties: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.type, `${tool.name} schema is not an object`).toBe('object');
      expect(typeof schema.properties).toBe('object');
      if (schema.required) expect(Array.isArray(schema.required)).toBe(true);
    }
  });

  it('converts nested types correctly', () => {
    const priceTool = TOOLS.find((t) => t.name === 'spoton_price_quote')!;
    const schema = zodToJsonSchema(priceTool.inputSchema) as any;

    expect(schema.required).toContain('opportunityId');
    expect(schema.properties.lines.type).toBe('array');
    expect(schema.properties.lines.items.type).toBe('object');
    expect(schema.properties.lines.items.properties.quantity.type).toBe('integer');
    expect(schema.properties.termMonths.type).toBe('integer');
    expect(schema.properties.termMonths.maximum).toBe(60);
  });

  it('marks write tools as not read-only', () => {
    const writes = ['spoton_log_activity', 'spoton_create_task', 'spoton_update_opportunity', 'spoton_advance_stage'];
    for (const name of writes) {
      expect(TOOLS.find((t) => t.name === name)?.readOnly, name).toBe(false);
    }
    expect(TOOLS.find((t) => t.name === 'spoton_get_account')?.readOnly).toBe(true);
  });

  it('rejects an unknown tool and malformed input', async () => {
    const unknown = await call('spoton_not_a_tool');
    expect(unknown.ok).toBe(false);
    expect(unknown.text).toMatch(/unknown tool/i);

    const bad = await call('spoton_get_account', { wrongField: 1 });
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/invalid input/i);
  });
});

describe('read tools', () => {
  it('searches across objects', async () => {
    const account = (await h.db.select().from(s.accounts).limit(1))[0];
    const result = await call('spoton_search', { query: account.name.split(' ')[0] });

    expect(result.ok).toBe(true);
    expect(result.text).toContain('Accounts');
    expect(result.text).toContain(account.name);
  });

  it('reports cleanly when nothing matches', async () => {
    const result = await call('spoton_search', { query: 'zzzz-no-such-company' });
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/no records matched/i);
  });

  it('returns the account 360 view with every section', async () => {
    const customer = (
      await h.db.select().from(s.accounts).where(eq(s.accounts.isCustomer, true)).limit(1)
    )[0];

    const result = await call('spoton_get_account', { accountId: customer.id });
    expect(result.ok).toBe(true);
    expect(result.text).toContain(customer.name);
    expect(result.text).toContain('Subscriptions');
    expect(result.text).toContain('Renewals');
    expect(result.text).toContain('Support posture');
    expect(result.text).toContain('Adoption');
    expect(result.text).toContain('Stakeholders');
  });

  it('handles a missing account id gracefully', async () => {
    const result = await call('spoton_get_account', { accountId: 'acc_does_not_exist' });
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/no account with id/i);
  });

  it('returns pipeline and forecast', async () => {
    const result = await call('spoton_pipeline', {});
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Pipeline');
    expect(result.text).toContain('Forecast');
    expect(result.text).toContain('coverage');
  });

  it('inspects a deal and lists what the gate requires', async () => {
    const opp = (
      await h.db
        .select()
        .from(s.opportunities)
        .where(eq(s.opportunities.stage, 'discovery'))
        .limit(1)
    )[0];

    const result = await call('spoton_inspect_opportunity', { opportunityId: opp.id });
    expect(result.ok).toBe(true);
    expect(result.text).toContain(opp.name);
    expect(result.text).toMatch(/To advance to|risk|No material risk/i);
  });

  it('returns the renewal book including co-termed additions', async () => {
    const result = await call('spoton_renewals', { horizonDays: 400 });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Renewal book');
    expect(result.text).toContain('coTermedAdditions');
  });

  it('filters the renewal book by risk level', async () => {
    const result = await call('spoton_renewals', { horizonDays: 400, riskLevel: 'low' });
    expect(result.ok).toBe(true);
  });

  it('returns the ARR waterfall and retention', async () => {
    const result = await call('spoton_arr_movement', { from: '2025-01-01' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('ARR movement');
    expect(result.text).toContain('Gross revenue retention');
    expect(result.text).toContain('net revenue retention');
  });

  it('returns at-risk accounts and whitespace', async () => {
    const result = await call('spoton_at_risk', { limit: 5 });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Accounts at risk');
    expect(result.text).toContain('Expansion whitespace');
  });

  it('prepares a meeting briefing', async () => {
    const customer = (
      await h.db.select().from(s.accounts).where(eq(s.accounts.isCustomer, true)).limit(1)
    )[0];
    const result = await call('spoton_meeting_prep', { accountId: customer.id });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Briefing');
    expect(result.text).toContain('How to open');
  });

  it('describes objects and lists the catalogue', async () => {
    const catalogue = await call('spoton_describe_object', {});
    expect(catalogue.ok).toBe(true);
    expect(catalogue.text).toContain('opportunities');

    const detail = await call('spoton_describe_object', { object: 'subscriptions' });
    expect(detail.ok).toBe(true);
    expect(detail.text).toContain('coTermedAdditionsArrCents');
    expect(detail.text).toContain('System managed');
  });

  it('queries an arbitrary object with filters', async () => {
    const result = await call('spoton_query', {
      object: 'opportunities',
      filters: [{ field: 'stage', op: 'eq', value: 'negotiation' }],
      limit: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Opportunities');
  });

  it('reports a bad field rather than failing opaquely', async () => {
    const result = await call('spoton_query', {
      object: 'opportunities',
      filters: [{ field: 'not_a_field', op: 'eq', value: 1 }],
    });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/unknown field/i);
  });

  it('returns stored insights with evidence', async () => {
    const result = await call('spoton_insights', { limit: 5 });
    expect(result.ok).toBe(true);
    if (!result.text.startsWith('No open insights')) {
      expect(result.text).toContain('Evidence');
      expect(result.text).toContain('Confidence');
    }
  });

  it('prices a quote without persisting anything', async () => {
    const before = await h.db.select({ value: sql<number>`count(*)::int` }).from(s.quotes);

    const opp = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.isClosed, false)).limit(1)
    )[0];
    const priceBook = (
      await h.db.select().from(s.priceBooks).where(eq(s.priceBooks.isDefault, true)).limit(1)
    )[0];
    const product = (
      await h.db.select().from(s.products).where(eq(s.products.sku, 'SPOT-PLAT-ENT')).limit(1)
    )[0];

    const result = await call('spoton_price_quote', {
      opportunityId: opp.id,
      accountId: opp.accountId,
      priceBookId: priceBook.id,
      termMonths: 12,
      startDate: '2026-09-01',
      lines: [{ productId: product.id, quantity: 120, discountBps: 2200 }],
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain('Blended discount');
    expect(result.text).toContain('Approval');

    const after = await h.db.select({ value: sql<number>`count(*)::int` }).from(s.quotes);
    expect(Number(after[0].value)).toBe(Number(before[0].value));
  });

  it('surfaces the co-term explanation when pricing against a subscription', async () => {
    const sub = (
      await h.db.select().from(s.subscriptions).where(eq(s.subscriptions.status, 'active')).limit(1)
    )[0];
    const opp = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.isClosed, false)).limit(1)
    )[0];
    const priceBook = (
      await h.db.select().from(s.priceBooks).where(eq(s.priceBooks.isDefault, true)).limit(1)
    )[0];
    const product = (
      await h.db.select().from(s.products).where(eq(s.products.sku, 'SPOT-MOD-CS')).limit(1)
    )[0];

    const result = await call('spoton_price_quote', {
      opportunityId: opp.id,
      accountId: sub.accountId,
      priceBookId: priceBook.id,
      termMonths: 12,
      startDate: sub.startDate,
      coTermSubscriptionId: sub.id,
      lines: [{ productId: product.id, quantity: 40 }],
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain('co-termed');
    expect(result.text).toContain('next renewal will inherit');
  });
});

describe('write tools', () => {
  it('logs an activity and attributes it to the MCP principal', async () => {
    const account = (await h.db.select().from(s.accounts).limit(1))[0];

    const result = await call('spoton_log_activity', {
      accountId: account.id,
      type: 'call',
      subject: 'Discovery call via Claude',
      summary: 'Discussed renewal automation and co-terming.',
      objections: ['Migration effort'],
      commitments: ['Send security documentation'],
      isCustomerResponse: false,
    });

    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/logged call/i);

    const rows = await h.db
      .select()
      .from(s.activities)
      .where(eq(s.activities.subject, 'Discovery call via Claude'));
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('mcp');
    expect(rows[0].ownerId).toBe(ctx.user.id);

    // And it is in the audit trail with source mcp.
    const audit = await h.db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.recordId, rows[0].id));
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].source).toBe('mcp');
  });

  it('creates a task owned by the caller when no owner is given', async () => {
    const result = await call('spoton_create_task', {
      title: 'Follow up on the security review',
      priority: 'high',
      dueDate: '2026-08-15',
    });

    expect(result.ok).toBe(true);
    const rows = await h.db
      .select()
      .from(s.tasks)
      .where(eq(s.tasks.title, 'Follow up on the security review'));
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerId).toBe(ctx.user.id);
    expect(rows[0].source).toBe('mcp');
    expect(rows[0].priority).toBe('high');
  });

  it('updates opportunity working fields and audits each one', async () => {
    const opp = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.isClosed, false)).limit(1)
    )[0];

    const result = await call('spoton_update_opportunity', {
      opportunityId: opp.id,
      nextStep: 'Claude scheduled the security review',
      closePlan: 'Signature targeted for month end',
    });

    expect(result.ok).toBe(true);
    const after = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.id, opp.id)).limit(1)
    )[0];
    expect(after.nextStep).toBe('Claude scheduled the security review');

    const audit = await h.db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.recordId, opp.id));
    const mcpEntries = audit.filter((a) => a.source === 'mcp');
    expect(mcpEntries.some((a) => a.field === 'nextStep')).toBe(true);
  });

  it('says so when there is nothing to update', async () => {
    const opp = (await h.db.select().from(s.opportunities).limit(1))[0];
    const result = await call('spoton_update_opportunity', { opportunityId: opp.id });
    expect(result.text).toMatch(/nothing to update/i);
  });

  /**
   * The important negative case: the MCP layer must not be able to bypass a stage
   * gate. It reports what is missing and changes nothing.
   */
  it('refuses to advance a stage whose exit criteria are unmet, and changes nothing', async () => {
    const anyAccount = (await h.db.select().from(s.accounts).limit(1))[0];
    const bare = await h.db
      .insert(s.opportunities)
      .values({
        name: 'MCP gate test',
        accountId: anyAccount.id,
        type: 'new_logo',
        stage: 'srl',
        closeDate: '2026-12-31',
        ownerId: ctx.user.id,
        termMonths: 12,
      })
      .returning();

    const result = await call('spoton_advance_stage', {
      opportunityId: bare[0].id,
      toStage: 'discovery',
    });

    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/blocked/i);
    expect(result.text).toMatch(/contact role|next step/i);
    expect(result.text).toMatch(/nothing was changed/i);

    const after = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.id, bare[0].id)).limit(1)
    )[0];
    expect(after.stage).toBe('srl');
  });

  it('advances a stage once the criteria are satisfied', async () => {
    // Start from a contact so the account is guaranteed to have one — partner
    // accounts carry no contacts in the seed.
    const contact = (
      await h.db.select().from(s.contacts).where(sql`${s.contacts.accountId} is not null`).limit(1)
    )[0];
    expect(contact).toBeTruthy();
    const accountId = contact.accountId!;

    const created = await h.db
      .insert(s.opportunities)
      .values({
        name: 'MCP gate pass',
        accountId,
        type: 'new_logo',
        stage: 'srl',
        closeDate: '2026-12-31',
        ownerId: ctx.user.id,
        termMonths: 12,
        nextStep: 'Discovery call booked',
      })
      .returning();

    await h.db.insert(s.opportunityContactRoles).values({
      opportunityId: created[0].id,
      contactId: contact.id,
      role: 'decision_maker',
      isPrimary: true,
    });

    const result = await call('spoton_advance_stage', {
      opportunityId: created[0].id,
      toStage: 'discovery',
    });

    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/advanced/i);

    const after = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.id, created[0].id)).limit(1)
    )[0];
    expect(after.stage).toBe('discovery');
  });

  it('requires a loss reason to close a deal lost', async () => {
    const account = (await h.db.select().from(s.accounts).limit(1))[0];
    const created = await h.db
      .insert(s.opportunities)
      .values({
        name: 'MCP loss test',
        accountId: account.id,
        type: 'new_logo',
        stage: 'discovery',
        closeDate: '2026-12-31',
        ownerId: ctx.user.id,
        termMonths: 12,
      })
      .returning();

    const blocked = await call('spoton_advance_stage', {
      opportunityId: created[0].id,
      toStage: 'closed_lost',
    });
    expect(blocked.text).toMatch(/blocked/i);

    const allowed = await call('spoton_advance_stage', {
      opportunityId: created[0].id,
      toStage: 'closed_lost',
      lossReason: 'Lost to incumbent on price',
    });
    expect(allowed.text).toMatch(/advanced/i);

    const after = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.id, created[0].id)).limit(1)
    )[0];
    expect(after.stage).toBe('closed_lost');
    expect(after.isClosed).toBe(true);
    expect(after.lossReason).toBe('Lost to incumbent on price');
  });
});

describe('MCP is bound by the same permissions as a person', () => {
  it('cannot approve a discount — there is no such tool', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).not.toContain('spoton_approve_quote');
    expect(names).not.toContain('spoton_decide_approval');
    expect(names).not.toContain('spoton_book_order');
    expect(names).not.toContain('spoton_churn_subscription');
  });

  it('is refused when acting as a role that lacks the permission', async () => {
    const support = await h.as('support@spoton.dev');
    const supportCtx: ToolContext = {
      user: support,
      audit: { user: { id: support.id }, source: 'mcp' },
    };

    const opp = (await h.db.select().from(s.opportunities).limit(1))[0];
    const result = await runTool(
      'spoton_update_opportunity',
      { opportunityId: opp.id, nextStep: 'Support should not set this' },
      supportCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/not permitted/i);
  });

  it('applies field-level security to MCP reads', async () => {
    const support = await h.as('support@spoton.dev');
    const supportCtx: ToolContext = {
      user: support,
      audit: { user: { id: support.id }, source: 'mcp' },
    };

    const result = await runTool(
      'spoton_query',
      { object: 'opportunities', limit: 3 },
      supportCtx,
    );

    expect(result.ok).toBe(true);
    // amountCents is hidden for support, so the column must be absent.
    expect(result.text).not.toContain('amountCents');
  });
});
