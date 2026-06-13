import { FigureEntry } from '../figures';
import { Markdown } from './Markdown';
import { WandbIcon } from './icons';

/** A figure-chip click: the gallery figure to dock inline. seq distinguishes
 *  repeat clicks on the same chip so the panel re-opens. */
export interface FigureTarget {
  figure: FigureEntry;
  seq: number;
}

/** Inline figure viewer docked beside the chat: when a [thesis: fig:…] citation
 *  matches a gallery figure, show the actual plot (committed PNG) with its
 *  caption, the models behind it, and links into W&B / the source PDF / the
 *  thesis page — instead of rendering the whole PDF page the figure sits on. */
export function FigurePanel({ target, onClose }: { target: FigureTarget; onClose: () => void }) {
  const fig = target.figure;
  const thesisHref = fig.thesisPage ? `/thesis.pdf#page=${fig.thesisPage}` : null;

  return (
    <aside className="thesis-panel">
      <div className="thesis-panel-head">
        <span className="thesis-panel-label" title={fig.title}>
          {fig.number ? `Fig. ${fig.number}` : 'Figure'}
        </span>
        <span className="spacer" />
        {thesisHref && (
          <a className="ghost" href={thesisHref} target="_blank" rel="noreferrer" title="Open the thesis PDF at this figure">
            Open tab
          </a>
        )}
        <button type="button" className="ghost" onClick={onClose} title="Close the figure panel">
          ✕
        </button>
      </div>
      <div className="thesis-panel-body figure-panel-body">
        <img className="figure-panel-img" src={fig.png} alt={fig.title} />
        <h3 className="figure-title">{fig.title}</h3>
        <div className="figure-desc markdown">
          <Markdown>{fig.description}</Markdown>
        </div>
        {fig.models && (
          <p className="figure-models">
            <span className="figure-models-label">Models:</span> {fig.models}
          </p>
        )}
        <div className="figure-links">
          {fig.wandbUrl && (
            <a className="figure-link figure-link-wandb" href={fig.wandbUrl} target="_blank" rel="noreferrer">
              <WandbIcon size={14} /> W&amp;B
            </a>
          )}
          {fig.pdf && (
            <a className="figure-link" href={fig.pdf} target="_blank" rel="noreferrer">
              Source PDF ↗
            </a>
          )}
          {thesisHref && (
            <a className="figure-link" href={thesisHref} target="_blank" rel="noreferrer">
              Thesis p. {fig.thesisPage} ↗
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
