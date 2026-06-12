import { useEffect, useRef, useState } from 'react';
import { getThesisDoc, resolveDestPage } from '../pdfjs';

/** A thesis-chip click: the named destination to show. seq distinguishes
 *  repeat clicks on the same chip so the panel re-navigates. */
export interface ThesisTarget {
  dest: string | null;
  label: string;
  seq: number;
}

interface CancellableRenderTask {
  cancel(): void;
  promise: Promise<void>;
}

/** Inline thesis viewer docked beside (or, on narrow screens, below) the
 *  chat: renders the page a [thesis: …] citation points at, so the examiner
 *  reads the cited section or figure without leaving the conversation. */
export function ThesisPanel({ target, onClose }: { target: ThesisTarget; onClose: () => void }) {
  const [page, setPage] = useState<number | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Monotonic render generation: PDF.js forbids two concurrent renders onto
  // one canvas, so a newer render cancels the in-flight one and stale
  // completions are discarded.
  const renderSeq = useRef(0);
  const renderTask = useRef<CancellableRenderTask | null>(null);

  // Resolve the clicked citation to a page number.
  useEffect(() => {
    let stale = false;
    setError(null);
    void (async () => {
      try {
        const doc = await getThesisDoc();
        if (stale) return;
        setNumPages(doc.numPages);
        const resolved = target.dest ? await resolveDestPage(doc, target.dest) : 1;
        if (!stale) setPage(resolved ?? 1);
      } catch {
        if (!stale) setError('The inline viewer could not load the PDF. Use "Open tab" instead.');
      }
    })();
    return () => {
      stale = true;
    };
  }, [target.seq, target.dest]);

  // Draw the current page, sized to the panel width and the device pixel ratio.
  useEffect(() => {
    if (page === null) return;
    const seq = ++renderSeq.current;
    void (async () => {
      try {
        const doc = await getThesisDoc();
        const pdfPage = await doc.getPage(page);
        const canvas = canvasRef.current;
        const holder = bodyRef.current;
        if (seq !== renderSeq.current || !canvas || !holder) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const cssWidth = Math.max(holder.clientWidth - 16, 280);
        const ratio = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: (cssWidth / base.width) * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
        renderTask.current?.cancel();
        const task = pdfPage.render({ canvas, viewport }) as unknown as CancellableRenderTask;
        renderTask.current = task;
        await task.promise;
        if (seq === renderSeq.current) holder.scrollTop = 0;
      } catch {
        // A cancelled render rejects; only the live generation may report.
        if (seq === renderSeq.current) setError('Could not render this page.');
      }
    })();
  }, [page, target.seq]);

  const openHref = page !== null ? `/thesis.pdf#page=${page}` : '/thesis.pdf';

  return (
    <aside className="thesis-panel">
      <div className="thesis-panel-head">
        <span className="thesis-panel-label" title={target.label}>
          {target.label}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="ghost"
          disabled={page === null || page <= 1}
          onClick={() => setPage((p) => Math.max((p ?? 2) - 1, 1))}
          title="Previous page"
        >
          ‹
        </button>
        <span className="thesis-panel-page">{page !== null && numPages > 0 ? `p. ${page} / ${numPages}` : '…'}</span>
        <button
          type="button"
          className="ghost"
          disabled={page === null || (numPages > 0 && page >= numPages)}
          onClick={() => setPage((p) => (p ?? 0) + 1)}
          title="Next page"
        >
          ›
        </button>
        <a
          className="ghost"
          href={openHref}
          target="_blank"
          rel="noreferrer"
          title="Open the full PDF in a new tab at this page"
        >
          Open tab
        </a>
        <button type="button" className="ghost" onClick={onClose} title="Close the thesis panel">
          ✕
        </button>
      </div>
      <div className="thesis-panel-body" ref={bodyRef}>
        {error ? <div className="thesis-panel-error">{error}</div> : <canvas ref={canvasRef} />}
      </div>
    </aside>
  );
}
