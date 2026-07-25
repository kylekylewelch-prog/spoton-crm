'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, auditContext } from '@/server/session';
import { decideApproval } from '@/server/services/quotes';
import { ValidationError } from '@/server/rbac';

export type DecisionState = { error?: string; ok?: string };

export async function decide(
  requestId: string,
  decision: 'approved' | 'rejected',
  _prev: DecisionState | null,
  formData: FormData,
): Promise<DecisionState> {
  const user = await requireUser();
  const ctx = await auditContext('ui');
  const comments = String(formData.get('comments') ?? '').trim() || null;

  // A rejection without a reason is useless to the person who has to rework it.
  if (decision === 'rejected' && !comments) {
    return { error: 'Explain why this is being rejected so the deal can be reworked.' };
  }

  try {
    const result = await decideApproval(user, requestId, decision, comments, ctx);
    revalidatePath('/approvals');
    return {
      ok:
        result.requestStatus === 'pending'
          ? `Approved. Now with step ${result.nextStep} of the chain.`
          : `Request ${result.requestStatus}${result.recordStatus ? ` — quote ${result.recordStatus}` : ''}.`,
    };
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    return { error: err instanceof Error ? err.message : 'Unexpected error' };
  }
}
