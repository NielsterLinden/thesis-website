import { SiteMeta } from './types';

/**
 * The citation contract (Initial_plan.md §0, backend system prompt): the model
 * emits inline tokens in four exact forms —
 *   [thesis: §4.2, Eq. (4.7)]
 *   [code: path/to/file.py:42-58]            (en dash also accepted)
 *   [wandb: B1=="GELU", N=8 seeds, median]
 *   [axes: A3 = formal.config.key (AXES_REFERENCE_V2.md)]
 * This module finds those tokens in assistant markdown and rewrites them as
 * links with a `#cite=` href that the markdown renderer intercepts and turns
 * into reference chips. Tokens inside code fences / inline code are left
 * untouched (tool output echoed into a code block must render verbatim).
 */

export type CitationKind = 'thesis' | 'code' | 'wandb' | 'axes';

export interface Citation {
  kind: CitationKind;
  body: string;
}

const TOKEN_RE = /\[(thesis|code|wandb|axes):\s*([^\]]+)\]/g;
// Fenced blocks first (non-greedy), then inline code; splitting on these keeps
// the rewrite away from code content.
const CODE_SEGMENT_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;

export const CITE_HREF_PREFIX = '#cite=';

export function encodeCitation(kind: CitationKind, body: string): string {
  return `${CITE_HREF_PREFIX}${kind}:${encodeURIComponent(body)}`;
}

export function decodeCitation(href: string): Citation | null {
  if (!href.startsWith(CITE_HREF_PREFIX)) return null;
  const rest = href.slice(CITE_HREF_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 0) return null;
  const kind = rest.slice(0, sep) as CitationKind;
  if (!['thesis', 'code', 'wandb', 'axes'].includes(kind)) return null;
  return { kind, body: decodeURIComponent(rest.slice(sep + 1)) };
}

/** Rewrite citation tokens (outside code) into markdown links the renderer
 *  intercepts. Link text keeps the kind prefix so a plain-text fallback —
 *  e.g. copy-paste of the message — still reads as the original token. */
export function rewriteCitations(markdown: string): string {
  return markdown
    .split(CODE_SEGMENT_RE)
    .map((segment, i) => {
      const isCode = i % 2 === 1;
      if (isCode) return segment;
      return segment.replace(TOKEN_RE, (_m, kind: CitationKind, body: string) => {
        return `[${kind}: ${body.trim()}](${encodeCitation(kind, body.trim())})`;
      });
    })
    .join('');
}

export function countCitations(markdown: string): number {
  let n = 0;
  for (const [i, segment] of markdown.split(CODE_SEGMENT_RE).entries()) {
    if (i % 2 === 1) continue;
    n += [...segment.matchAll(TOKEN_RE)].length;
  }
  return n;
}

/** `path/to/file.py:42-58` → GitHub blob URL at the pinned submodule commit.
 *  Returns null when the body does not parse or no meta is available. */
export function codeCitationUrl(body: string, meta: SiteMeta | null): string | null {
  if (!meta) return null;
  const m = /^([^\s:]+(?:\s[^\s:]*)*?):(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(body.trim());
  if (!m) return null;
  const [, path, start, end] = m;
  const repo = meta.thesis_repo_url.replace(/\.git$/, '').replace(/\/$/, '');
  const lines = end ? `#L${start}-L${end}` : `#L${start}`;
  return `${repo}/blob/${meta.thesis_src_commit}/${path}${lines}`;
}
