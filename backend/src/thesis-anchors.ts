import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { AppConfig } from './config';

/**
 * Thesis anchor map: citation key -> hyperref named destination in the served
 * PDF. Built once at startup from the LaTeX build artifacts committed in the
 * pinned submodule (thesis_report/report.toc + report.aux), which come from
 * the same latexmk run as web/thesis.pdf — so every destination is guaranteed
 * to exist in the PDF the frontend opens with #nameddest=<dest>.
 *
 * Keys (flat, frontend-facing):
 *   "4.2"            -> "section.4.2"        (numbered chapters/sections, from .toc + .aux)
 *   "eq:6.1"         -> "equation.6.1"       (equation NUMBER, prefixed to avoid section collisions)
 *   "fig:4.3"        -> "figure.caption.N"   (figure number)
 *   "tab:4.1"        -> "table.caption.N"    (table number)
 *   "<\label name>"  -> dest                 (every \newlabel verbatim, e.g. "fig:intro_sm_particles")
 */

export type ThesisAnchors = Record<string, string>;

/** Read one balanced {...} group starting at text[pos] (which must be '{').
 *  Returns the inner content and the index just past the closing brace, or
 *  null when the group never closes (truncated file). */
function readGroup(text: string, pos: number): { content: string; next: number } | null {
  if (text[pos] !== '{') return null;
  let depth = 0;
  for (let i = pos; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { content: text.slice(pos + 1, i), next: i + 1 };
    }
  }
  return null;
}

const NUMBERED_DEST_KINDS = new Set([
  'part',
  'chapter',
  'appendix',
  'section',
  'subsection',
  'subsubsection',
]);

/** `\newlabel{label}{{num}{page}{title}{dest}{}}` entries (titles may nest
 *  braces — math, \cite — so this is a brace-aware scan, not a line regex). */
export function parseAux(aux: string, anchors: ThesisAnchors): void {
  const MARK = '\\newlabel{';
  let pos = 0;
  for (;;) {
    const at = aux.indexOf(MARK, pos);
    if (at < 0) break;
    const label = readGroup(aux, at + MARK.length - 1);
    if (!label) break;
    const args = readGroup(aux, label.next);
    pos = args ? args.next : label.next;
    if (!args || label.content.endsWith('@cref')) continue;

    // args.content = {num}{page}{title}{dest}{extra...}
    const groups: string[] = [];
    let p = 0;
    while (p < args.content.length && groups.length < 4) {
      const g = readGroup(args.content, p);
      if (!g) break;
      groups.push(g.content);
      p = g.next;
    }
    const [num, , , dest] = groups;
    if (!dest || !dest.includes('.')) continue;

    anchors[label.content] = dest;
    const kind = dest.split('.')[0].replace(/\*$/, '');
    if (!num) continue;
    if (kind === 'equation') anchors[`eq:${num}`] = dest;
    else if (kind === 'figure') anchors[`fig:${num}`] = dest;
    else if (kind === 'table') anchors[`tab:${num}`] = dest;
    else if (NUMBERED_DEST_KINDS.has(kind)) anchors[num] ??= dest;
  }
}

/** `\contentsline {section}{\numberline {4.2}Title}{31}{section.4.2}%` lines.
 *  The .toc covers ALL numbered sections (the .aux only those carrying a
 *  \label), so it is the primary source for plain "§4.2" keys. */
export function parseToc(toc: string, anchors: ThesisAnchors): void {
  const LINE_RE =
    /^\\contentsline \{[a-z]+\}\{\\numberline \{([^}]+)\}.*\{([a-zA-Z]+\*?\.[A-Za-z0-9.*]+)\}%?\s*$/gm;
  for (const m of toc.matchAll(LINE_RE)) {
    const [, num, dest] = m;
    const kind = dest.split('.')[0].replace(/\*$/, '');
    if (NUMBERED_DEST_KINDS.has(kind)) anchors[num] = dest;
  }
}

/** Load the anchor map from the pinned submodule, or {} (with a loud log) when
 *  the artifacts are missing — e.g. a future thesis refresh that committed a
 *  new PDF without its .aux/.toc would silently break deep links otherwise. */
export function loadThesisAnchors(config: AppConfig): ThesisAnchors {
  const logger = new Logger('thesis-anchors');
  const tocPath = resolve(config.thesisSrcDir, 'thesis_report', 'report.toc');
  const auxPath = resolve(config.thesisSrcDir, 'thesis_report', 'report.aux');
  const anchors: ThesisAnchors = {};

  if (!existsSync(tocPath) || !existsSync(auxPath)) {
    logger.warn(
      `Thesis anchor artifacts missing (${tocPath} / ${auxPath}): [thesis: …] citations ` +
        'will open the PDF at page 1 instead of deep-linking. If the thesis snapshot was ' +
        'refreshed, commit report.toc + report.aux alongside the new PDF.',
    );
    return anchors;
  }

  parseToc(readFileSync(tocPath, 'utf8'), anchors);
  parseAux(readFileSync(auxPath, 'utf8'), anchors);
  logger.log(`Thesis anchor map: ${Object.keys(anchors).length} keys (sections, labels, eq/fig/tab numbers).`);
  return anchors;
}
