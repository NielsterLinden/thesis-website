import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../config';
import { ReportProposal } from '../reports/spec';
import { APP_CONFIG } from '../tokens';
import { ToolRegistry } from '../tools/registry';
import { buildStaticContext, StaticContext } from './static-context';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatUsage {
  input_tokens: number; // uncached conversation input (the capped quantity)
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface ChatResult {
  answer: string;
  stop_reason: string | null;
  tool_calls: string[];
  usage: ChatUsage;
  capped: boolean;
  /**
   * Phase 2: the turn's validated report proposal (if author_report ran),
   * captured server-side from the tool result. The model's text never carries
   * the spec, so what the user confirms is exactly what the validator passed.
   */
  report_proposal: ReportProposal | null;
}

/** Add a cache_control breakpoint to the last message so the conversation
 *  prefix (which grows with each tool round-trip) is cached too. Returns a
 *  shallow copy; the stored messages stay marker-free so we never exceed the
 *  4-breakpoint limit (1 static prefix + 1 conversation = 2). */
function withLastMessageCached(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  const cache = { type: 'ephemeral' as const };
  let content: Anthropic.ContentBlockParam[];
  if (typeof last.content === 'string') {
    content = [{ type: 'text', text: last.content, cache_control: cache }];
  } else {
    content = last.content.map((b, i, arr) =>
      i === arr.length - 1 ? ({ ...b, cache_control: cache } as Anthropic.ContentBlockParam) : b,
    );
  }
  out[out.length - 1] = { ...last, content };
  return out;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly anthropic: Anthropic;
  private readonly registry: ToolRegistry;
  private readonly toolDefinitions: Anthropic.Tool[];
  private readonly staticContext: StaticContext;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    // Placeholder when unset so the process can still boot (health check, static
    // serving) without a key; /chat then fails cleanly at the API, not at startup.
    this.anthropic = new Anthropic({
      apiKey: config.anthropicApiKey || 'ANTHROPIC_API_KEY_NOT_CONFIGURED',
    });
    this.registry = ToolRegistry.build(config);
    this.toolDefinitions = this.registry.definitions() as Anthropic.Tool[];
    this.staticContext = buildStaticContext(config);

    this.logger.log(
      `Static prompt prefix: ~${this.staticContext.approxTokens.toLocaleString()} tokens ` +
        `(${this.staticContext.thesisFiles.length} thesis files), ` +
        `${this.toolDefinitions.length} tools, model=${config.anthropicModel}, ` +
        `effort=${config.anthropicEffort}.`,
    );
  }

  /** Stats for the startup/health log; never includes conversation content. */
  contextStats(): { approxTokens: number; thesisFiles: number; tools: number } {
    return {
      approxTokens: this.staticContext.approxTokens,
      thesisFiles: this.staticContext.thesisFiles.length,
      tools: this.toolDefinitions.length,
    };
  }

  async chat(history: ChatMessage[]): Promise<ChatResult> {
    const messages: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const usage: ChatUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    const toolCallNames: string[] = [];
    let toolCalls = 0;
    let capped = false;
    let lastResponse: Anthropic.Message | null = null;
    let reportProposal: ReportProposal | null = null;

    // Hard iteration ceiling: at most one tool round-trip per allowed tool call,
    // plus one final no-tools call to force an answer.
    const maxIterations = this.config.maxToolCallsPerTurn + 2;

    for (let iter = 0; iter < maxIterations; iter++) {
      const overBudget =
        toolCalls >= this.config.maxToolCallsPerTurn ||
        usage.input_tokens >= this.config.maxConversationInputTokens;
      if (overBudget) capped = true;

      const request: Anthropic.MessageCreateParamsNonStreaming = {
        model: this.config.anthropicModel,
        max_tokens: this.config.maxOutputTokens,
        system: this.staticContext.systemBlocks,
        tools: this.toolDefinitions,
        // Toggling tool_choice does NOT invalidate the tools/system cache
        // (only the messages tier), so the big static prefix stays cached.
        tool_choice: overBudget ? { type: 'none' } : { type: 'auto' },
        messages: withLastMessageCached(messages),
      };
      // effort=none omits both params: models without adaptive-thinking
      // support (e.g. claude-haiku-4-5) 400 on either one.
      if (this.config.anthropicEffort !== 'none') {
        request.thinking = { type: 'adaptive' };
        request.output_config = { effort: this.config.anthropicEffort };
      }
      const response = await this.anthropic.messages.create(request);
      lastResponse = response;

      // usage.input_tokens is the UNCACHED conversation remainder; the ~static
      // prefix lands in cache_read/cache_creation and is intentionally excluded
      // from the conversation-input cap (Initial_plan.md §5.2).
      usage.input_tokens += response.usage.input_tokens;
      usage.output_tokens += response.usage.output_tokens;
      usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;
      usage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens ?? 0;

      if (overBudget || response.stop_reason !== 'tool_use') {
        return this.finalize(response, toolCallNames, usage, capped, reportProposal);
      }

      // Preserve the full assistant content (incl. thinking + tool_use blocks,
      // with their signatures) before answering the tool calls.
      messages.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        toolCalls++;
        toolCallNames.push(tu.name);
        if (toolCalls > this.config.maxToolCallsPerTurn) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: 'Per-request tool-call limit reached. Answer from what you already have.',
            is_error: true,
          });
          continue;
        }
        const result = await this.registry.dispatch(
          tu.name,
          (tu.input ?? {}) as Record<string, unknown>,
        );
        // Last successful proposal of the turn wins (a corrected re-proposal
        // should supersede the earlier card, not sit beside it).
        if (result.proposal && !result.isError) reportProposal = result.proposal;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.content,
          is_error: result.isError,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // Exhausted the iteration ceiling without a terminal stop — finalize what we have.
    capped = true;
    return this.finalize(lastResponse, toolCallNames, usage, capped, reportProposal);
  }

  private finalize(
    response: Anthropic.Message | null,
    toolCalls: string[],
    usage: ChatUsage,
    capped: boolean,
    reportProposal: ReportProposal | null,
  ): ChatResult {
    let answer = response
      ? response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()
      : '';

    if (answer.length === 0) {
      answer = capped
        ? 'I reached this request’s work limit before I could finish. Please narrow the question or ask again.'
        : 'I was unable to produce an answer for that question.';
    }

    return {
      answer,
      stop_reason: response?.stop_reason ?? null,
      tool_calls: toolCalls,
      usage,
      capped,
      report_proposal: reportProposal,
    };
  }
}
