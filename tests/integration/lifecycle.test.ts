import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as s from '@/db/schema';
import { setupDatabase, type TestHarness } from '../helpers/db';
import { createQuote, submitQuoteForApproval, decideApproval, acceptQuote } from '@/server/services/quotes';
import { changeStage } from '@/server/services/opportunities';
import { amendSubscription, completeRenewal, churnRenewal, loadSubscriptionState } from '@/server/services/subscriptions';
import { computeArr } from '@/domain/subscriptions';
import { addDays, termEndDate, today } from '@/domain/dates';

/**
 * The full commercial lifecycle, against a real Postgres database.
 *
 * This is the test that matters most: a deal is quoted, approved through the chain,
 * accepted, won, provisioned, expanded mid-term with co-termination, and renewed —
 * with the ARR ledger checked at every step. If the specification's two headline
 * rules ever regress, this fails.
 */

let h: TestHarness;

beforeAll(async () => {
  h = await setupDatabase({ withSeed: true });
}, 240_000);

afterAll(async () => {
  await h?.close();
});

async function ledgerTotal(): Promise<number> {
  const rows = await h.db
    .select({ value: sql<number>`coalesce(sum(${s.arrMovements.arrDeltaCents}), 0)::bigint` })
    .from(s.arrMovements);
  return Number(rows[0]?.value ?? 0);
}

async function accountArrTotal(): Promise<number> {
  const rows = await h.db
    .select({ value: sql<number>`coalesce(sum(${s.accounts.currentArrCents}), 0)::bigint` })
    .from(s.accounts);
  return Number(rows[0]?.value ?? 0);
}

describe('seeded dataset integrity', () => {
  it('reconciles the ARR ledger against account balances exactly', async () => {
    // The strongest single correctness signal in the system: the sum of every
    // recorded movement must equal the sum of live account ARR.
    expect(await ledgerTotal()).toBe(await accountArrTotal());
  });

  it('created a renewal for every active subscription', async () => {
    const subs = await h.db
      .select()
      .from(s.subscriptions)
      .where(eq(s.subscriptions.status, 'active'));
    expect(subs.length).toBeGreaterThan(0);

    for (const sub of subs) {
      const rens = await h.db
        .select()
        .from(s.renewals)
        .where(eq(s.renewals.subscriptionId, sub.id));
      expect(rens.length, `subscription ${sub.number} has no renewal`).toBeGreaterThan(0);

      // Every renewal is paired with a renewal opportunity.
      expect(rens[0].opportunityId).toBeTruthy();
      const opp = await h.db
        .select()
        .from(s.opportunities)
        .where(eq(s.opportunities.id, rens[0].opportunityId!))
        .limit(1);
      expect(opp[0].type).toBe('renewal');
      expect(opp[0].isAutoCreated).toBe(true);
      expect(opp[0].closeDate).toBe(sub.endDate);
    }
  });

  it('set a notice date on every subscription before its end date', async () => {
    const subs = await h.db.select().from(s.subscriptions);
    for (const sub of subs) {
      expect(sub.noticeDate).toBeTruthy();
      expect(sub.noticeDate! < sub.endDate).toBe(true);
    }
  });

  it('kept subscription ARR equal to the sum of its active items', async () => {
    const subs = await h.db
      .select()
      .from(s.subscriptions)
      .where(eq(s.subscriptions.status, 'active'));

    for (const sub of subs) {
      const state = await loadSubscriptionState(sub.id);
      expect(computeArr(state.items), `subscription ${sub.number}`).toBe(sub.currentArrCents);
    }
  });

  it('recorded co-termed amendments and rolled them into a renewal', async () => {
    const coTermed = await h.db
      .select()
      .from(s.subscriptionAmendments)
      .where(eq(s.subscriptionAmendments.isCoTermed, true));

    expect(coTermed.length).toBeGreaterThan(0);

    for (const a of coTermed) {
      const sub = (
        await h.db.select().from(s.subscriptions).where(eq(s.subscriptions.id, a.subscriptionId)).limit(1)
      )[0];

      // A co-termed addition always ends when its parent subscription ends.
      expect(a.coTermEndDate).toBe(sub.endDate);
      // Expansions must have been carried into a renewal.
      if (['upsell', 'cross_sell', 'co_term_add'].includes(a.type) && a.annualizedArrCents > 0) {
        expect(a.appliedToRenewalId, `amendment ${a.number} was not rolled forward`).toBeTruthy();
      }
      // Billed-now is never more than the annual value on a mid-term addition.
      if (a.annualizedArrCents > 0) {
        expect(a.proratedAmountCents).toBeLessThanOrEqual(a.annualizedArrCents);
      }
    }
  });

  it('wrote an audit trail for the booking of each won deal', async () => {
    const booked = await h.db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.action, 'book'));
    expect(booked.length).toBeGreaterThan(0);
  });

  it('populated every configured opportunity stage that the plan seeds', async () => {
    const rows = await h.db
      .select({ stage: s.opportunities.stage, value: sql<number>`count(*)::int` })
      .from(s.opportunities)
      .groupBy(s.opportunities.stage);

    const present = new Set(rows.map((r) => r.stage));
    for (const stage of [
      'srl',
      'discovery',
      'solution_design',
      'proposal',
      'negotiation',
      'contract',
      'closed_won',
      're_nurture',
      'closed_lost',
    ]) {
      expect(present.has(stage as never), `stage ${stage} has no opportunities`).toBe(true);
    }
  });
});

