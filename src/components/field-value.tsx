import Link from 'next/link';
import type { FieldDef } from '@/server/objects';
import { date, dateTime, humanise, money, num, pct, truncate } from '@/lib/format';
import { Tag } from './ui';

/**
 * Renders a field according to its declared type.
 *
 * One implementation for every object, so a money column is always right-aligned
 * integer cents and a reference is always a link — consistency here is what makes
 * sixty generated screens feel like one product.
 */
export function FieldValue({
  field,
  value,
  objectKey,
}: {
  field: FieldDef;
  value: unknown;
  objectKey?: string;
}) {
  if (value === null || value === undefined || value === '') {
    return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
  }

  switch (field.type) {
    case 'money':
      return <>{money(Number(value))}</>;

    case 'bps':
      return <>{pct(Number(value))}</>;

    case 'percent':
      return <>{pct(Number(value))}</>;

    case 'number':
      return <>{num(Number(value))}</>;

    case 'boolean':
      return value ? (
        <span className="tag tag-good">Yes</span>
      ) : (
        <span style={{ color: 'var(--fg-muted)' }}>No</span>
      );

    case 'date':
      return <>{date(String(value))}</>;

    case 'datetime':
      return <>{dateTime(value as string | Date)}</>;

    case 'enum':
      return <Tag value={String(value)} label={humanise(String(value))} />;

    case 'reference': {
      const id = String(value);
      if (!field.referenceTo) return <>{id}</>;
      return (
        <Link href={`/o/${field.referenceTo}/${id}`} title={id}>
          {/* The id is shown until the referenced record is resolved by the
              detail view, which loads display names for its own references. */}
          <code style={{ fontSize: '0.6875rem' }}>{id.slice(0, 14)}…</code>
        </Link>
      );
    }

    case 'email':
      return <a href={`mailto:${String(value)}`}>{String(value)}</a>;

    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer">
          {truncate(String(value).replace(/^https?:\/\//, ''), 34)}
        </a>
      );

    case 'phone':
      return <a href={`tel:${String(value)}`}>{String(value)}</a>;

    case 'json': {
      const json = Array.isArray(value)
        ? value.length === 0
          ? '—'
          : value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')
        : JSON.stringify(value);
      return (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6875rem',
            color: 'var(--fg-muted)',
          }}
          title={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
        >
          {truncate(json, 60)}
        </span>
      );
    }

    case 'textarea':
      return <span title={String(value)}>{truncate(String(value), 90)}</span>;

    default:
      void objectKey;
      return <>{truncate(String(value), 70)}</>;
  }
}

/** Resolved reference display, used where the label has been looked up. */
export function ReferenceLink({
  objectKey,
  id,
  label,
}: {
  objectKey: string;
  id: string | null | undefined;
  label: string | null | undefined;
}) {
  if (!id) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
  return <Link href={`/o/${objectKey}/${id}`}>{label ?? id}</Link>;
}
