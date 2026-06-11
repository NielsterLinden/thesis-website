import { AnchorHTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { codeCitationUrl, countCitations, decodeCitation, rewriteCitations } from '../citations';
import { DisplayMessage, SiteMeta } from '../types';
import { ReportConfirm } from './ReportConfirm';

/** Below this length an assistant reply is treated as conversational filler
 *  ("you're welcome") and the no-citations notice is withheld. */
const UNCITED_NOTICE_MIN_CHARS = 280;

function CitationChip({ href, meta }: { href: string; meta: SiteMeta | null }) {
  const cite = decodeCitation(href);
  if (!cite) return null;
  const { kind, body } = cite;

  let url: string | null = null;
  let title = body;
  if (kind === 'code') {
    url = codeCitationUrl(body, meta);
    title = url ? `${body} — view at the pinned thesis-src commit` : body;
  } else if (kind === 'thesis') {
    url = '/thesis.pdf';
    title = `${body} — open the thesis PDF (search for the section name)`;
  }

  const label = (
    <>
      <span className="cite-kind">{kind}</span> {body}
    </>
  );
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
  onSaveReport,
}: {
  msg: DisplayMessage;
  meta: SiteMeta | null;
  onSaveReport?: (spec: unknown) => Promise<{ url: string }>;
}) {
  if (msg.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="msg-body">{msg.content}</div>
      </div>
    );
  }

  const cited = countCitations(msg.content);
  const showUncited = cited === 0 && msg.content.length >= UNCITED_NOTICE_MIN_CHARS;

  return (
    <div className="msg msg-assistant">
      <div className="msg-body markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
              if (href && decodeCitation(href)) return <CitationChip href={href} meta={meta} />;
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
      {msg.proposal && onSaveReport && <ReportConfirm proposal={msg.proposal} onSave={onSaveReport} />}
      {showUncited && (
        <div className="msg-warning">No source citations in this reply — treat its factual claims with care.</div>
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
