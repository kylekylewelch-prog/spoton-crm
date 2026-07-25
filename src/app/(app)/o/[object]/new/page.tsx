import { notFound } from 'next/navigation';
import { requireUser } from '@/server/session';
import { OBJECTS, editableFields, getObject } from '@/server/objects';
import { can, fieldAccess } from '@/server/rbac';
import { PageHeader, Panel, Empty } from '@/components/ui';
import { RecordForm } from '@/components/record-form';
import { referenceOptions } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewRecordPage({
  params,
}: {
  params: Promise<{ object: string }>;
}) {
  const { object } = await params;
  if (!OBJECTS[object]) notFound();

  const user = await requireUser();
  const def = getObject(object);

  if (!can(user, object, 'create') || def.systemManaged) {
    return (
      <>
        <PageHeader title={`New ${def.label}`} />
        <Panel>
          <Empty>
            {def.systemManaged
              ? `${def.labelPlural} are created by the platform — book a deal or run the relevant workflow instead.`
              : `Your role (${user.roleName}) cannot create ${def.labelPlural.toLowerCase()}.`}
          </Empty>
        </Panel>
      </>
    );
  }

  const fields = editableFields(object).filter(
    (f) => fieldAccess(user, object, f.name) === 'write',
  );

  const references: Record<string, { id: string; label: string }[]> = {};
  for (const f of fields) {
    if (f.type === 'reference' && f.referenceTo && OBJECTS[f.referenceTo]) {
      references[f.name] = await referenceOptions(f.referenceTo);
    }
  }

  return (
    <>
      <PageHeader title={`New ${def.label}`} subtitle={def.description} />
      <RecordForm
        objectKey={object}
        objectLabel={def.label}
        recordId={null}
        fields={fields}
        values={{}}
        references={references}
        readOnlyFields={[]}
      />
    </>
  );
}
