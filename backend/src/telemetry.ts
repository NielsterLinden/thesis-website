import { Logger } from '@nestjs/common';

const logger = new Logger('telemetry');

/**
 * Operational telemetry is METADATA ONLY (Initial_plan.md §5.5): request id,
 * timestamp, password-correct boolean, tool-call names, token counts, status,
 * duration. No conversation inputs or outputs — no question text, no thesis
 * content, no model completions — ever reach a log sink. Stdout is the only
 * sink; Render surfaces it. This type makes the allowed fields explicit so a
 * future edit can't accidentally smuggle content into a log line.
 */
export interface RequestTelemetry {
  request_id: string;
  ts: string;
  route: string;
  auth_ok: boolean;
  status: number;
  duration_ms?: number;
  tool_calls?: string[]; // tool NAMES only, never arguments
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  capped?: boolean;
  note?: string; // short, content-free reason (e.g. "bad_request", "rate_limited")
}

export function logRequest(event: RequestTelemetry): void {
  logger.log(JSON.stringify(event));
}
