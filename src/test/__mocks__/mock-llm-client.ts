import type { ILLMClient, LLMChatOptions } from '../../interfaces/llm.js';
import type { LLMResponse, Message, ScreenResult } from '../../types.js';

export interface MockLLMClientOptions {
  responses?: LLMResponse[];
  screenResults?: ScreenResult[];
}

export class MockLLMClient implements ILLMClient {
  private responseIndex = 0;
  private screenIndex = 0;
  public chatCalls: Array<{ messages: Message[]; options?: LLMChatOptions }> = [];

  constructor(private options: MockLLMClientOptions = {}) {}

  async chat(messages: Message[], options?: LLMChatOptions): Promise<LLMResponse> {
    this.chatCalls.push({ messages, options });

    if (this.options.responses && this.options.responses.length > 0) {
      const response = this.options.responses[this.responseIndex % this.options.responses.length];
      this.responseIndex++;
      return response;
    }

    if (this.options.screenResults && this.options.screenResults.length > 0) {
      const screen = this.options.screenResults[this.screenIndex % this.options.screenResults.length];
      this.screenIndex++;
      return { content: JSON.stringify(screen) };
    }

    return { content: messages[messages.length - 1]?.content ?? '' };
  }
}
