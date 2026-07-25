'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser, auditContext } from '@/server/session';
import { create, remove, update } from '@/server/repository';
import { editableFields, getObject } from '@/server/objects';
import { AccessError, NotFoundError, ValidationError } from '@/server/rbac';

export type FormState = {
  error?: string;
  failures?: { field: string; message: string }[];
};

function collect(objectKey: string, formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of editableFields(objectKey)) {
    if (field.type === 'boolean') {
      // An unchecked box submits nothing, so absence means false.
      out[field.name] = formData.get(field.name) !== null;
      continue;
    }
    if (!formData.has(field.name)) continue;
    const raw = formData.get(field.name);
    out[field.name] = raw === '' ? null : raw;
  }
  return out;
}

function toState(err: unknown): FormState {
  if (err instanceof ValidationError) {
    return { error: err.message, failures: err.failures };
  }
  if (err instanceof AccessError || err instanceof NotFoundError) {
    return { error: err.message };
  }
  return { error: err instanceof Error ? err.message : 'Unexpected error' };
}

export async function saveRecord(
  objectKey: string,
  id: string | null,
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const ctx = await auditContext('ui');
  const data = collect(objectKey, formData);

  let savedId = id;
  try {
    if (id) {
      await update(user, objectKey, id, data, ctx);
    } else {
      const created = await create(user, objectKey, data, ctx);
      savedId = String(created.id);
    }
  } catch (err) {
    return toState(err);
  }

  revalidatePath(`/o/${objectKey}`);
  if (savedId) revalidatePath(`/o/${objectKey}/${savedId}`);
  redirect(`/o/${objectKey}/${savedId}`);
}

export async function deleteRecord(objectKey: string, id: string): Promise<void> {
  const user = await requireUser();
  const ctx = await auditContext('ui');
  await remove(user, objectKey, id, ctx);
  revalidatePath(`/o/${objectKey}`);
  redirect(`/o/${objectKey}`);
}

/** Reference picker options, so a form can offer real records rather than raw ids. */
export async function referenceOptions(
  targetObject: string,
  limit = 200,
): Promise<{ id: string; label: string }[]> {
  await requireUser();
  const { listRaw } = await import('@/server/repository');
  const def = getObject(targetObject);
  const rows = await listRaw(targetObject, [], { limit });

  return rows
    .map((r) => ({
      id: String(r.id),
      label:
        targetObject === 'contacts'
          ? `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || String(r.id)
          : String(r[def.nameField] ?? r.id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
