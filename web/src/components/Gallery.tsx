import { useEffect, useMemo, useState } from 'react';
import { FigureEntry } from '../figures';
import { Markdown } from './Markdown';
import { WandbIcon } from './icons';

function FigureLinks({ fig }: { fig: FigureEntry }) {
  return (
    <div className="figure-links">
      {fig.wandbUrl && (
        <a className="figure-link figure-link-wandb" href={fig.wandbUrl} target="_blank" rel="noreferrer">
          <WandbIcon size={14} /> W&amp;B
        </a>
      )}
      {fig.pdf && (
        <a className="figure-link" href={fig.pdf} target="_blank" rel="noreferrer" title="Open the full-resolution source PDF">
          Source PDF ↗
        </a>
      )}
      {fig.thesisPage && (
        <a
          className="figure-link"
          href={`/thesis.pdf#page=${fig.thesisPage}`}
          target="_blank"
          rel="noreferrer"
          title="Open the thesis PDF at this figure"
        >
          Thesis p. {fig.thesisPage} ↗
        </a>
      )}
    </div>
  );
}

function FigureTitle({ fig }: { fig: FigureEntry }) {
  return (
    <>
      {fig.number && <span className="figure-num">Fig. {fig.number}</span>} {fig.title}
    </>
  );
}

function FigureCard({ fig, onOpen }: { fig: FigureEntry; onOpen: () => void }) {
  return (
    <figure className="figure-card">
      <button type="button" className="figure-thumb" onClick={onOpen} title="Click to enlarge">
        <img src={fig.png} alt={fig.title} loading="lazy" />
      </button>
      <figcaption className="figure-card-body">
        <h3 className="figure-title">
          <FigureTitle fig={fig} />
        </h3>
        <div className="figure-desc markdown">
          <Markdown>{fig.description}</Markdown>
        </div>
        {fig.models && (
          <p className="figure-models">
            <span className="figure-models-label">Models:</span> {fig.models}
          </p>
        )}
        <FigureLinks fig={fig} />
      </figcaption>
    </figure>
  );
}

function FigureModal({ fig, onClose }: { fig: FigureEntry; onClose: () => void }) {
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
        className="figure-modal"
        role="dialog"
        aria-modal="true"
        aria-label={fig.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="figure-modal-head">
          <span className="figure-modal-title">
            <FigureTitle fig={fig} />
          </span>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="figure-modal-img">
          <img src={fig.png} alt={fig.title} />
        </div>
        <div className="figure-modal-body">
          <div className="figure-desc markdown">
            <Markdown>{fig.description}</Markdown>
          </div>
          {fig.models && (
            <p className="figure-models">
              <span className="figure-models-label">Models:</span> {fig.models}
            </p>
          )}
          <FigureLinks fig={fig} />
        </div>
      </div>
    </div>
  );
}

/** The public figure gallery: every committed figure grouped by chapter, with
 *  the author's explanation, the model(s) behind it, and a W&B link. Driven by
 *  the /figures.json manifest (web/src/figures.ts). */
export function Gallery({ figures }: { figures: FigureEntry[] | null }) {
  const [query, setQuery] = useState('');
  const [chapter, setChapter] = useState('All');
  const [active, setActive] = useState<FigureEntry | null>(null);

  const chapters = useMemo(() => {
    const seen: string[] = [];
    for (const f of figures ?? []) if (!seen.includes(f.chapter)) seen.push(f.chapter);
    return seen;
  }, [figures]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, FigureEntry[]>();
    for (const f of figures ?? []) {
      if (chapter !== 'All' && f.chapter !== chapter) continue;
      if (
        q &&
        !f.title.toLowerCase().includes(q) &&
        !f.description.toLowerCase().includes(q) &&
        !(f.models ?? '').toLowerCase().includes(q) &&
        !(f.number ?? '').includes(q)
      )
        continue;
      const arr = map.get(f.chapter) ?? [];
      arr.push(f);
      map.set(f.chapter, arr);
    }
    return [...map.entries()];
  }, [figures, query, chapter]);

  if (!figures) {
    return (
      <div className="gallery">
        <div className="gallery-inner">
          <p className="gallery-empty">The figure gallery could not be loaded.</p>
        </div>
      </div>
    );
  }

  const total = grouped.reduce((n, [, figs]) => n + figs.length, 0);

  return (
    <div className="gallery">
      <div className="gallery-inner">
        <header className="gallery-head">
          <h1>Figures</h1>
          <p className="gallery-intro">
            Every figure from the thesis, with what it shows, the model or models behind it, and a link into Weights
            &amp; Biases. Click a figure to enlarge it, or open its source PDF.
          </p>
        </header>

        <div className="gallery-controls">
          <input
            className="gallery-search"
            type="search"
            placeholder="Search figures…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search figures"
          />
          <div className="gallery-chapters">
            <button type="button" className={chapter === 'All' ? 'chip active' : 'chip'} onClick={() => setChapter('All')}>
              All
            </button>
            {chapters.map((c) => (
              <button
                type="button"
                key={c}
                className={chapter === c ? 'chip active' : 'chip'}
                onClick={() => setChapter(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {total === 0 ? (
          <p className="gallery-empty">No figures match your search.</p>
        ) : (
          grouped.map(([ch, figs]) => (
            <section key={ch} className="gallery-chapter">
              <h2 className="gallery-chapter-head">{ch}</h2>
              <div className="figure-grid">
                {figs.map((f) => (
                  <FigureCard key={f.id} fig={f} onOpen={() => setActive(f)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      {active && <FigureModal fig={active} onClose={() => setActive(null)} />}
    </div>
  );
}
