import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq, inArray } from 'drizzle-orm';
import { requireUser } from '@/server/session';
import { OBJECTS, getObject, listFields } from '@/server/objects';
import { can, fieldAccess, NotFoundError } from '@/server/rbac';
import { get, listRaw } from '@/server/repository';
import { auditHistory } from '@/server/audit';
import { getDb } from '@/db';
import { Empty, KeyValue, PageHeader, Panel } from '@/components/ui';
import { FieldValue } from '@/components/field-value';
import { dateTime, humanise, truncate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Generic detail view.
 *
 * Sections, related lists and the audit trail are all generated from the object
 * registry. Reference fields are resolved to their display names here — a detail
 * page is the one place worth the extra queries to avoid showing raw ids.
 */
export default async function ObjectDetailPage({
  params,
}: {
  params: Promise<{ object: string; id: string }>;
}) {
  const { object, id } = await params;
  if (!OBJECTS[object]) notFound();

  const user = await requireUser();
  const def = getObject(object);

  if (!can(user, object, 'read')) {
    return (
      <>
        <PageHeader title="Not permitted" />
        <Panel>
          <Empty>Your role does not have read access to {def.labelPlural.toLowerCase()}.</Empty>
        </Panel>
      </>
    );
  }

  // `new` is handled by its own route; anything else must resolve to a record.
  let record: Record<string, unknown>;
  try {
    record = await get(user, object, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const db = await getDb();

  /* --- resolve reference labels ----------------------------------------- */
  const referenceFields = def.fields.filter(
    (f) => f.type === 'reference' && f.referenceTo && record[f.name],
  );

  const labels = new Map<string, string>();
  const byTarget = new Map<string, string[]>();
  for (const f of referenceFields) {
    const target = f.referenceTo!;
    if (!OBJECTS[target]) continue;
    const ids = byTarget.get(target) ?? [];
    ids.push(String(record[f.name]));
    byTarget.set(target, ids);
  }

  for (const [target, ids] of byTarget) {
    const targetDef = getObject(target);
    const rows = await db
      .select()
      .from(targetDef.table)
      .where(inArray(targetDef.table.id, ids));
    for (const row of rows as Record<string, unknown>[]) {
      const display =
        target === 'contacts'
          ? `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim()
          : String(row[targetDef.nameField] ?? row.id);
      labels.set(`${target}:${String(row.id)}`, display);
    }
  }

  const displayName =
    object === 'contacts'
      ? `${record.firstName ?? ''} ${record.lastName ?? ''}`.trim()
      : String(record[def.nameField] ?? record.id);

  /* --- group fields into sections --------------------------------------- */
  const visible = def.fields.filter((f) => fieldAccess(user, object, f.name) !== 'hidden');
  const sections = new Map<string, typeof visible>();
  for (const f of visible) {
    const key = f.section ?? 'Details';
    const arr = sections.get(key) ?? [];
    arr.push(f);
    sections.set(key, arr);
  }

  const renderValue = (f: (typeof visible)[number]) => {
    if (f.type === 'reference' && f.referenceTo && record[f.name]) {
      const key = `${f.referenceTo}:${String(record[f.name])}`;
      const label = labels.get(key);
      if (label) {
        return (
          <Link href={`/o/${f.referenceTo}/${String(record[f.name])}`}>{label}</Link>
        );
      }
    }
    return <FieldValue field={f} value={record[f.name]} objectKey={object} />;
  };

  /* --- related lists ----------------------------------------------------- */
  const related: {
    label: string;
    object: string;
    rows: Record<string, unknown>[];
    columns: ReturnType<typeof listFields>;
  }[] = [];

  for (const rel of def.relatedLists ?? []) {
    if (!OBJECTS[rel.object] || !can(user, rel.object, 'read')) continue;
    const relDef = getObject(rel.object);
    if (!relDef.table[rel.foreignKey]) continue;

    const rows = await listRaw(rel.object, [{ field: rel.foreignKey, op: 'eq', value: id }], {
      limit: 12,
    });
    related.push({
      label: rel.label,
      object: rel.object,
      rows,
      columns: listFields(rel.object).slice(0, 6),
    });
  }

  const history = await auditHistory(object, id, 40);

  return (
    <>
      <PageHeader
        title={displayName || def.label}
        subtitle={`${def.label} · ${id}`}
        action={
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            <Link href={`/o/${object}`} className="btn">
              All {def.labelPlural}
            </Link>
            {can(user, object, 'update') && (
              <Link href={`/o/${object}/${id}/edit`} className="btn btn-primary">
                Edit
              </Link>
            )}
          </div>
        }
      />

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {[...sections.entries()].map(([sectionName, fields]) => (
          <Panel key={sectionName} title={sectionName}>
            <KeyValue
              items={fields.map((f) => ({
                label: f.label,
                value: (
                  <>
                    {renderValue(f)}
                    {f.help && (
                      <div
                        style={{
                          fontSize: '0.625rem',
                          color: 'var(--fg-muted)',
                          marginTop: 2,
                        }}
                      >
                        {f.help}
                      </div>
                    )}
                  </>
                ),
              }))}
            />
          </Panel>
        ))}

        {related.map((rel) => (
          <Panel
            key={rel.label}
            title={rel.label}
            action={
              <Link href={`/o/${rel.object}`} className="btn">
                All
              </Link>
            }
          >
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    {rel.columns.map((c) => (
                      <th key={c.name}>{c.label}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rel.rows.map((row) => (
                    <tr key={String(row.id)}>
                      {rel.columns.map((c) => (
                        <td
                          key={c.name}
                          className={
                            ['money', 'number', 'bps', 'percent'].includes(c.type)
                              ? 'num'
                              : undefined
                          }
                        >
                          <FieldValue field={c} value={row[c.name]} objectKey={rel.object} />
                        </td>
                      ))}
                      <td className="num">
                        <Link href={`/o/${rel.object}/${String(row.id)}`} className="btn">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {rel.rows.length === 0 && (
                    <tr>
                      <td colSpan={rel.columns.length + 1}>
                        <Empty>No {rel.label.toLowerCase()} yet.</Empty>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}

        <Panel
          title="Audit history"
          eyebrow="Who changed what, when, from where and why"
        >
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Field</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Source</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{dateTime(h.at)}</td>
                    <td>
                      <span className="tag">{humanise(h.action)}</span>
                    </td>
                    <td>{h.field ? humanise(h.field) : '—'}</td>
                    <td style={{ color: 'var(--fg-muted)' }}>{truncate(h.oldValue, 28)}</td>
                    <td>{truncate(h.newValue, 28)}</td>
                    <td style={{ fontSize: '0.6875rem' }}>{h.source}</td>
                    <td style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)' }}>
                      {truncate(h.reason, 40)}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <Empty>No recorded changes.</Empty>
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
