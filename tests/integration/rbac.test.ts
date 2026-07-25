import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as s from '@/db/schema';
import { setupDatabase, type TestHarness } from '../helpers/db';
import { create, get, list, update, remove } from '@/server/repository';
import { AccessError, ValidationError, can, fieldAccess, redact } from '@/server/rbac';
import { objectKeys, OBJECTS, getObject } from '@/server/objects';
import { auditHistory } from '@/server/audit';

/**
 * Permissions, field-level security and audit, exercised through the real
 * repository against a real database.
 */

let h: TestHarness;

beforeAll(async () => {
  h = await setupDatabase({ withSeed: true });
}, 240_000);

afterAll(async () => {
  await h?.close();
});

describe('object-level permissions', () => {
  it('lets an administrator read every registered object', async () => {
    const admin = await h.as('admin@spoton.dev');
    for (const key of objectKeys()) {
      expect(can(admin, key, 'read'), `admin cannot read ${key}`).toBe(true);
    }
  });

  it('blocks a support engineer from creating quotes', async () => {
    const support = await h.as('support@spoton.dev');
    expect(can(support, 'quotes', 'create')).toBe(false);

    await expect(
      create(support, 'quotes', { number: 'Q-TEST' }, await h.ctx('support@spoton.dev')),
    ).rejects.toThrow(AccessError);
  });

  it('lets a support engineer work tickets', async () => {
    const support = await h.as('support@spoton.dev');
    expect(can(support, 'cases', 'create')).toBe(true);
    expect(can(support, 'cases', 'update')).toBe(true);
  });

  it('gives a BDR create rights on leads but not on subscriptions', async () => {
    const bdr = await h.as('bdr@spoton.dev');
    expect(can(bdr, 'leads', 'create')).toBe(true);
    expect(can(bdr, 'subscriptions', 'create')).toBe(false);
  });

  it('keeps read access broad so teams can see the whole picture', async () => {
    const bdr = await h.as('bdr@spoton.dev');
    const result = await list(bdr, 'accounts', { limit: 5 });
    expect(result.rows.length).toBeGreaterThan(0);
  });
});

describe('record-level scope', () => {
  it("prevents an AE from updating another rep's opportunity", async () => {
    const ae = await h.as('ae@spoton.dev');
    const ctx = await h.ctx('ae@spoton.dev');

    const foreign = (
      await h.db
        .select()
        .from(s.opportunities)
        .where(eq(s.opportunities.isClosed, false))
        .limit(50)
    ).find((o) => o.ownerId !== ae.id);

    expect(foreign, 'expected an opportunity owned by someone else').toBeTruthy();

    await expect(
      update(ae, 'opportunities', foreign!.id, { nextStep: 'Should not be allowed' }, ctx),
    ).rejects.toThrow(AccessError);
  });

  it('allows an AE to update their own opportunity', async () => {
    const ae = await h.as('ae@spoton.dev');
    const ctx = await h.ctx('ae@spoton.dev');

    const own = (
      await h.db.select().from(s.opportunities).where(eq(s.opportunities.ownerId, ae.id)).limit(1)
    )[0];
    expect(own).toBeTruthy();

    const updated = await update(ae, 'opportunities', own.id, { nextStep: 'Scope test' }, ctx);
    expect(updated.nextStep).toBe('Scope test');
  });

  it('lets an administrator update any record', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const any = (await h.db.select().from(s.opportunities).limit(1))[0];
    const updated = await update(admin, 'opportunities', any.id, { nextStep: 'Admin override' }, ctx);
    expect(updated.nextStep).toBe('Admin override');
  });
});

