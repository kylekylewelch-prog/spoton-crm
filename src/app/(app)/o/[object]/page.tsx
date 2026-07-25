import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/session';
import { OBJECTS, getObject, listFields, searchableFields } from '@/server/objects';
import { can } from '@/server/rbac';
import { list, type Filter } from '@/server/repository';
import { Empty, PageHeader, Panel } from '@/components/ui';
import { FieldValue } from '@/components/field-value';

export const dynamic = 'force-dynamic';

/**
 * Generic list view.
 *
 * Columns, search targets, sorting and filtering all come from the object
 * registry, so every registered object — including ones added later — gets a
 * working, permission-aware list screen with no bespoke code.
 */
export default async function ObjectListPage({
  params,
  searchParams,
}: {
  params: Promise<{ object: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { object } = await params;
  const query = await searchParams;

  if (!OBJECTS[object]) notFound();

  const user = await requireUser();
  if (!can(user, object, 'read')) {
    return (
      <>
        <PageHeader title="Not permitted" />
        <Panel>
          <Empty>
            Your role ({user.roleName}) does not have read access to{' '}
            {getObject(object).labelPlural.toLowerCase()}.
          </Empty>
        </Panel>
      </>
    );
  }

  const def = getObject(object);
  const columns = listFields(object);
  const searchable = searchableFields(object);

  const search = typeof query.q === 'string' ? query.q : '';
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = 50;
  const sortField = typeof query.sort === 'string' ? query.sort : undefined;
  const sortDir = query.dir === 'asc' ? 'asc' : 'desc';

  // Any ?field=value pair that names a real field becomes an equality filter.
  const filters: Filter[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (['q', 'page', 'sort', 'dir'].includes(key)) continue;
    if (typeof value !== 'string' || value === '') continue;
    if (def.fields.some((f) => f.name === key)) {
      filters.push({ field: key, op: 'eq', value });
    }
  }

  const result = await list(user, object, {
    search,
    filters,
    sort: sortField ? { field: sortField, direction: sortDir } : undefined,
    limit,
    offset: (page - 1) * limit,
  });

  const pages = Math.max(1, Math.ceil(result.total / limit));

  return (
    <>
      <PageHeader
        title={def.labelPlural}
        subtitle={def.description}
        action={
          can(user, object, 'create') && !def.systemManaged ? (
            <Link href={`/o/${object}/new`} className="btn btn-primary">
              New {def.label}
            </Link>
          ) : def.systemManaged ? (
            <span className="tag" title="Maintained by the platform">
              System managed
            </span>
          ) : null
        }
      />

      <Panel
        title={`${result.total.toLocaleString('en-US')} records`}
        action={
          searchable.length > 0 ? (
            <form style={{ display: 'flex', gap: '0.375rem' }}>
              <input
                className="field"
                name="q"
                defaultValue={search}
                placeholder={`Search ${searchable.map((f) => f.label.toLowerCase()).join(', ')}`}
                style={{ width: 260 }}
              />
              <button className="btn" type="submit">
                Search
              </button>
            </form>
          ) : null
        }
      >
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.name}>
                    <Link
                      href={`/o/${object}?sort=${col.name}&dir=${
                        sortField === col.name && sortDir === 'desc' ? 'asc' : 'desc'
                      }${search ? `&q=${encodeURIComponent(search)}` : ''}`}
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      {col.label}
                      {sortField === col.name ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </Link>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={String(row.id)}>
                  {columns.map((col, i) => (
                    <td
                      key={col.name}
                      className={
                        ['money', 'number', 'bps', 'percent'].includes(col.type) ? 'num' : undefined
                      }
                    >
                      {i === 0 ? (
                        <Link href={`/o/${object}/${String(row.id)}`}>
                          <FieldValue field={col} value={row[col.name]} objectKey={object} />
                        </Link>
                      ) : (
                        <FieldValue field={col} value={row[col.name]} objectKey={object} />
                      )}
                    </td>
                  ))}
                  <td className="num">
                    <Link href={`/o/${object}/${String(row.id)}`} className="btn">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {result.rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1}>
                    <Empty>
                      {search
                        ? `No ${def.labelPlural.toLowerCase()} match “${search}”.`
                        : `No ${def.labelPlural.toLowerCase()} yet.`}
                    </Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.625rem 0.875rem',
              borderTop: '1px solid var(--rule)',
              fontSize: '0.75rem',
            }}
          >
            <span style={{ color: 'var(--fg-muted)' }}>
              Page {page} of {pages}
            </span>
            <span style={{ display: 'flex', gap: '0.375rem' }}>
              {page > 1 && (
                <Link
                  className="btn"
                  href={`/o/${object}?page=${page - 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
                >
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link
                  className="btn"
                  href={`/o/${object}?page=${page + 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
                >
                  Next
                </Link>
              )}
            </span>
          </div>
        )}
      </Panel>
    </>
  );
}
