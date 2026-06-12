import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * Lazy PDF.js singleton for the inline thesis panel. The library and its
 * worker load only on the first thesis-chip click, so the main bundle pays
 * nothing; the document itself is the same /thesis.pdf the viewer tab and the
 * deep links use, fetched once and HTTP-cached.
 *
 * Why PDF.js at all: browser-native viewers disagree about #nameddest
 * fragments (Edge's reader ignores them), so an examiner clicking a
 * [thesis: §4.2] chip could land on page 1. PDF.js resolves the hyperref
 * named destinations itself, identically in every browser.
 */
let docPromise: Promise<PDFDocumentProxy> | null = null;

export function getThesisDoc(): Promise<PDFDocumentProxy> {
  docPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs.getDocument({ url: new URL('/thesis.pdf', window.location.origin).href }).promise;
  })();
  return docPromise;
}

/** Resolve a hyperref named destination (e.g. "section.4.2") to its 1-based
 *  page number, or null when the PDF does not carry it. */
export async function resolveDestPage(doc: PDFDocumentProxy, dest: string): Promise<number | null> {
  const explicit = await doc.getDestination(dest);
  if (!explicit || explicit.length === 0) return null;
  try {
    return (await doc.getPageIndex(explicit[0] as Parameters<typeof doc.getPageIndex>[0])) + 1;
  } catch {
    return null;
  }
}
