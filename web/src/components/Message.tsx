import { AnchorHTMLAttributes, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  codeCitationUrl,
  countCitations,
  decodeCitation,
  rewriteCitations,
  thesisCitationDest,
  thesisCitationUrl,
} from '../citations';
import { DisplayMessage, SiteMeta, ThesisAnchors } from '../types';
import { FigureEntry, figureForCitation } from '../figures';
import { QueryResultPanel } from './QueryResults';
import { ReportConfirm } from './ReportConfirm';

/** Below this length an assistant reply is treated as conversational filler
 *  ("you're welcome") and the no-citations notice is withheld. */
const UNCITED_NOTICE_MIN_CHARS = 280;

/** Match a [wandb: …] chip body against the turn's attached query results so
 *  clicking the chip can reveal the exact table behind the number. The model is
 *  instructed to copy the tool's citation verbatim; three fallbacks, in order of
 *  confidence, recover the link when it didn't:
 *    1. exact (whitespace-normalized) string match;
 *    2. token-set match — the chip's comma-separated parts are all contained in
 *       exactly one candidate (handles the model reordering/dropping tokens);
 *    3. when the turn ran exactly one query, that is the only possible referent.
 *  A non-unique token-set match is rejected rather than guessed. */
function matchQueryResult(body: string, citations: string[]): number | null {
  const norm = (s: string) =>
    s
      .replace(/^\[wandb:\s*/i, '')
      .replace(/\]$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  const target = norm(body);
  const exact = citations.findIndex((c) => norm(c) === target);
  if (exact >= 0) return exact;

  // Token-set containment: split on commas, drop empties, compare order-free.
  const tokens = (s: string) =>
    new Set(
      norm(s)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    );
  const want = tokens(target);
  if (want.size > 0) {
    const matches = citations
      .map((c, i) => ({ i, set: tokens(c) }))
      .filter(({ set }) => [...want].every((t) => set.has(t)));
    if (matches.length === 1) return matches[0].i;
  }

  return citations.length === 1 ? 0 : null;
}

function CitationChip({
  href,
  meta,
  anchors,
  figures,
  onShowQuery,
  onOpenThesis,
  queryCitations,
}: {
  href: string;
  meta: SiteMeta | null;
  anchors: ThesisAnchors | null;
  figures: FigureEntry[] | null;
  onShowQuery: (index: number) => void;
  onOpenThesis?: (dest: string | null, label: string, figure?: FigureEntry) => void;
  queryCitations: string[];
}) {
  const cite = decodeCitation(href);
  if (!cite) return null;
  const { kind, body } = cite;

  const label = (
    <>
      <span className="cite-kind">{kind}</span> {body}
    </>
  );

  let url: string | null = null;
  let title = body;
  if (kind === 'code') {
    url = codeCitationUrl(body, meta);
    title = url ? `${body} (view at the pinned thesis-src commit)` : body;
  } else if (kind === 'thesis') {
    // Inside the chat the chip opens the inline panel at the cited location
    // (reliable in every browser); elsewhere (the landing tour) it stays a
    // new-tab deep link. A figure citation that matches a gallery entry opens
    // the figure itself (the actual plot + caption), not just its PDF page.
    const figure = figureForCitation(body, figures);
    const dest = thesisCitationDest(body, anchors);
    if ((figure || dest) && onOpenThesis) {
      return (
        <button
          type="button"
          className="cite cite-thesis cite-action"
          title={figure ? `${body}: show this figure` : `${body}: show this location in the thesis panel`}
          onClick={() => onOpenThesis(dest, body, figure ?? undefined)}
        >
          {label}
        </button>
      );
    }
    url = thesisCitationUrl(body, anchors);
    title = url.includes('#nameddest=')
      ? `${body}: open the thesis PDF at this location`
      : `${body}: open the thesis PDF (search for the section name)`;
  } else if (kind === 'wandb') {
    const target = matchQueryResult(body, queryCitations);
    if (target !== null) {
      return (
        <button
          type="button"
          className="cite cite-wandb cite-action"
          title="Show the query result behind this citation"
          onClick={() => onShowQuery(target)}
        >
          {label}
        </button>
      );
    }
  }

  return url ? (
    <a className={`cite cite-${kind}`} href={url} target="_blank" rel="noreferrer" title={title}>
      {label}
    </a>
  ) : (
    <span className={`cite cite-${kind}`} title={title}>
      {label}
    </span>
  );
}

export function Message({
  msg,
  meta,
  anchors,
  figures,
  onSaveReport,
  onOpenThesis,
}: {
  msg: DisplayMessage;
  meta: SiteMeta | null;
  anchors: ThesisAnchors | null;
  figures?: FigureEntry[] | null;
  onSaveReport?: (spec: unknown) => Promise<{ url: string }>;
  onOpenThesis?: (dest: string | null, label: string, figure?: FigureEntry) => void;
}) {
  const panelRefs = useRef<(HTMLDetailsElement | null)[]>([]);

  if (msg.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="msg-body">{msg.content}</div>
      </div>
    );
  }

  const queryResults = msg.queryResults ?? [];
  const queryCitations = queryResults.map((q) => q.citation);

  function showQuery(index: number) {
    const el = panelRefs.current[index];
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el.classList.remove('qr-flash');
    void el.offsetWidth; // restart the highlight animation on repeat clicks
    el.classList.add('qr-flash');
  }

  const cited = countCitations(msg.content);
  const showUncited = cited === 0 && msg.content.length >= UNCITED_NOTICE_MIN_CHARS;

  return (
    <div className="msg msg-assistant">
      <div className="msg-body markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
          components={{
            a: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
              if (href && decodeCitation(href)) {
                return (
                  <CitationChip
                    href={href}
                    meta={meta}
                    anchors={anchors}
                    figures={figures ?? null}
                    onShowQuery={showQuery}
                    onOpenThesis={onOpenThesis}
                    queryCitations={queryCitations}
                  />
                );
              }
              return (
                <a href={href} target="_blank" rel="noreferrer" {...rest}>
                  {children}
                </a>
              );
            },
          }}
        >
          {rewriteCitations(msg.content)}
        </ReactMarkdown>
      </div>
      {queryResults.length > 0 && (
        <div className="query-results">
          {queryResults.map((q, i) => (
            <QueryResultPanel
              key={i}
              data={q}
              panelRef={(el) => {
                panelRefs.current[i] = el;
              }}
            />
          ))}
        </div>
      )}
      {msg.proposal && onSaveReport && <ReportConfirm proposal={msg.proposal} onSave={onSaveReport} />}
      {showUncited && (
        <div className="msg-warning">No source citations in this reply, so treat its factual claims with care.</div>
      )}
      {msg.meta?.capped && (
        <div className="msg-warning">
          This turn hit a safety cap ({msg.meta.tool_calls.length} tool calls) and may be incomplete.
        </div>
      )}
      {msg.meta && (
        <div className="msg-meta">
          {msg.meta.tool_calls.length > 0 ? `tools: ${msg.meta.tool_calls.join(', ')}` : 'no tools used'}
          {' · '}
          {msg.meta.usage.input_tokens.toLocaleString()} in / {msg.meta.usage.output_tokens.toLocaleString()} out
          {msg.meta.usage.cache_read_input_tokens > 0 &&
            ` · ${msg.meta.usage.cache_read_input_tokens.toLocaleString()} cached`}
        </div>
      )}
    </div>
  );
}
