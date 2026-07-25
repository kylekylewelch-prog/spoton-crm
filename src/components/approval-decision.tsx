'use client';

import { useActionState } from 'react';
import { decide, type DecisionState } from '@/app/(app)/approvals/actions';

/**
 * Approve or reject controls for one chain step. Both actions share a comment box,
 * and rejection requires it — the next person needs to know what to change.
 */
export function ApprovalDecision({
  requestId,
  canDecide,
  reason,
}: {
  requestId: string;
  canDecide: boolean;
  reason?: string;
}) {
  const [approveState, approveAction, approving] = useActionState<DecisionState | null, FormData>(
    decide.bind(null, requestId, 'approved'),
    null,
  );
  const [rejectState, rejectAction, rejecting] = useActionState<DecisionState | null, FormData>(
    decide.bind(null, requestId, 'rejected'),
    null,
  );

  const state = approveState ?? rejectState;

  if (!canDecide) {
    return (
      <div style={{ fontSize: '0.6875rem', color: 'var(--fg-muted)' }}>
        {reason ?? 'Awaiting another approver'}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '0.375rem', minWidth: 260 }}>
      <textarea
        className="field"
        name="comments"
        rows={2}
        placeholder="Decision comments (required to reject)"
        form={`approve-${requestId}`}
      />
      <div style={{ display: 'flex', gap: '0.375rem' }}>
        <form action={approveAction} id={`approve-${requestId}`}>
          <button className="btn btn-primary" type="submit" disabled={approving || rejecting}>
            {approving ? 'Approving…' : 'Approve'}
          </button>
        </form>
        <form action={rejectAction}>
          <textarea name="comments" hidden readOnly value="" />
          <button className="btn btn-danger" type="submit" disabled={approving || rejecting}>
            {rejecting ? 'Rejecting…' : 'Reject'}
          </button>
        </form>
      </div>

      {state?.error && (
        <div style={{ fontSize: '0.625rem', color: 'var(--color-alarm-400)', fontWeight: 700 }}>
          {state.error}
        </div>
      )}
      {state?.ok && (
        <div style={{ fontSize: '0.625rem', color: 'var(--color-good-400)', fontWeight: 700 }}>
          {state.ok}
        </div>
      )}
    </div>
  );
}
