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
}
