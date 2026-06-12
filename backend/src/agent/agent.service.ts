import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../config';
import { ReportProposal } from '../reports/spec';
import { APP_CONFIG } from '../tokens';
import { ToolRegistry } from '../tools/registry';
import { WandbQueryResultData } from '../tools/types';
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
  /**
   * The turn's wandb_query aggregates (if any ran), captured server-side from
   * the tool results — the frontend renders them as verifiable tables/charts
   * under the answer, byte-identical to what the model was shown.
   */
  query_results: WandbQueryResultData[];
}

/** Progress events streamed to the browser while a turn runs (POST
 *  /chat/stream): one per tool dispatch, so the "thinking" placeholder can
 *  narrate what the agent is actually doing. */
export interface AgentProgressEvent {
  type: 'tool_start';
  name: string;
  detail: string;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** One human-readable line per tool call for the progress stream. This goes
 *  to the requesting browser only (which sees the final answer anyway), never
 *  to logs — telemetry stays metadata-only. */
function describeToolCall(name: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'repo_grep':
      return str('pattern')
        ? `Searching the code for "${truncate(str('pattern'), 60)}"`
        : 'Searching the code';
    case 'repo_read':
      return str('path') ? `Reading ${truncate(str('path'), 80)}` : 'Reading a source file';
    case 'wandb_query': {
      const agg = str('agg') || 'median';
      const metric = str('metric');
      const groupbyRaw = input.groupby;
      const groupby = Array.isArray(groupbyRaw)
        ? groupbyRaw.filter((g): g is string => typeof g === 'string').join('+')
        : typeof groupbyRaw === 'string'
          ? groupbyRaw
          : '';
      return (
        'Querying the frozen runs' +
        (metric ? ` (${agg} of ${truncate(metric, 40)}${groupby ? ` by ${truncate(groupby, 30)}` : ''})` : '')
      );
    }
    case 'axes_lookup':
      return str('alias') ? `Looking up axis ${truncate(str('alias'), 30)}` : 'Looking up an axis';
    case 'author_report':
      return 'Validating a report proposal';
    default:
      return `Running ${name}`;
  }
}

/** Keep only the most recent `max` messages of the client-sent history,
 *  then drop any leading assistant messages so the model still sees a
 *  user-first conversation. Bounds per-turn input growth in long sessions.
 *  Exported for tests. */
export function trimHistory(history: ChatMessage[], max: number): ChatMessage[] {
  if (max <= 0 || history.length <= max) return history;
  let out = history.slice(-max);
  while (out.length > 0 && out[0].role !== 'user') out = out.slice(1);
  return out;
}

/** The author's style contract for user-visible text bans the em dash; the
 *  system prompt instructs the model, but it occasionally leaks one anyway
 *  (especially when paraphrasing TeX that contains them). Enforce here, on
 *  the final answer only, leaving code spans/fences untouched. */
export function stripEmDashes(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((segment, i) => (i % 2 === 1 ? segment : segment.replace(/\s*—\s*/g, ', ')))
    .join('');
}

