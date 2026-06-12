import { useState } from 'react';
import { SiteMeta, ThesisAnchors } from '../types';
import { SUGGESTIONS } from './Chat';
import { ChatIcon, GithubIcon, PdfIcon, WandbIcon } from './icons';
import { Tour } from './Tour';
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
  anchors,
  onOpenChat,
  onOpenPdf,
}: {
  meta: SiteMeta | null;
  anchors: ThesisAnchors | null;
  onOpenChat: (prompt?: string) => void;
  onOpenPdf: () => void;
}) {
  const [wandbOpen, setWandbOpen] = useState(false);
  const treeUrl = repoTreeUrl(meta);

  return (
    <div className="landing">
      <div className="landing-inner">
        <section className="landing-hero">
          <h1>Hi!</h1>
          <p className="landing-intro">
            This is the companion webapp to my thesis. The PDF is the distilled story; this site is the launching
            pad for everything behind it. From here you can:
          </p>
          <ul className="landing-caps">
            <li>
              <strong>Read the thesis</strong> right here in the browser.
            </li>
            <li>
              <strong>Visit the codebase</strong>: the exact pinned snapshot the results were produced from.
            </li>
            <li>
              <strong>Browse every trained model</strong> in the Weights &amp; Biases run database, or download the
              frozen export and do your own research.
            </li>
            <li>
              <strong>Open pre-made W&amp;B reports</strong> that explain the experiment axes and metrics.
            </li>
            <li>
              <strong>Compose your own report</strong> over the frozen run data, drafted only after your explicit
              confirmation.
            </li>
            <li>
              <strong>Ask the assistant</strong> anything: it holds the complete thesis source in its context window
              and uses tools to search the code and query the frozen run database.
            </li>
          </ul>
        </section>

        <div className="landing-actions">
          <button className="action action-primary action-chat" onClick={() => onOpenChat()}>
            <ChatIcon /> Chat with the assistant
          </button>
          <div className="landing-actions-row">
            <button className="action action-secondary" onClick={onOpenPdf}>
              <PdfIcon /> Thesis PDF
            </button>
            {treeUrl && (
              <a className="action action-secondary" href={treeUrl} target="_blank" rel="noreferrer">
                <GithubIcon /> GitHub
              </a>
            )}
            <button className="action action-secondary" onClick={() => setWandbOpen(true)}>
              <WandbIcon /> Weights &amp; Biases
            </button>
          </div>
        </div>

        <section className="landing-section">
          <h2>Or start with one of these:</h2>
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => onOpenChat(s)}>
                {s}
              </button>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <h2>Grounded answers, not vibes</h2>
          <p>
            The assistant is not a generic chatbot. The full thesis TeX sits in its context, and every factual claim
            is backed by a tool call over the pinned code snapshot or the frozen experiment export, and carries a
            citation chip you can verify:
          </p>
          <p className="trust-chips">
            <span className="cite cite-thesis">
              <span className="cite-kind">thesis</span> §4.2
            </span>{' '}
            opens the thesis PDF at that exact section ·{' '}
            <span className="cite cite-code">
              <span className="cite-kind">code</span> src/model.py:42-58
            </span>{' '}
            links to those exact lines at the pinned commit ·{' '}
            <span className="cite cite-wandb">
              <span className="cite-kind">wandb</span> H10==&quot;d256_L6&quot;, metric=eval_v2/test_auroc, agg=median
            </span>{' '}
            reveals the full query result (filters, groups, N) behind a number.
          </p>
          <p>When no tool-grounded evidence exists, the assistant says so rather than inventing an answer.</p>
        </section>

        <Tour meta={meta} anchors={anchors} onOpenChat={() => onOpenChat()} />

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
