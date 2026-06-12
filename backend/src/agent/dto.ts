import { ReportProposal } from '../reports/spec';
import { WandbQueryResultData } from '../tools/types';
import { ChatUsage } from './agent.service';

export interface ChatMessageDto {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequestDto {
  messages: ChatMessageDto[];
}

export interface ChatResponseDto {
  answer: string;
  stop_reason: string | null;
  tool_calls: string[];
  usage: ChatUsage;
  capped: boolean;
  /** Phase 2: validated report proposal for the confirm card (null when none). */
  report_proposal: ReportProposal | null;
  /** wandb_query aggregates of this turn, for the verifiable result tables. */
  query_results: WandbQueryResultData[];
}
