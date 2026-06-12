import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ApiError, postChatStream, saveReport } from '../api';
import { DisplayMessage, PendingPrompt, SiteMeta, ThesisAnchors } from '../types';
import { Message } from './Message';
import { ThesisPanel, ThesisTarget } from './ThesisPanel';

/** Seed questions mirroring the §9 acceptance checks, so a first-time
 *  examiner sees what each tool surface can do. Exported for the landing
 *  page, which offers the same questions as entry points into the chat. */
export const SUGGESTIONS = [
  'Summarize the input-representation chapter.',
  'How is the FFN type resolved between standard, KAN, and MoE?',
  'What is the median test AUROC for the d256_L6 baseline, grouped by B1?',
  'What does A3 control, and where in the code is it implemented?',
];

/** Serialize the conversation to a self-contained markdown document. The
 *  citation tokens stay verbatim plain text (rewriteCitations only touches
 *  the rendered view), so an exported transcript remains verifiable. */
function toMarkdown(messages: DisplayMessage[]): string {
  const lines: string[] = ['# Thesis Companion conversation', '', `_Exported ${new Date().toLocaleString()}_`];
  for (const m of messages) {
    lines.push('', m.role === 'user' ? '## You' : '## Assistant', '', m.content);
    if (m.meta) {
      const tools = m.meta.tool_calls.length > 0 ? m.meta.tool_calls.join(', ') : 'none';
      lines.push(
        '',
        `> tools: ${tools} · ${m.meta.usage.input_tokens.toLocaleString()} tokens in / ` +
          `${m.meta.usage.output_tokens.toLocaleString()} out${m.meta.capped ? ' · capped' : ''}`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function Chat({
  meta,
  anchors,
  password,
  onAuthExpired,
  pendingPrompt,
  onPromptConsumed,
}: {
  meta: SiteMeta | null;
  anchors: ThesisAnchors | null;
  password: string;
  onAuthExpired: () => void;
  pendingPrompt: PendingPrompt | null;
  onPromptConsumed: () => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [thesisTarget, setThesisTarget] = useState<ThesisTarget | null>(null);
  const thesisSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** A [thesis: …] chip click: dock the inline viewer at the cited location. */
  function openThesis(dest: string, label: string) {
    setThesisTarget({ dest, label, seq: ++thesisSeq.current });
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, progress]);

  // Consume a landing-page question exactly once. The seq guard (not just a
  // null check) is load-bearing: StrictMode runs mount effects twice in dev,
  // and an unguarded auto-send would double-spend a model call.
  const lastSeqRef = useRef(0);
  useEffect(() => {
    if (!pendingPrompt || pendingPrompt.seq === lastSeqRef.current) return;
    lastSeqRef.current = pendingPrompt.seq;
    onPromptConsumed();
    if (busy) {
      setInput(pendingPrompt.text); // mid-request: prefill instead of dropping (send() no-ops while busy)
    } else {
      void send(pendingPrompt.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setError(null);
    setInput('');
    const next: DisplayMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setBusy(true);
    setProgress([]);
    try {
      const res = await postChatStream(
        next.map(({ role, content }) => ({ role, content })),
        password,
        (event) => setProgress((p) => [...p, event.detail].slice(-6)),
      );
      setMessages([
        ...next,
        {
          role: 'assistant',
          content: res.answer,
          meta: { tool_calls: res.tool_calls, usage: res.usage, capped: res.capped },
          proposal: res.report_proposal ?? undefined,
          queryResults: res.query_results && res.query_results.length > 0 ? res.query_results : undefined,
        },
      ]);
    } catch (err) {
      // Drop the unanswered question back into the input so it isn't lost.
      setMessages(messages);
      setInput(question);
      if (err instanceof ApiError && err.status === 401) {
        onAuthExpired();
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Rate limited. Wait a minute and try again.');
      } else if (err instanceof ApiError) {
        setError(`Request failed (${err.status}): ${err.message}`);
      } else {
        setError('Could not reach the server.');
      }
    } finally {
      setBusy(false);
      setProgress([]);
    }
  }

  function exportMarkdown() {
    const blob = new Blob([toMarkdown(messages)], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `thesis-companion-chat-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="chat-wrap">
      <div className="chat">
        <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              Answers are grounded in the thesis TeX, the pinned code snapshot, and the frozen W&amp;B export, and
              every factual claim carries a citation you can verify.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion" onClick={() => void send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Message
            key={i}
            msg={m}
            meta={meta}
            anchors={anchors}
            onSaveReport={(spec) => saveReport(spec, password)}
            onOpenThesis={openThesis}
          />
        ))}
        {busy && (
          <div className="msg msg-assistant">
            <div className="msg-body thinking">Consulting the sources…</div>
            {progress.length > 0 && (
              <ul className="progress-log">
                {progress.map((p, i) => (
                  <li key={i} className={i === progress.length - 1 ? 'progress-current' : undefined}>
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about the thesis, the code, or the runs… (Enter to send, Shift+Enter for a newline)"
          rows={2}
          disabled={busy}
        />
        <div className="chat-input-row">
          {messages.length > 0 && (
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
            >
              New conversation
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={exportMarkdown}
              title="Download this conversation as a markdown file (citation tokens included verbatim)"
            >
              Export .md
            </button>
          )}
          <span className="spacer" />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? 'Working…' : 'Send'}
          </button>
        </div>
      </form>
      </div>
      {thesisTarget && <ThesisPanel target={thesisTarget} onClose={() => setThesisTarget(null)} />}
    </div>
  );
}
