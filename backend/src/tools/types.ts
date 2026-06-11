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
}

export interface Tool {
  readonly definition: ToolDefinition;
  execute(input: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

/** Small helper for building an error ToolResult with a stable shape. */
export function toolError(message: string): ToolResult {
  return { content: `ERROR: ${message}`, isError: true };
}
