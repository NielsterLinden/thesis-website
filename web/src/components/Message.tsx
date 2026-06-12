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
  thesisCitationUrl,
} from '../citations';
import { DisplayMessage, SiteMeta, ThesisAnchors } from '../types';
import { QueryResultPanel } from './QueryResults';
import { ReportConfirm } from './ReportConfirm';

/** Below this length an assistant reply is treated as conversational filler
 *  ("you're welcome") and the no-citations notice is withheld. */
const UNCITED_NOTICE_MIN_CHARS = 280;

/** Match a [wandb: …] chip body against the turn's attached query results so
 *  clicking the chip can reveal the exact table behind the number. The model
 *  is instructed to copy the tool's citation verbatim; when it didn't but the
 *  turn ran exactly one query, that one is the only possible referent. */
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
  return citations.length === 1 ? 0 : null;
}

function CitationChip({
  href,
  meta,
  anchors,
  onShowQuery,
  queryCitations,
}: {
  href: string;
  meta: SiteMeta | null;
  anchors: ThesisAnchors | null;
  onShowQuery: (index: number) => void;
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
  onSaveReport,
}: {
  msg: DisplayMessage;
  meta: SiteMeta | null;
  anchors: ThesisAnchors | null;
  onSaveReport?: (spec: unknown) => Promise<{ url: string }>;
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
                    onShowQuery={showQuery}
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
