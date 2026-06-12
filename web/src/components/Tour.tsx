import tourData from '../tour.json';
import { ChatUsage, SiteMeta, ThesisAnchors, WandbQueryResult } from '../types';
import { Message } from './Message';

/** One pre-generated tour stop: a real agent answer captured once via
 *  backend/scripts/generate-tour.mjs and committed, so the landing page can
 *  demonstrate the assistant (citation chips, math, query tables) at zero
 *  inference cost and without the password. */
interface TourItem {
  id: string;
  question: string;
  /** Why this stop is in the tour — shown above the canned answer. */
  caption?: string;
  answer: string;
  tool_calls: string[];
  usage?: ChatUsage;
  query_results?: WandbQueryResult[];
}

const ITEMS = (tourData as { items: TourItem[] }).items;

/** The guided tour stays hidden until tour.json holds generated content. */
export function Tour({
  meta,
  anchors,
  onOpenChat,
}: {
  meta: SiteMeta | null;
  anchors: ThesisAnchors | null;
  onOpenChat: () => void;
}) {
  if (ITEMS.length === 0) return null;

  return (
    <section className="landing-section tour">
      <h2>Guided tour: real answers, zero typing</h2>
      <p>
        Each card below is a real answer from the assistant, generated once and committed with the site, so you can
        inspect the citation chips, the rendered math, and the query tables before asking anything yourself.
      </p>
      {ITEMS.map((item) => (
        <details key={item.id} className="tour-card">
          <summary>
            <span className="tour-q">{item.question}</span>
          </summary>
          {item.caption && <p className="tour-caption">{item.caption}</p>}
          <Message
            msg={{
              role: 'assistant',
              content: item.answer,
              meta: item.usage ? { tool_calls: item.tool_calls, usage: item.usage, capped: false } : undefined,
              queryResults: item.query_results && item.query_results.length > 0 ? item.query_results : undefined,
            }}
            meta={meta}
            anchors={anchors}
          />
          <div className="tour-foot">
            <button type="button" className="ghost" onClick={onOpenChat}>
              Ask a follow-up in Chat
            </button>
          </div>
        </details>
      ))}
    </section>
  );
}
