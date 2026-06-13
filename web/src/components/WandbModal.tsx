import { useEffect } from 'react';
import { SiteMeta } from '../types';

/** Destination picker behind the landing page's W&B button: Runs, Reports, and
 *  authoring a new report via chat. The two external links come from /meta and
 *  simply don't render until the backend has real W&B env values; the in-app
 *  authoring path is always available. (The CSV download is its own front-page
 *  button, not in here.) */
export function WandbModal({
  meta,
  onClose,
  onCreateReport,
}: {
  meta: SiteMeta | null;
  onClose: () => void;
  onCreateReport: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Weights & Biases"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">
          <img className="modal-logo" src="/wandb_logo.png" alt="" aria-hidden="true" />
          Weights &amp; Biases
        </h2>
        {meta?.wandb_runs_url && (
          <a className="modal-option" href={meta.wandb_runs_url} target="_blank" rel="noreferrer">
            <span className="modal-option-title">Runs ↗</span>
            <span className="modal-option-desc">Every trained model, browsable in the W&amp;B runs table.</span>
          </a>
        )}
        {meta?.wandb_reports_url && (
          <a className="modal-option" href={meta.wandb_reports_url} target="_blank" rel="noreferrer">
            <span className="modal-option-title">Reports ↗</span>
            <span className="modal-option-desc">
              Author-curated W&amp;B reports in the canonical project, explaining the experiment axes and
              headline metrics.
            </span>
          </a>
        )}
        <button className="modal-option" onClick={onCreateReport}>
          <span className="modal-option-title">Make a new report with chat</span>
          <span className="modal-option-desc">
            Ask the assistant to compose a report spec; you confirm before a draft is saved.
          </span>
        </button>
        {meta?.wandb_visitor_reports_url && (
          <a className="modal-option" href={meta.wandb_visitor_reports_url} target="_blank" rel="noreferrer">
            <span className="modal-option-title">Visitor-created reports ↗</span>
            <span className="modal-option-desc">
              Draft reports visitors have composed, including any you save here.
            </span>
          </a>
        )}
        <div className="modal-foot">
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