describe('end-to-end deal lifecycle', () => {
  it('quotes, approves, wins, provisions and creates the renewal', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');

    // Deliberately an Account Executive rather than an admin: an admin holds full
    // discount authority, so the approval chain would legitimately be skipped and
    // the test would prove nothing about it.
    const ae = await h.as('ae@spoton.dev');
    const aeCtx = await h.ctx('ae@spoton.dev');
    expect(ae.discountAuthorityBps).toBe(1000);

    const account = (
      await h.db
        .select()
        .from(s.accounts)
        .where(and(eq(s.accounts.isCustomer, false), eq(s.accounts.isPartner, false)))
        .limit(1)
    )[0];
    expect(account).toBeTruthy();

    const contact = (
      await h.db.select().from(s.contacts).where(eq(s.contacts.accountId, account.id)).limit(1)
    )[0];

    const priceBook = (
      await h.db.select().from(s.priceBooks).where(eq(s.priceBooks.isDefault, true)).limit(1)
    )[0];
    // Enterprise edition permits up to 25% on a single line, which is what lets
    // this test drive a two-step chain rather than a single approval.
    const product = (
      await h.db.select().from(s.products).where(eq(s.products.sku, 'SPOT-PLAT-ENT')).limit(1)
    )[0];
    expect(product.maxDiscountBps).toBe(2500);

    const startDate = today();

    const oppRows = await h.db
      .insert(s.opportunities)
      .values({
        name: `${account.name} — lifecycle test`,
        accountId: account.id,
        type: 'new_logo',
        stage: 'contract',
        forecastCategory: 'commit',
        probabilityBps: 9000,
        amountCents: 0,
        arrCents: 0,
        termMonths: 12,
        closeDate: startDate,
        originalCloseDate: startDate,
        // Owned by the AE, so record-level write scope applies to them.
        ownerId: ae.id,
        nextStep: 'Countersignature',
        description: 'Lifecycle integration test',
      })
      .returning();
    const opp = oppRows[0];

    if (contact) {
      await h.db.insert(s.opportunityContactRoles).values({
        opportunityId: opp.id,
        contactId: contact.id,
        role: 'decision_maker',
        isPrimary: true,
      });
    }

    /**
     * 25% is above the AE's 10% authority and above both the 10% manager and 20%
     * VP thresholds, so the matrix should produce an escalating two-step chain
     * rather than sending it straight to the highest approver.
     */
    const { quote } = await createQuote(
      ae,
      {
        opportunityId: opp.id,
        accountId: account.id,
        priceBookId: priceBook.id,
        termMonths: 12,
        startDate,
        lines: [{ productId: product.id, quantity: 100, discountBps: 2500 }],
      },
      aeCtx,
    );

    expect(quote.status).toBe('draft');
    expect(quote.arrCents).toBeGreaterThan(0);
    expect(quote.effectiveDiscountBps).toBe(2500);

    // --- approval chain -----------------------------------------------------
    const submitted = await submitQuoteForApproval(ae, quote.id, 'Competitive deal', aeCtx);
    expect(submitted.status).toBe('pending');
    expect(submitted.steps.map((x) => x.approverRoleKey)).toEqual(['sales_manager', 'vp_sales']);

    const inApproval = (
      await h.db.select().from(s.quotes).where(eq(s.quotes.id, quote.id)).limit(1)
    )[0];
    expect(inApproval.status).toBe('in_approval');

    // Accepting before approval must be impossible.
    await expect(acceptQuote(ae, quote.id, aeCtx)).rejects.toThrow(/approved before/i);

    // The requester cannot approve their own discount.
    await expect(
      decideApproval(ae, submitted.requestId!, 'approved', 'Approving my own deal', aeCtx),
    ).rejects.toThrow(/own request/i);

    const first = await decideApproval(admin, submitted.requestId!, 'approved', 'Step one', ctx);
    expect(first.requestStatus).toBe('pending');
    expect(first.nextStep).toBe(2);

    const second = await decideApproval(admin, submitted.requestId!, 'approved', 'Step two', ctx);
    expect(second.requestStatus).toBe('approved');
    expect(second.recordStatus).toBe('approved');

    await acceptQuote(ae, quote.id, aeCtx);

    // --- win the deal -------------------------------------------------------
    const ledgerBefore = await ledgerTotal();

    const result = await changeStage(ae, opp.id, 'closed_won', aeCtx);
    expect(result.ok).toBe(true);
    expect(result.provisioned).toBeTruthy();

    const { subscriptionId, renewalId, renewalOpportunityId, arrCents } = result.provisioned!;
    expect(arrCents).toBe(quote.arrCents);

    // Subscription provisioned with items and entitlements.
    const sub = (
      await h.db.select().from(s.subscriptions).where(eq(s.subscriptions.id, subscriptionId)).limit(1)
    )[0];
    expect(sub.status).toBe('active');
    expect(sub.currentArrCents).toBe(quote.arrCents);
    expect(sub.originalArrCents).toBe(quote.arrCents);
    expect(sub.startDate).toBe(startDate);
    expect(sub.endDate).toBe(termEndDate(startDate, 12));

    const items = await h.db
      .select()
      .from(s.subscriptionItems)
      .where(eq(s.subscriptionItems.subscriptionId, subscriptionId));
    expect(items.length).toBe(1);

    const ents = await h.db
      .select()
      .from(s.entitlements)
      .where(eq(s.entitlements.subscriptionId, subscriptionId));
    expect(ents.length).toBeGreaterThan(0);

    // Order and contract exist.
    const order = (
      await h.db.select().from(s.orders).where(eq(s.orders.opportunityId, opp.id)).limit(1)
    )[0];
    expect(order.arrCents).toBe(quote.arrCents);
    expect(order.contractId).toBeTruthy();

    // The renewal was created immediately, dated at term end.
    const renewal = (
      await h.db.select().from(s.renewals).where(eq(s.renewals.id, renewalId)).limit(1)
    )[0];
    expect(renewal.renewalDate).toBe(sub.endDate);
    expect(renewal.renewableArrCents).toBe(quote.arrCents);
    expect(renewal.status).toBe('not_started');
    expect(renewalOpportunityId).toBeTruthy();

    // The ledger moved by exactly the deal's ARR, classified as new.
    expect(await ledgerTotal()).toBe(ledgerBefore + quote.arrCents);
    expect(await ledgerTotal()).toBe(await accountArrTotal());

    const movements = await h.db
      .select()
      .from(s.arrMovements)
      .where(eq(s.arrMovements.subscriptionId, subscriptionId));
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe('new');
    expect(movements[0].arrDeltaCents).toBe(quote.arrCents);

    // Booking twice must not double-provision.
    const again = await changeStage(ae, opp.id, 'closed_won', aeCtx);
    expect(again.ok).toBe(true);
    const orders = await h.db
      .select()
      .from(s.orders)
      .where(eq(s.orders.opportunityId, opp.id));
    expect(orders).toHaveLength(1);
  });

  it('co-terms a mid-term cross-sell and rolls its annual value into the renewal', async () => {
    const ctx = await h.ctx('admin@spoton.dev');

    const sub = (
      await h.db
        .select()
        .from(s.subscriptions)
        .where(eq(s.subscriptions.status, 'active'))
        .orderBy(s.subscriptions.createdAt)
        .limit(1)
    )[0];

    const renewalBefore = (
      await h.db
        .select()
        .from(s.renewals)
        .where(and(eq(s.renewals.subscriptionId, sub.id), inArray(s.renewals.status, ['not_started', 'in_progress'])))
        .limit(1)
    )[0];
    expect(renewalBefore).toBeTruthy();

    const product = (
      await h.db.select().from(s.products).where(eq(s.products.sku, 'SPOT-MOD-SERVICE')).limit(1)
    )[0];

    // Effective mid-term, so a genuine stub period exists.
    const effectiveDate =
      today() > sub.startDate && today() < sub.endDate ? today() : addDays(sub.startDate, 30);

    const arrBefore = sub.currentArrCents;
    const ledgerBefore = await ledgerTotal();

    const result = await amendSubscription(
      sub.id,
      {
        type: 'cross_sell',
        effectiveDate,
        lines: [{ productId: product.id, quantity: 50, netUnitCents: 54_000, listUnitCents: 54_000, action: 'add' }],
        notes: 'Integration test cross-sell',
      },
      ctx,
    );

    // --- the co-term contract ---------------------------------------------
    expect(result.isCoTermed).toBe(true);
    expect(result.coTermEndDate).toBe(sub.endDate);

    // Full annual value is 50 x $540 = $27,000.
    expect(result.annualizedArrCents).toBe(50 * 54_000);
    expect(result.deltaArrCents).toBe(50 * 54_000);

    // Billed now is the stub period only, so strictly less than a full year
    // whenever the addition lands after the term started.
    if (effectiveDate > sub.startDate) {
      expect(result.proratedAmountCents).toBeLessThan(result.annualizedArrCents);
    }
    expect(result.proratedAmountCents).toBeGreaterThan(0);

    // --- the rollup --------------------------------------------------------
    expect(result.appliedToRenewalId).toBe(renewalBefore.id);

    const renewalAfter = (
      await h.db.select().from(s.renewals).where(eq(s.renewals.id, renewalBefore.id)).limit(1)
    )[0];

    expect(renewalAfter.coTermedAdditionsArrCents).toBe(
      renewalBefore.coTermedAdditionsArrCents + result.annualizedArrCents,
    );
    expect(renewalAfter.renewableArrCents).toBe(
      renewalBefore.renewableArrCents + result.annualizedArrCents,
    );
    // Uplift recalculates on the larger base.
    expect(renewalAfter.upliftArrCents).toBeGreaterThan(renewalBefore.upliftArrCents);
    expect(renewalAfter.expectedArrCents).toBe(
      renewalAfter.renewableArrCents + renewalAfter.upliftArrCents,
    );

    // The paired renewal opportunity followed the renewal.
    const renewalOpp = (
      await h.db
        .select()
        .from(s.opportunities)
        .where(eq(s.opportunities.id, renewalAfter.opportunityId!))
        .limit(1)
    )[0];
    expect(renewalOpp.arrCents).toBe(renewalAfter.expectedArrCents);

    // --- subscription and ledger ------------------------------------------
    const subAfter = (
      await h.db.select().from(s.subscriptions).where(eq(s.subscriptions.id, sub.id)).limit(1)
    )[0];
    expect(subAfter.currentArrCents).toBe(arrBefore + result.annualizedArrCents);
    expect(subAfter.version).toBe(sub.version + 1);
    expect(subAfter.coTermedAdditionsArrCents).toBeGreaterThan(0);

    const newItem = (
      await h.db
        .select()
        .from(s.subscriptionItems)
        .where(and(eq(s.subscriptionItems.subscriptionId, sub.id), eq(s.subscriptionItems.productId, product.id)))
        .limit(1)
    )[0];
    expect(newItem.isCoTermed).toBe(true);
    expect(newItem.endDate).toBe(sub.endDate);

    expect(await ledgerTotal()).toBe(ledgerBefore + result.annualizedArrCents);
    expect(await ledgerTotal()).toBe(await accountArrTotal());

    const expansion = await h.db
      .select()
      .from(s.arrMovements)
      .where(and(eq(s.arrMovements.subscriptionId, sub.id), eq(s.arrMovements.type, 'expansion')));
    expect(expansion.length).toBeGreaterThan(0);
  });

  it('renews at the uplifted rate and creates the following renewal', async () => {
    const ctx = await h.ctx('admin@spoton.dev');

    const renewal = (
      await h.db
        .select()
        .from(s.renewals)
        .where(eq(s.renewals.status, 'not_started'))
        .orderBy(s.renewals.renewalDate)
        .limit(1)
    )[0];
    expect(renewal).toBeTruthy();

    const oldSub = (
      await h.db.select().from(s.subscriptions).where(eq(s.subscriptions.id, renewal.subscriptionId)).limit(1)
    )[0];

    const result = await completeRenewal(renewal.id, { upliftBps: 500 }, ctx);

    // The successor starts the day after the old term ends.
    const newSub = (
      await h.db
        .select()
        .from(s.subscriptions)
        .where(eq(s.subscriptions.id, result.successorSubscriptionId))
        .limit(1)
    )[0];
    expect(newSub.startDate).toBe(addDays(oldSub.endDate, 1));
    expect(newSub.predecessorSubscriptionId).toBe(oldSub.id);
    expect(newSub.status).toBe('active');
    expect(newSub.coTermedAdditionsArrCents).toBe(0);

    // The renewed rate carries the uplift.
    expect(result.renewedArrCents).toBeGreaterThan(0);
    expect(result.upliftArrCents).toBeGreaterThan(0);

    // The old subscription is retired, not deleted.
    const retired = (
      await h.db.select().from(s.subscriptions).where(eq(s.subscriptions.id, oldSub.id)).limit(1)
    )[0];
    expect(retired.status).toBe('renewed');
    expect(retired.successorSubscriptionId).toBe(newSub.id);

    // The chain continues: the next renewal already exists.
    expect(result.nextRenewalId).toBeTruthy();
    const next = (
      await h.db.select().from(s.renewals).where(eq(s.renewals.id, result.nextRenewalId)).limit(1)
    )[0];
    expect(next.renewalDate).toBe(newSub.endDate);
    expect(next.status).toBe('not_started');

    // The renewal opportunity closed won.
    if (renewal.opportunityId) {
      const opp = (
        await h.db.select().from(s.opportunities).where(eq(s.opportunities.id, renewal.opportunityId)).limit(1)
      )[0];
      expect(opp.isWon).toBe(true);
      expect(opp.stage).toBe('closed_won');
    }

    expect(await ledgerTotal()).toBe(await accountArrTotal());
  });

  it('churns a renewal and removes its ARR from the base', async () => {
    const ctx = await h.ctx('admin@spoton.dev');

    const renewal = (
      await h.db
        .select()
        .from(s.renewals)
        .where(eq(s.renewals.status, 'not_started'))
        .orderBy(s.renewals.renewalDate)
        .limit(1)
    )[0];
    expect(renewal).toBeTruthy();

    const accountBefore = (
      await h.db.select().from(s.accounts).where(eq(s.accounts.id, renewal.accountId)).limit(1)
    )[0];

    const result = await churnRenewal(renewal.id, 'Consolidated onto another vendor', ctx);
    expect(result.churnedArrCents).toBeGreaterThan(0);

    const sub = (
      await h.db.select().from(s.subscriptions).where(eq(s.subscriptions.id, renewal.subscriptionId)).limit(1)
    )[0];
    expect(sub.status).toBe('expired');
    expect(sub.currentArrCents).toBe(0);

    const accountAfter = (
      await h.db.select().from(s.accounts).where(eq(s.accounts.id, renewal.accountId)).limit(1)
    )[0];
    expect(accountAfter.currentArrCents).toBeLessThan(accountBefore.currentArrCents);

    const churn = await h.db
      .select()
      .from(s.arrMovements)
      .where(and(eq(s.arrMovements.subscriptionId, sub.id), eq(s.arrMovements.type, 'churn')));
    expect(churn.length).toBe(1);
    expect(churn[0].arrDeltaCents).toBe(-result.churnedArrCents);

    // The ledger still ties after a churn.
    expect(await ledgerTotal()).toBe(await accountArrTotal());
  });
});
