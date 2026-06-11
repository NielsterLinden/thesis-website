import { BadRequestException, Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SitePasswordGuard } from '../auth/site-password.guard';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { logRequest } from '../telemetry';
import { AgentService, ChatMessage } from './agent.service';
import { ChatResponseDto } from './dto';

const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 100_000;

type ReqWithMeta = Request & { requestId?: string; startTime?: number };

@Controller()
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  /**
   * POST /chat — the gated agent turn. Stateless: the client sends the full
   * conversation history; the server runs the agent loop and returns the final
   * answer (with inline citations) plus metadata. Guard order matters:
   * rate-limit first (throttles brute force), then the password gate.
   */
  @Post('chat')
  @HttpCode(200)
  @UseGuards(RateLimitGuard, SitePasswordGuard)
  async chat(@Body() body: unknown, @Req() req: ReqWithMeta): Promise<ChatResponseDto> {
    const requestId = req.requestId ?? 'unknown';
    const start = req.startTime ?? Date.now();

    const messages = this.validate(body, requestId, req.path);

    const result = await this.agent.chat(messages);

    logRequest({
      request_id: requestId,
      ts: new Date().toISOString(),
      route: req.path,
      auth_ok: true,
      status: 200,
      duration_ms: Date.now() - start,
      tool_calls: result.tool_calls,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      cache_read_input_tokens: result.usage.cache_read_input_tokens,
      cache_creation_input_tokens: result.usage.cache_creation_input_tokens,
      capped: result.capped,
    });

    return {
      answer: result.answer,
      stop_reason: result.stop_reason,
      tool_calls: result.tool_calls,
      usage: result.usage,
      capped: result.capped,
    };
  }

  private validate(body: unknown, requestId: string, route: string): ChatMessage[] {
    const reject = (msg: string): never => {
      logRequest({
        request_id: requestId,
        ts: new Date().toISOString(),
        route,
        auth_ok: true,
        status: 400,
        note: 'bad_request',
      });
      throw new BadRequestException(msg);
    };

    if (typeof body !== 'object' || body === null || !Array.isArray((body as { messages?: unknown }).messages)) {
      return reject('Request body must be an object with a "messages" array.');
    }
    const raw = (body as { messages: unknown[] }).messages;
    if (raw.length === 0) return reject('"messages" must be non-empty.');
    if (raw.length > MAX_MESSAGES) return reject(`"messages" cannot exceed ${MAX_MESSAGES} entries.`);

    const messages: ChatMessage[] = [];
    for (const m of raw) {
      if (typeof m !== 'object' || m === null) return reject('Each message must be an object {role, content}.');
      const role = (m as { role?: unknown }).role;
      const content = (m as { content?: unknown }).content;
      if (role !== 'user' && role !== 'assistant') return reject('message.role must be "user" or "assistant".');
      if (typeof content !== 'string' || content.length === 0) {
        return reject('message.content must be a non-empty string.');
      }
      if (content.length > MAX_CONTENT_CHARS) return reject('A message exceeds the maximum length.');
      messages.push({ role, content });
    }
    if (messages[messages.length - 1].role !== 'user') {
      return reject('The last message must be from the user.');
    }
    return messages;
  }
}
