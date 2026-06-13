import { useState } from 'react';
import { SiteMeta } from '../types';
import { ChatIcon, FigureIcon, GithubIcon, PdfIcon } from './icons';
import { WandbModal } from './WandbModal';

/** Prefilled question for the modal's "create your own report" path — routes
 *  the visitor into the chat-side authoring flow (the only write path:
 *  author_report proposes, the human confirms, a draft is saved). */
const REPORT_PRIMER =
  'I would like to create my own W&B report from the frozen run database. ' +
  'First give me a brief overview of what I can plot (the experiment axes I can filter and group by, ' +
  'and the metrics available), then walk me through authoring one. ' +
  'I understand a draft is only saved after I explicitly confirm it.';

/** Link to the pinned submodule snapshot, mirroring codeCitationUrl's
 *  normalization of the repo URL. */
function repoTreeUrl(meta: SiteMeta | null): string | null {
  if (!meta) return null;
  const repo = meta.thesis_repo_url.replace(/\.git$/, '').replace(/\/$/, '');
  return `${repo}/tree/${meta.thesis_src_commit}`;
}

export function Landing({
  meta,
  onOpenChat,
  onOpenPdf,
  onOpenFigures,
}: {
  meta: SiteMeta | null;
  onOpenChat: (prompt?: string) => void;
  onOpenPdf: () => void;
  onOpenFigures: () => void;
}) {
  const [wandbOpen, setWandbOpen] = useState(false);
  const treeUrl = repoTreeUrl(meta);

  return (
    <div className="landing">
      <div className="landing-inner">
        <section className="landing-hero">
          <h1>Hi!</h1>
          <p className="landing-intro">
            This is the companion app for my thesis: one place to interact with everything behind it. Read the
            thesis, browse every figure, explore the trained models in Weights &amp; Biases, dig into the code, or
            just ask the assistant.
          </p>
        </section>

        <div className="landing-cards">
          <button className="dest dest-chat" onClick={() => onOpenChat()}>
            <ChatIcon size={26} />
            <span className="dest-text">
              <span className="dest-title">Chat with the assistant</span>
              <span className="dest-desc">Ask anything about the thesis, the code, or the experiments.</span>
            </span>
          </button>
          <div className="landing-cards-grid">
            <button className="dest" onClick={onOpenPdf}>
              <PdfIcon size={22} />
              <span className="dest-text">
                <span className="dest-title">Thesis PDF</span>
                <span className="dest-desc">Read the full thesis in your browser.</span>
              </span>
            </button>
            <button className="dest" onClick={onOpenFigures}>
              <FigureIcon size={22} />
              <span className="dest-text">
                <span className="dest-title">Figures</span>
                <span className="dest-desc">Every figure from the thesis and beyond.</span>
              </span>
            </button>
            <button className="dest" onClick={() => setWandbOpen(true)}>
              <img className="dest-logo" src="/wandb_logo.png" alt="" aria-hidden="true" />
              <span className="dest-text">
                <span className="dest-title">Weights &amp; Biases</span>
                <span className="dest-desc">Browse the runs and reports, or compose a new one with the assistant.</span>
              </span>
            </button>
            <a className="dest" href="/runs.csv" download>
              <img className="dest-logo" src="/excel.png" alt="" aria-hidden="true" />
              <span className="dest-text">
                <span className="dest-title">Data (Excel)</span>
                <span className="dest-desc">Download the frozen run export as a spreadsheet (CSV).</span>
              </span>
            </a>
            {treeUrl && (
              <a className="dest" href={treeUrl} target="_blank" rel="noreferrer">
                <GithubIcon size={22} />
                <span className="dest-text">
                  <span className="dest-title">GitHub</span>
                  <span className="dest-desc">The exact pinned code snapshot behind the results.</span>
                </span>
              </a>
            )}
          </div>
        </div>

        <p className="landing-trust">
          Every answer the assistant gives is grounded in these sources and carries a citation you can verify.
        </p>

        {meta && treeUrl && (
          <footer className="landing-footer">
            Pinned snapshot: thesis-src @{' '}
            <a href={treeUrl} target="_blank" rel="noreferrer">
              {meta.thesis_src_commit.slice(0, 7)}
            </a>{' '}
            · frozen W&amp;B export, 1&thinsp;785 runs
          </footer>
        )}
      </div>
      {wandbOpen && (
        <WandbModal
          meta={meta}
          onClose={() => setWandbOpen(false)}
          onCreateReport={() => {
            setWandbOpen(false);
            onOpenChat(REPORT_PRIMER);
          }}
        />
      )}
    </div>
  );
}