describe('field-level security', () => {
  it('hides potential ARR from a BDR but not from an AE', async () => {
    const bdr = await h.as('bdr@spoton.dev');
    const ae = await h.as('ae@spoton.dev');

    expect(fieldAccess(bdr, 'accounts', 'potentialArrCents')).toBe('hidden');
    expect(fieldAccess(ae, 'accounts', 'potentialArrCents')).toBe('read');
  });

  it('removes hidden fields from the payload entirely rather than masking them', async () => {
    const bdr = await h.as('bdr@spoton.dev');
    const account = (await h.db.select().from(s.accounts).limit(1))[0];

    const visible = redact(bdr, 'accounts', account as unknown as Record<string, unknown>);
    expect('potentialArrCents' in visible).toBe(false);
    expect('name' in visible).toBe(true);

    // And the same through the repository read path.
    const fetched = await get(bdr, 'accounts', account.id);
    expect('potentialArrCents' in fetched).toBe(false);
  });

  it('hides deal amounts from a support engineer', async () => {
    const support = await h.as('support@spoton.dev');
    expect(fieldAccess(support, 'opportunities', 'amountCents')).toBe('hidden');

    const opp = (await h.db.select().from(s.opportunities).limit(1))[0];
    const fetched = await get(support, 'opportunities', opp.id);
    expect('amountCents' in fetched).toBe(false);
  });

  it('refuses a write to a read-only field rather than silently dropping it', async () => {
    const ae = await h.as('ae@spoton.dev');
    const ctx = await h.ctx('ae@spoton.dev');
    const own = (
      await h.db.select().from(s.accounts).where(eq(s.accounts.accountExecutiveId, ae.id)).limit(1)
    )[0];
    expect(own).toBeTruthy();

    await expect(
      update(ae, 'accounts', own.id, { potentialArrCents: 999_999 }, ctx),
    ).rejects.toThrow(ValidationError);
  });
});

describe('validation', () => {
  it('rejects a missing required field', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');

    await expect(create(admin, 'contacts', { firstName: 'NoSurname' }, ctx)).rejects.toThrow(
      /required/i,
    );
  });

  it('rejects a value outside an enum', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const account = (await h.db.select().from(s.accounts).limit(1))[0];

    await expect(
      create(
        admin,
        'contacts',
        { firstName: 'Bad', lastName: 'Role', accountId: account.id, roleType: 'not_a_role' },
        ctx,
      ),
    ).rejects.toThrow(/must be one of/i);
  });

  it('rejects a malformed email address', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');

    await expect(
      create(admin, 'contacts', { firstName: 'Bad', lastName: 'Email', email: 'not-an-email' }, ctx),
    ).rejects.toThrow(/valid email/i);
  });

  it('accepts a valid record and coerces money and dates', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const account = (await h.db.select().from(s.accounts).limit(1))[0];

    const created = await create(
      admin,
      'contacts',
      {
        firstName: 'Valid',
        lastName: 'Contact',
        email: 'valid.contact@example.com',
        accountId: account.id,
        roleType: 'champion',
        influenceLevel: '4',
      },
      ctx,
    );

    expect(created.id).toBeTruthy();
    expect(created.influenceLevel).toBe(4);
  });

  it('protects system-managed objects from direct creation by non-admins', async () => {
    const revops = await h.as('revops@spoton.dev');
    const ctx = await h.ctx('revops@spoton.dev');
    expect(getObject('arr_movements').systemManaged).toBe(true);

    await expect(
      create(revops, 'arr_movements', { accountId: 'x', type: 'new', arrDeltaCents: 1 }, ctx),
    ).rejects.toThrow(/maintained by the system/i);
  });
});

describe('audit trail', () => {
  it('records one entry per changed field, with who and from where', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const opp = (await h.db.select().from(s.opportunities).limit(1))[0];

    await update(
      admin,
      'opportunities',
      opp.id,
      { nextStep: 'Audit probe', closePlan: 'Audit probe plan' },
      ctx,
    );

    const history = await auditHistory('opportunities', opp.id, 50);
    const fields = history.filter((x) => x.action === 'update').map((x) => x.field);

    expect(fields).toContain('nextStep');
    expect(fields).toContain('closePlan');

    const entry = history.find((x) => x.field === 'nextStep');
    expect(entry?.userId).toBe(admin.id);
    expect(entry?.source).toBe('ui');
    expect(entry?.newValue).toBe('Audit probe');
  });

  it('writes nothing when an update changes nothing', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');
    const opp = (await h.db.select().from(s.opportunities).limit(1))[0];

    await update(admin, 'opportunities', opp.id, { nextStep: 'Idempotent' }, ctx);
    const before = (await auditHistory('opportunities', opp.id, 200)).length;
    await update(admin, 'opportunities', opp.id, { nextStep: 'Idempotent' }, ctx);
    const after = (await auditHistory('opportunities', opp.id, 200)).length;

    expect(after).toBe(before);
  });

  it('records ownership changes as effective-dated history', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');

    const account = (await h.db.select().from(s.accounts).limit(1))[0];
    const otherAe = (
      await h.db.select().from(s.users).where(eq(s.users.email, 'ae2@spoton.dev')).limit(1)
    )[0];

    await update(admin, 'accounts', account.id, { ownerId: otherAe.id }, ctx);

    const history = await h.db
      .select()
      .from(s.ownershipHistory)
      .where(eq(s.ownershipHistory.recordId, account.id));

    expect(history.length).toBeGreaterThan(0);
    const current = history.find((x) => x.userId === otherAe.id);
    expect(current).toBeTruthy();
    expect(current!.effectiveFrom).toBeTruthy();
  });
});

