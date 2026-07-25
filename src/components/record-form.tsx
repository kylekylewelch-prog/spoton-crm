'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { FieldDef } from '@/server/objects';
import { saveRecord, type FormState } from '@/app/(app)/o/[object]/actions';
import { humanise } from '@/lib/format';

/**
 * Generic record form.
 *
 * Inputs are chosen by field type from the registry, and validation failures come
 * back from the same server-side validator the API uses — the form cannot accept
 * something the API would reject.
 */
export function RecordForm({
  objectKey,
  objectLabel,
  recordId,
  fields,
  values,
  references,
  readOnlyFields,
}: {
  objectKey: string;
  objectLabel: string;
  recordId: string | null;
  fields: FieldDef[];
  values: Record<string, unknown>;
  references: Record<string, { id: string; label: string }[]>;
  readOnlyFields: string[];
}) {
  const [state, action, pending] = useActionState<FormState | null, FormData>(
    saveRecord.bind(null, objectKey, recordId),
    null,
  );

  const failureFor = (name: string) => state?.failures?.find((f) => f.field === name)?.message;

  const sections = new Map<string, FieldDef[]>();
  for (const f of fields) {
    const key = f.section ?? 'Details';
    const arr = sections.get(key) ?? [];
    arr.push(f);
    sections.set(key, arr);
  }

  return (
    <form action={action} style={{ display: 'grid', gap: '0.75rem' }}>
      {state?.error && (
        <div
          className="panel"
          style={{
            borderColor: 'var(--color-alarm-500)',
            padding: '0.625rem 0.875rem',
            color: 'var(--color-alarm-400)',
            fontSize: '0.8125rem',
            fontWeight: 700,
          }}
        >
          {state.error}
        </div>
      )}

      {[...sections.entries()].map(([section, sectionFields]) => (
        <section className="panel" key={section}>
          <header className="panel-head">
            <h2 className="panel-title">{section}</h2>
          </header>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '0.75rem',
              padding: '0.875rem',
            }}
          >
            {sectionFields.map((f) => {
              const value = values[f.name];
              const disabled = readOnlyFields.includes(f.name);
              const failure = failureFor(f.name);

              return (
                <div
                  key={f.name}
                  style={{ gridColumn: f.type === 'textarea' || f.type === 'json' ? '1 / -1' : undefined }}
                >
                  <label className="label" htmlFor={f.name}>
                    {f.label}
                    {f.required && <span style={{ color: 'var(--color-alarm-400)' }}> *</span>}
                  </label>

                  {f.type === 'enum' && f.options ? (
                    <select
                      className="field"
                      id={f.name}
                      name={f.name}
                      defaultValue={value === null || value === undefined ? '' : String(value)}
                      disabled={disabled}
                    >
                      <option value="">—</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {humanise(o)}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'reference' && references[f.name] ? (
                    <select
                      className="field"
                      id={f.name}
                      name={f.name}
                      defaultValue={value === null || value === undefined ? '' : String(value)}
                      disabled={disabled}
                    >
                      <option value="">—</option>
                      {references[f.name].map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'boolean' ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        id={f.name}
                        name={f.name}
                        defaultChecked={Boolean(value)}
                        disabled={disabled}
                      />
                      <span style={{ fontSize: '0.75rem' }}>Enabled</span>
                    </label>
                  ) : f.type === 'textarea' ? (
                    <textarea
                      className="field"
                      id={f.name}
                      name={f.name}
                      rows={3}
                      defaultValue={value === null || value === undefined ? '' : String(value)}
                      disabled={disabled}
                    />
                  ) : f.type === 'json' ? (
                    <textarea
                      className="field"
                      id={f.name}
                      name={f.name}
                      rows={3}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
                      defaultValue={
                        value === null || value === undefined ? '' : JSON.stringify(value)
                      }
                      disabled={disabled}
                    />
                  ) : (
                    <input
                      className="field"
                      id={f.name}
                      name={f.name}
                      type={
                        f.type === 'date'
                          ? 'date'
                          : f.type === 'datetime'
                            ? 'datetime-local'
                            : f.type === 'email'
                              ? 'email'
                              : f.type === 'url'
                                ? 'url'
                                : ['number', 'money', 'bps', 'percent'].includes(f.type)
                                  ? 'number'
                                  : 'text'
                      }
                      defaultValue={
                        value === null || value === undefined
                          ? ''
                          : f.type === 'datetime'
                            ? new Date(String(value)).toISOString().slice(0, 16)
                            : String(value)
                      }
                      disabled={disabled}
                    />
                  )}

                  {(f.type === 'money' || f.type === 'bps') && (
                    <div style={{ fontSize: '0.5625rem', color: 'var(--fg-muted)', marginTop: 2 }}>
                      {f.type === 'money'
                        ? 'integer cents — 120000 is $1,200'
                        : 'basis points — 1500 is 15%'}
                    </div>
                  )}
                  {f.help && (
                    <div style={{ fontSize: '0.625rem', color: 'var(--fg-muted)', marginTop: 2 }}>
                      {f.help}
                    </div>
                  )}
                  {failure && (
                    <div
                      style={{
                        fontSize: '0.625rem',
                        color: 'var(--color-alarm-400)',
                        marginTop: 2,
                        fontWeight: 700,
                      }}
                    >
                      {failure}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : recordId ? `Save ${objectLabel}` : `Create ${objectLabel}`}
        </button>
        <Link
          className="btn"
          href={recordId ? `/o/${objectKey}/${recordId}` : `/o/${objectKey}`}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
