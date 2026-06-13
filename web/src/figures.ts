/**
 * The figure gallery is driven by a hand-maintained manifest committed at
 * web/public/figures.json (served same-origin at /figures.json). Each entry is
 * one figure: a committed PNG for display, the source PDF for a crisp/zoom
 * view, the author's explanation + which models it came from, and a W&B link.
 *
 * `backend/scripts/figures-manifest.mjs` seeds entries from the pinned thesis
 * snapshot (caption, page, image file); the author then fills `models` and
 * `wandbUrl`. The script never clobbers those hand-written fields.
 */

export interface FigureEntry {
  /** Stable slug; basis for the asset filenames. */
  id: string;
  title: string;
  /** Gallery group heading, e.g. "Ch 5" / "App A". */
  chapter: string;
  /** Figure number in the thesis, e.g. "5.2" (absent for figures not in it). */
  number?: string;
  png: string;
  pdf?: string;
  /** What the figure shows; may contain $…$ math (rendered with KaTeX). */
  description: string;
  /** Which model or group of models this was produced on (author free text). */
  models?: string;
  /** Author-curated W&B link (a runs view, a run, or a report). */
  wandbUrl?: string;
  /** Links the gallery card back to the thesis: \label name and PDF page. */
  thesisLabel?: string;
  thesisPage?: number;
}

/** GET /figures.json — the gallery manifest. Null (gallery shows an empty
 *  state) on any failure or a malformed payload. */
export async function fetchFigures(): Promise<FigureEntry[] | null> {
  try {
    const res = await fetch('/figures.json');
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as FigureEntry[]) : null;
  } catch {
    return null;
  }
}

/** Match a [thesis: …] citation body to a gallery figure — by verbatim label
 *  (`fig:foo`) first, then by figure number (`Fig. 5.2`). Null when neither
 *  resolves, so the caller falls back to the plain PDF-page render. */
export function figureForCitation(body: string, figures: FigureEntry[] | null): FigureEntry | null {
  if (!figures || figures.length === 0) return null;
  const label = body.match(/\bfig:[A-Za-z0-9_:-]+/i);
  if (label) {
    const key = label[0].toLowerCase();
    const hit = figures.find((f) => f.thesisLabel?.toLowerCase() === key);
    if (hit) return hit;
  }
  const num = body.match(/\bfig(?:ure)?s?\.?\s*(\d+(?:\.\d+)*)/i);
  if (num) {
    const hit = figures.find((f) => f.number === num[1]);
    if (hit) return hit;
  }
  return null;
}