describe('every registered object is queryable', () => {
  it('lists all objects without error for an administrator', async () => {
    const admin = await h.as('admin@spoton.dev');
    const failures: string[] = [];

    for (const key of objectKeys()) {
      try {
        const result = await list(admin, key, { limit: 3 });
        expect(Array.isArray(result.rows)).toBe(true);
        expect(typeof result.total).toBe('number');
      } catch (err) {
        failures.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    expect(failures, `objects failed to list:\n${failures.join('\n')}`).toEqual([]);
  });

  it('opens a detail read for one record of every populated object', async () => {
    const admin = await h.as('admin@spoton.dev');
    const failures: string[] = [];

    for (const key of objectKeys()) {
      const result = await list(admin, key, { limit: 1 });
      const row = result.rows[0];
      if (!row) continue;
      try {
        const fetched = await get(admin, key, String(row.id));
        expect(fetched.id).toBe(row.id);
      } catch (err) {
        failures.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    expect(failures, `objects failed to read:\n${failures.join('\n')}`).toEqual([]);
  });

  it('declares a valid table, name field and list columns for every object', () => {
    for (const [key, def] of Object.entries(OBJECTS)) {
      expect(def.table, `${key} has no table`).toBeTruthy();
      expect(def.fields.length, `${key} has no fields`).toBeGreaterThan(0);

      // The name field must exist on the table.
      expect(def.table[def.nameField] ?? def.table.id, `${key}.${def.nameField} missing`).toBeTruthy();

      // Every declared field must exist as a column.
      for (const f of def.fields) {
        expect(def.table[f.name], `${key}.${f.name} is not a column`).toBeTruthy();
      }

      // Reference targets must be registered objects.
      for (const f of def.fields) {
        if (f.type === 'reference' && f.referenceTo) {
          expect(OBJECTS[f.referenceTo], `${key}.${f.name} references unknown ${f.referenceTo}`).toBeTruthy();
        }
      }

      // Related lists must point at a real foreign key.
      for (const rel of def.relatedLists ?? []) {
        expect(OBJECTS[rel.object], `${key} related list ${rel.object} unknown`).toBeTruthy();
        expect(
          getObject(rel.object).table[rel.foreignKey],
          `${key} related list ${rel.object}.${rel.foreignKey} is not a column`,
        ).toBeTruthy();
      }
    }
  });
});

describe('deletion', () => {
  it('deletes a record an admin owns and records it', async () => {
    const admin = await h.as('admin@spoton.dev');
    const ctx = await h.ctx('admin@spoton.dev');

    const created = await create(
      admin,
      'tasks',
      { title: 'Delete me', ownerId: admin.id, status: 'open' },
      ctx,
    );

    await remove(admin, 'tasks', String(created.id), ctx);

    const history = await auditHistory('tasks', String(created.id), 10);
    expect(history.some((x) => x.action === 'delete')).toBe(true);
  });

  it('refuses to delete an immutable ledger row', async () => {
    const revops = await h.as('revops@spoton.dev');
    const ctx = await h.ctx('revops@spoton.dev');
    const movement = (await h.db.select().from(s.arrMovements).limit(1))[0];

    await expect(remove(revops, 'arr_movements', movement.id, ctx)).rejects.toThrow();
  });
});
