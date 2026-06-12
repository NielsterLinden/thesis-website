/**
 * Tool contract shared by every MVP tool. Each tool exposes an Anthropic
 * tool-definition and an `execute` that returns text destined for a
 * `tool_result` block. Every successful result embeds citation anchors
 * (`[code: …]`, `[wandb: …]`, `[axes: …]`) so the model can satisfy the
 * citation contract (Initial_plan.md §0, §5.3).
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  /** Text returned to the model as the tool_result content. */
  content: string;
  /** Marks the tool_result block as an error so the model can recover. */
  isError?: boolean;
  /**
   * Phase 2 side channel: a validated report proposal captured by the agent
   * loop and returned to the frontend OUTSIDE the model's text, so the spec
   * the user confirms is exactly the one the validator approved — the model
   * never relays (and so can never mutate) what gets saved (§6.3).
   */
  proposal?: import('../reports/spec').ReportProposal;
  /**
   * wandb_query side channel (same pattern as `proposal`): the aggregate the
   * tool computed, captured by the agent loop and shipped to the frontend
   * outside the model's text, where it renders as a verifiable table + chart
   * under the answer. The text `content` the model sees is unchanged.
   */
  queryResult?: WandbQueryResultData;
}

/** One aggregated group of a wandb_query result (key is null when the query
 *  had no groupby and aggregated over all matching runs). */
export interface WandbQueryGroup {
  key: string | null;
  value: number;
  n: number;
  skipped: number;
}

export interface WandbQueryResultData {
  /** Human-readable header, e.g. "median of eval_v2/test_auroc grouped by B1 …". */
  title: string;
  /** Resolved metric column ('' when agg === 'count'). */
  metric: string;
  agg: string;
  /** Groupby fields as the caller named them (axis IDs or columns). */
  groupby: string[];
  filters: { field: string; op: string; value: unknown }[];
  groups: WandbQueryGroup[];
  matching_runs: number;
  /** Groups beyond the tool's display cap (shown count excludes these). */
  truncated_groups: number;
  /** The exact [wandb: …] token the tool returned, for chip <-> panel matching. */
  citation: string;
}

export interface Tool {
  readonly definition: ToolDefinition;
  execute(input: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

/** Small helper for building an error ToolResult with a stable shape. */
export function toolError(message: string): ToolResult {
  return { content: `ERROR: ${message}`, isError: true };
}