function extractText(response: Anthropic.Message | null): string {
  if (!response) return '';
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Append loop-steering guidance to the trailing user message (tool_result
 *  blocks must come first in a user message, so the note goes at the end of
 *  its content array), or as a new user message after an assistant turn. */
function appendUserText(messages: Anthropic.MessageParam[], text: string): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') {
    messages.push({ role: 'user', content: text });
    return;
  }
  const content: Anthropic.ContentBlockParam[] =
    typeof last.content === 'string'
      ? [{ type: 'text', text: last.content }]
      : last.content.slice();
  content.push({ type: 'text', text });
  messages[messages.length - 1] = { ...last, content };
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
      // One extra transient-error retry over the SDK default (2): a 529
      // mid-loop otherwise throws away the whole turn's gathered evidence.
      maxRetries: 3,
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

  async chat(
    history: ChatMessage[],
    onEvent?: (event: AgentProgressEvent) => void,
  ): Promise<ChatResult> {
    const messages: Anthropic.MessageParam[] = trimHistory(
      history,
      this.config.maxHistoryMessages,
    ).map((m) => ({
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
    // Capped: a runaway turn must not balloon the response body either.
    const queryResults: WandbQueryResultData[] = [];
    const MAX_QUERY_RESULTS = 8;
    // Text salvaged from a response that hit the output-token ceiling; the
    // continuation call's text is appended to it.
    let answerPrefix = '';
    let continuedAfterTruncation = false;
    let forceFinal = false;

    // Hard iteration ceiling: at most one tool round-trip per allowed tool call,
    // plus one final no-tools call to force an answer, plus at most one
    // continuation when that answer hits the output-token ceiling.
    const maxIterations = this.config.maxToolCallsPerTurn + 3;

    for (let iter = 0; iter < maxIterations; iter++) {
      const overBudget =
        toolCalls >= this.config.maxToolCallsPerTurn ||
        usage.input_tokens >= this.config.maxConversationInputTokens;
      if (overBudget) capped = true;
      const noTools = overBudget || forceFinal;

      const request: Anthropic.MessageCreateParamsNonStreaming = {
        model: this.config.anthropicModel,
        max_tokens: this.config.maxOutputTokens,
        system: this.staticContext.systemBlocks,
        tools: this.toolDefinitions,
        // Toggling tool_choice does NOT invalidate the tools/system cache
        // (only the messages tier), so the big static prefix stays cached.
        tool_choice: noTools ? { type: 'none' } : { type: 'auto' },
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

      if (noTools || response.stop_reason !== 'tool_use') {
        const text = extractText(response);
        // The answer hit the output-token ceiling: salvage the partial text
        // and make ONE continuation call instead of returning a cut-off
        // sentence (or, worse, nothing, when the budget went to a tool call
        // or thinking that never completed).
        if (response.stop_reason === 'max_tokens' && !continuedAfterTruncation) {
          continuedAfterTruncation = true;
          forceFinal = true;
          if (text.length > 0) {
            answerPrefix = text;
            messages.push({ role: 'assistant', content: text });
            appendUserText(
              messages,
              'Your answer was cut off by the output-token limit. Continue from the exact ' +
                'point where it stopped, without repeating anything already written, and ' +
                'finish promptly.',
            );
          } else {
            appendUserText(
              messages,
              'You ran out of output tokens before any answer text appeared. State your ' +
                'final answer now, concisely.',
            );
          }
          continue;
        }
        return this.finalize(answerPrefix + text, response, toolCallNames, usage, capped, reportProposal, queryResults);
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
        const toolInput = (tu.input ?? {}) as Record<string, unknown>;
        onEvent?.({ type: 'tool_start', name: tu.name, detail: describeToolCall(tu.name, toolInput) });
        const result = await this.registry.dispatch(tu.name, toolInput);
        // Last successful proposal of the turn wins (a corrected re-proposal
        // should supersede the earlier card, not sit beside it).
        if (result.proposal && !result.isError) reportProposal = result.proposal;
        if (result.queryResult && !result.isError && queryResults.length < MAX_QUERY_RESULTS) {
          queryResults.push(result.queryResult);
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.content,
          is_error: result.isError,
        });
      }
      messages.push({ role: 'user', content: toolResults });

      // Budget steering: tell the model where it stands so the cap never
      // lands as a surprise mid-investigation. When the budget is exhausted
      // the next call is forced tool-less (overBudget above), so this note is
      // what turns that call into a grounded partial answer, not a refusal.
      const remainingCalls = this.config.maxToolCallsPerTurn - toolCalls;
      const exhausted =
        remainingCalls <= 0 ||
        usage.input_tokens >= this.config.maxConversationInputTokens;
      if (exhausted) {
        appendUserText(
          messages,
          "The tool budget for this request is now exhausted; no further tool calls will " +
            "be executed. Answer the user's question from the evidence already gathered: " +
            'state what the citations support, and name plainly anything you could not ' +
            'verify. Do not reply with only a refusal.',
        );
      } else if (remainingCalls <= 2) {
        appendUserText(
          messages,
          `Budget note: only ${remainingCalls} tool call(s) remain for this request. ` +
            'Batch any remaining independent lookups into one turn, and be ready to ' +
            'answer from what you have.',
        );
      }
    }

    // Exhausted the iteration ceiling without a terminal stop — finalize what we have.
    capped = true;
    return this.finalize(
      answerPrefix.length > 0 ? answerPrefix : extractText(lastResponse),
      lastResponse,
      toolCallNames,
      usage,
      capped,
      reportProposal,
      queryResults,
    );
  }

  private finalize(
    answerText: string,
    response: Anthropic.Message | null,
    toolCalls: string[],
    usage: ChatUsage,
    capped: boolean,
    reportProposal: ReportProposal | null,
    queryResults: WandbQueryResultData[],
  ): ChatResult {
    let answer = stripEmDashes(answerText).trim();

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
      query_results: queryResults,
    };
  }
}
