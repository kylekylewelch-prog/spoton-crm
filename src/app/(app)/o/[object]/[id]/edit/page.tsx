import { notFound } from 'next/navigation';
import { requireUser } from '@/server/session';
import { OBJECTS, editableFields, getObject } from '@/server/objects';
import { can, fieldAccess, NotFoundError } from '@/server/rbac';
import { get } from '@/server/repository';
import { Empty, PageHeader, Panel } from '@/components/ui';
import { RecordForm } from '@/components/record-form';
import { referenceOptions } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function EditRecordPage({
  params,
}: {
  params: Promise<{ object: string; id: string }>;
}) {
  const { object, id } = await params;
  if (!OBJECTS[object]) notFound();

  const user = await requireUser();
  const def = getObject(object);

  if (!can(user, object, 'update')) {
    return (
      <>
        <PageHeader title={`Edit ${def.label}`} />
        <Panel>
          <Empty>Your role ({user.roleName}) cannot edit {def.labelPlural.toLowerCase()}.</Empty>
        </Panel>
      </>
    );
  }

  let record: Record<string, unknown>;
  try {
    record = await get(user, object, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const all = editableFields(object);
  const fields = all.filter((f) => fieldAccess(user, object, f.name) !== 'hidden');
  const readOnlyFields = fields
    .filter((f) => fieldAccess(user, object, f.name) === 'read')
    .map((f) => f.name);

  const references: Record<string, { id: string; label: string }[]> = {};
  for (const f of fields) {
    if (f.type === 'reference' && f.referenceTo && OBJECTS[f.referenceTo]) {
      references[f.name] = await referenceOptions(f.referenceTo);
    }
  }

  const displayName =
    object === 'contacts'
      ? `${record.firstName ?? ''} ${record.lastName ?? ''}`.trim()
      : String(record[def.nameField] ?? id);

  return (
    <>
      <PageHeader
        title={`Edit ${displayName}`}
        subtitle={
          readOnlyFields.length > 0
            ? `${readOnlyFields.length} field(s) are read-only for your role and shown greyed out.`
            : def.description
        }
      />
      <RecordForm
        objectKey={object}
        objectLabel={def.label}
        recordId={id}
        fields={fields}
        values={record}
        references={references}
        readOnlyFields={readOnlyFields}
      />
    </>
  );
}
