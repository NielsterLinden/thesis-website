import { useEffect } from 'react';
import { SiteMeta } from '../types';

/** Destination picker behind the landing page's W&B button. The two external
 *  links come from /meta and simply don't render until the backend has real
 *  W&B env values; the in-app paths (report authoring via chat, CSV download)
 *  are always available. */
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
        <h2>Weights &amp; Biases</h2>
        {meta?.wandb_reports_url && (
          <a className="modal-option" href={meta.wandb_reports_url} target="_blank" rel="noreferrer">
            <span className="modal-option-title">Pre-made reports ↗</span>
            <span className="modal-option-desc">
              Curated W&amp;B reports explaining the experiment axes and headline metrics.
            </span>
          </a>
        )}
        {meta?.wandb_runs_url && (
          <a className="modal-option" href={meta.wandb_runs_url} target="_blank" rel="noreferrer">
            <span className="modal-option-title">Run database ↗</span>
            <span className="modal-option-desc">Every trained model, browsable in the W&amp;B runs table.</span>
          </a>
        )}
        <button className="modal-option" onClick={onCreateReport}>
          <span className="modal-option-title">Create your own report</span>
          <span className="modal-option-desc">
            Ask the assistant to compose a report spec; you confirm before a draft is saved.
          </span>
        </button>
        <a className="modal-option" href="/runs.csv" download>
          <span className="modal-option-title">Download the raw data (CSV)</span>
          <span className="modal-option-desc">
            1&thinsp;785 runs × 156 columns (2.7 MB) — the exact file the assistant queries; the bulky ROC/PR
            curve arrays are excluded.
          </span>
        </a>
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
