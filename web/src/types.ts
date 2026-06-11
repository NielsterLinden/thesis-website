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

export interface ChatResponse {
  answer: string;
  stop_reason: string | null;
  tool_calls: string[];
  usage: ChatUsage;
  capped: boolean;
}

/** Static facts from GET /meta, used to build [code: …] blob links. */
export interface SiteMeta {
  thesis_repo_url: string;
  thesis_src_commit: string;
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
}
