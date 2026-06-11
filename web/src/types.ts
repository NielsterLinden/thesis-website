export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** A validated W&B report proposal awaiting human confirmation (Phase 2).
 *  The spec is opaque to the frontend: it is displayed via `summary` and sent
 *  back to /reports/save byte-for-byte — the browser never edits it. */
export interface ReportProposal {
  spec: unknown;
  summary: string;
}

export interface ChatResponse {
  answer: string;
  stop_reason: string | null;
  tool_calls: string[];
  usage: ChatUsage;
  capped: boolean;
  report_proposal?: ReportProposal | null;
}

/** Static facts from GET /meta: the pinned snapshot behind [code: …] blob
 *  links, plus the W&B browse URLs for the landing page (null until the
 *  W&B env vars hold real values; optional to tolerate an older backend). */
export interface SiteMeta {
  thesis_repo_url: string;
  thesis_src_commit: string;
  wandb_runs_url?: string | null;
  wandb_reports_url?: string | null;
}

/** A question handed from the landing page to Chat. `seq` makes every click a
 *  distinct value, so repeat clicks of the same question still fire and
 *  StrictMode's double-run effects cannot double-send (= double-spend). */
export interface PendingPrompt {
  text: string;
  seq: number;
}

/** An assistant turn as held in browser state: the text plus the per-turn
 *  metadata the backend returned (shown as a footer under the message). */
export interface TurnMeta {
  tool_calls: string[];
  usage: ChatUsage;
  capped: boolean;
}

export interface DisplayMessage extends ChatMessage {
  meta?: TurnMeta;
  /** Confirm card payload, attached to the assistant turn that proposed it. */
  proposal?: ReportProposal;
}
