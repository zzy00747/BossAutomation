import type { LLMResponse, Message } from '../types.js';

export interface LLMChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  topP?: number;
}

export interface ILLMClient {
  chat(messages: Message[], options?: LLMChatOptions): Promise<LLMResponse>;
}
