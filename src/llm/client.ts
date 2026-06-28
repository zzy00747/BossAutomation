import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { ILLMClient, LLMChatOptions } from '../interfaces/llm.js';
import type { LLMResponse, Message } from '../types.js';
import { createChild } from '../logger.js';

const logger = createChild('LLMClient');

export type LLMProvider = 'openai' | 'anthropic';

export interface LLMClientConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
}

export type LLMErrorKind =
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'SERVER'
  | 'NETWORK'
  | 'CLIENT'
  | 'UNKNOWN';

export class LLMError extends Error {
  readonly kind: LLMErrorKind;
  readonly status?: number;
  constructor(kind: LLMErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind;
    this.status = status;
  }
}

export const JSON_INSTRUCTION =
  '只输出合法 JSON，不要包含任何解释文字、Markdown 代码块标记或前后缀。';

const ANTHROPIC_JSON_SUFFIX = `\n\n${JSON_INSTRUCTION}`;

function classifyStatus(status: number | undefined): LLMErrorKind {
  if (status === undefined) return 'UNKNOWN';
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'SERVER';
  if (status >= 400) return 'CLIENT';
  return 'UNKNOWN';
}

function toLLMError(error: unknown): LLMError {
  if (error instanceof LLMError) return error;

  const apiError = error as {
    status?: number;
    statusCode?: number;
    message?: string;
    name?: string;
    code?: string;
  };

  const status = apiError.status ?? apiError.statusCode;
  const message = apiError.message ?? String(error);

  if (apiError.code === 'ECONNRESET' || apiError.code === 'ETIMEDOUT' || apiError.code === 'ENOTFOUND') {
    return new LLMError('NETWORK', `网络错误: ${message}`);
  }

  if (status !== undefined) {
    const kind = classifyStatus(status);
    const hint =
      kind === 'AUTH'
        ? '（API Key 配置错误或无权限）'
        : kind === 'RATE_LIMIT'
          ? '（触发限流，请降速并退避）'
          : kind === 'SERVER'
            ? '（LLM 服务端错误）'
            : '';
    return new LLMError(kind, `LLM 请求失败 [${status}]: ${message}${hint}`, status);
  }

  return new LLMError('UNKNOWN', `LLM 未知错误: ${message}`);
}

interface OpenAIChatParams {
  model: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
  top_p?: number;
}

export class LLMClient implements ILLMClient {
  private readonly openai?: OpenAI;
  private readonly anthropic?: Anthropic;
  private readonly config: Required<Omit<LLMClientConfig, 'baseURL'>> &
    Pick<LLMClientConfig, 'baseURL'>;

  constructor(config: LLMClientConfig) {
    this.config = {
      temperature: 0.2,
      maxTokens: 2048,
      baseURL: undefined,
      ...config,
    };

    if (config.provider === 'openai') {
      this.openai = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
    } else if (config.provider === 'anthropic') {
      this.anthropic = new Anthropic({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
    } else {
      throw new LLMError('CLIENT', `不支持的 provider: ${config.provider as string}`);
    }
  }

  async chat(messages: Message[], options?: LLMChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? this.config.model;
    const temperature = options?.temperature ?? this.config.temperature;
    const maxTokens = options?.maxTokens ?? this.config.maxTokens;
    const jsonMode = options?.jsonMode ?? false;

    try {
      if (this.config.provider === 'openai') {
        return await this.chatOpenAI(messages, { model, temperature, maxTokens, jsonMode, topP: options?.topP });
      }
      return await this.chatAnthropic(messages, { model, temperature, maxTokens, jsonMode, topP: options?.topP });
    } catch (error) {
      const wrapped = toLLMError(error);
      logger.error(
        { kind: wrapped.kind, status: wrapped.status, model },
        `LLM 调用失败: ${wrapped.message}`,
      );
      throw wrapped;
    }
  }

  private async chatOpenAI(
    messages: Message[],
    opts: { model: string; temperature: number; maxTokens: number; jsonMode: boolean; topP?: number },
  ): Promise<LLMResponse> {
    const params: OpenAIChatParams = {
      model: opts.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      top_p: opts.topP,
    };
    if (opts.jsonMode) {
      params.response_format = { type: 'json_object' };
    }

    const response = await this.openai!.chat.completions.create(params);
    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';

    return {
      content,
      ...(response.usage && {
        usage: {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        },
      }),
    };
  }

  private async chatAnthropic(
    messages: Message[],
    opts: { model: string; temperature: number; maxTokens: number; jsonMode: boolean; topP?: number },
  ): Promise<LLMResponse> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    const params: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      top_p: opts.topP,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) {
      params.system = opts.jsonMode
        ? `${systemMsg.content}${ANTHROPIC_JSON_SUFFIX}`
        : systemMsg.content;
    } else if (opts.jsonMode) {
      params.system = JSON_INSTRUCTION;
    }

    const response = (await this.anthropic!.messages.create(
      params as unknown as Anthropic.MessageCreateParams,
    )) as Anthropic.Message;

    const textBlock = response.content.find((b) => b.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    const content = textBlock?.text ?? '';

    return {
      content,
      ...(response.usage && {
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
        },
      }),
    };
  }
}
