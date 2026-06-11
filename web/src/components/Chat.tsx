import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ApiError, postChat, saveReport } from '../api';
import { DisplayMessage, SiteMeta } from '../types';
import { Message } from './Message';

/** Seed questions mirroring the §9 acceptance checks, so a first-time
 *  examiner sees what each tool surface can do. */
const SUGGESTIONS = [
  'Summarize the input-representation chapter.',
  'How is the FFN type resolved between standard, KAN, and MoE?',
  'What is the median test AUROC for the d256_L6 baseline, grouped by B1?',
  'What does A3 control, and where in the code is it implemented?',
];

export function Chat({
  meta,
  password,
  onAuthExpired,
}: {
  meta: SiteMeta | null;
  password: string;
  onAuthExpired: () => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setError(null);
    setInput('');
    const next: DisplayMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await postChat(
        next.map(({ role, content }) => ({ role, content })),
        password,
      );
      setMessages([
        ...next,
        {
          role: 'assistant',
          content: res.answer,
          meta: { tool_calls: res.tool_calls, usage: res.usage, capped: res.capped },
          proposal: res.report_proposal ?? undefined,
        },
      ]);
    } catch (err) {
      // Drop the unanswered question back into the input so it isn't lost.
      setMessages(messages);
      setInput(question);
      if (err instanceof ApiError && err.status === 401) {
        onAuthExpired();
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Rate limited — wait a minute and try again.');
      } else if (err instanceof ApiError) {
        setError(`Request failed (${err.status}): ${err.message}`);
      } else {
        setError('Could not reach the server.');
      }
    } finally {
      setBusy(false);
    }
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
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              Answers are grounded in the thesis TeX, the pinned code snapshot, and the frozen W&amp;B export — every
              factual claim carries a citation you can verify.
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
          <Message key={i} msg={m} meta={meta} onSaveReport={(spec) => saveReport(spec, password)} />
        ))}
        {busy && (
          <div className="msg msg-assistant">
            <div className="msg-body thinking">Consulting the sources…</div>
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
          <span className="spacer" />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? 'Working…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
