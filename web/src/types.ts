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

/** One aggregated group of a wandb_query result. `key` is null when the query
 *  had no groupby; `value` is null when every row was non-numeric (the backend
 *  NaN serializes to null). */
export interface WandbQueryGroup {
  key: string | null;
  value: number | null;
  n: number;
  skipped: number;
}

/** A wandb_query aggregate captured server-side and shipped outside the
 *  model's text (same pattern as ReportProposal) — rendered as a verifiable
 *  table + bar chart under the assistant message. */
export interface WandbQueryResult {
  title: string;
  metric: string;
  agg: string;
  groupby: string[];
  filters: { field: string; op: string; value: unknown }[];
  groups: WandbQueryGroup[];
  matching_runs: number;
  truncated_groups: number;
  /** The exact [wandb: …] token the tool returned, for chip <-> panel matching. */
  citation: string;
}

export interface ChatResponse {
  answer: string;
  stop_reason: string | null;
  tool_calls: string[];
  usage: ChatUsage;
  capped: boolean;
  report_proposal?: ReportProposal | null;
  query_results?: WandbQueryResult[];
}

/** Citation key -> hyperref named destination in /thesis.pdf (GET
 *  /thesis-anchors.json), e.g. "4.2" -> "section.4.2", "eq:6.1" ->
 *  "equation.6.1", "fig:intro_sm_particles" -> "figure.caption.3". */
export type ThesisAnchors = Record<string, string>;

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
  /** wandb_query aggregates of this turn, rendered as result panels. */
  queryResults?: WandbQueryResult[];
}
