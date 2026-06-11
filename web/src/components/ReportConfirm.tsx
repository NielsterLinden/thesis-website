import { useState } from 'react';
import { ApiError } from '../api';
import { ReportProposal } from '../types';

type SaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'saved'; url: string }
  | { phase: 'dismissed' }
  | { phase: 'error'; message: string };

/**
 * The human half of the two-call write protocol: shows the validator's
 * plain-language summary and only on an explicit click POSTs the (opaque,
 * server-validated) spec to /reports/save. The model can neither render this
 * card nor click it — that is the security boundary, not a UX nicety.
 */
export function ReportConfirm({
  proposal,
  onSave,
}: {
  proposal: ReportProposal;
  onSave: (spec: unknown) => Promise<{ url: string }>;
}) {
  const [state, setState] = useState<SaveState>({ phase: 'idle' });

  if (state.phase === 'dismissed') return null;

  async function confirm() {
    setState({ phase: 'saving' });
    try {
      const { url } = await onSave(proposal.spec);
      setState({ phase: 'saved', url });
    } catch (err) {
      const message =
        err instanceof ApiError ? `(${err.status}) ${err.message}` : 'Could not reach the server.';
      setState({ phase: 'error', message });
    }
  }

  return (
    <div className="report-confirm">
      <div className="report-confirm-head">Draft W&amp;B report — awaiting your confirmation</div>
      <pre className="report-confirm-summary">{proposal.summary}</pre>

      {state.phase === 'saved' ? (
        <div className="report-confirm-saved">
          Draft saved.{' '}
          <a href={state.url} target="_blank" rel="noreferrer">
            Open it in W&amp;B
          </a>{' '}
          — it stays a draft until you publish it there yourself.
        </div>
      ) : (
        <div className="report-confirm-actions">
          <button onClick={() => void confirm()} disabled={state.phase === 'saving'}>
            {state.phase === 'saving' ? 'Saving draft…' : 'Confirm — save draft report'}
          </button>
          <button
            className="ghost"
            onClick={() => setState({ phase: 'dismissed' })}
            disabled={state.phase === 'saving'}
          >
            Dismiss
          </button>
          {state.phase === 'error' && <span className="report-confirm-error">{state.message}</span>}
        </div>
      )}
    </div>
  );
}
