import { describe, it, expect, beforeEach, vi } from 'vitest';

const openAIChat = vi.fn();
const anthropicCreate = vi.fn();

vi.mock('openai', () => {
  class OpenAI {
    constructor(public config: unknown) {}
    chat = { completions: { create: openAIChat } };
  }
  return { default: OpenAI };
});

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    constructor(public config: unknown) {}
    messages = { create: anthropicCreate };
  }
  return { default: Anthropic };
});

const { LLMClient, LLMError } = await import('../../../llm/client.js');

const baseMessages = [
  { role: 'system' as const, content: '你是求职顾问。' },
  { role: 'user' as const, content: '请评估这个岗位。' },
];

describe('LLMClient', () => {
  beforeEach(() => {
    openAIChat.mockReset();
    anthropicCreate.mockReset();
  });

  describe('openai provider', () => {
    it('调用 chat.completions.create 并返回 content + usage', async () => {
      openAIChat.mockResolvedValueOnce({
        choices: [{ message: { content: '{"matchScore":90}' } }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      });

      const client = new LLMClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      });

      const res = await client.chat(baseMessages, { jsonMode: true });

      expect(res.content).toBe('{"matchScore":90}');
      expect(res.usage?.promptTokens).toBe(50);
      expect(res.usage?.completionTokens).toBe(10);
      expect(res.usage?.totalTokens).toBe(60);

      const callArgs = openAIChat.mock.calls[0][0];
      expect(callArgs.model).toBe('gpt-4o-mini');
      expect(callArgs.temperature).toBe(0.2);
      expect(callArgs.max_tokens).toBe(2048);
      expect(callArgs.response_format).toEqual({ type: 'json_object' });
    });

    it('jsonMode 关闭时不传 response_format', async () => {
      openAIChat.mockResolvedValueOnce({
        choices: [{ message: { content: '回复内容' } }],
        usage: undefined,
      });

      const client = new LLMClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      });

      const res = await client.chat(baseMessages, { jsonMode: false });

      expect(res.content).toBe('回复内容');
      expect(res.usage).toBeUndefined();
      expect(openAIChat.mock.calls[0][0].response_format).toBeUndefined();
    });

    it('可覆盖 model/temperature/maxTokens', async () => {
      openAIChat.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });

      const client = new LLMClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      });

      await client.chat(baseMessages, {
        model: 'gpt-4o',
        temperature: 0.5,
        maxTokens: 512,
      });

      const args = openAIChat.mock.calls[0][0];
      expect(args.model).toBe('gpt-4o');
      expect(args.temperature).toBe(0.5);
      expect(args.max_tokens).toBe(512);
    });

    it('401 错误分类为 AUTH', async () => {
      const apiError = Object.assign(new Error('Unauthorized'), {
        status: 401,
      });
      openAIChat.mockRejectedValueOnce(apiError);

      const client = new LLMClient({
        provider: 'openai',
        apiKey: 'bad',
        model: 'gpt-4o-mini',
      });

      await expect(client.chat(baseMessages)).rejects.toMatchObject({
        kind: 'AUTH',
        status: 401,
      });
    });

    it('429 错误分类为 RATE_LIMIT', async () => {
      const apiError = Object.assign(new Error('Rate limited'), {
        status: 429,
      });
      openAIChat.mockRejectedValueOnce(apiError);

      const client = new LLMClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      });

      await expect(client.chat(baseMessages)).rejects.toMatchObject({
        kind: 'RATE_LIMIT',
      });
    });

    it('5xx 错误分类为 SERVER', async () => {
      const apiError = Object.assign(new Error('Server error'), {
        status: 503,
      });
      openAIChat.mockRejectedValueOnce(apiError);

      const client = new LLMClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      });

      await expect(client.chat(baseMessages)).rejects.toMatchObject({
        kind: 'SERVER',
      });
    });

    it('网络错误分类为 NETWORK', async () => {
      const networkError = Object.assign(new Error('connect failed'), {
        code: 'ETIMEDOUT',
      });
      openAIChat.mockRejectedValueOnce(networkError);

      const client = new LLMClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      });

      await expect(client.chat(baseMessages)).rejects.toMatchObject({
        kind: 'NETWORK',
      });
    });

    it('LLMError 实例可被 instanceof 识别', async () => {
      openAIChat.mockRejectedValueOnce(
        Object.assign(new Error('Unauthorized'), { status: 401 }),
      );

      const client = new LLMClient({
        provider: 'openai',
        apiKey: 'bad',
        model: 'gpt-4o-mini',
      });

      try {
        await client.chat(baseMessages);
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
      }
    });
  });

  describe('anthropic provider', () => {
    it('调用 messages.create 并返回 content + usage', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"matchScore":85}' }],
        usage: { input_tokens: 40, output_tokens: 8 },
      });

      const client = new LLMClient({
        provider: 'anthropic',
        apiKey: 'ant-key',
        model: 'claude-sonnet-4-6',
      });

      const res = await client.chat(baseMessages, { jsonMode: true });

      expect(res.content).toBe('{"matchScore":85}');
      expect(res.usage?.promptTokens).toBe(40);
      expect(res.usage?.completionTokens).toBe(8);

      const callArgs = anthropicCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-sonnet-4-6');
      expect(callArgs.max_tokens).toBe(2048);
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe('user');
      expect(callArgs.system).toContain('JSON');
    });

    it('jsonMode 时 system 消息追加 JSON 指令', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'result' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const client = new LLMClient({
        provider: 'anthropic',
        apiKey: 'ant-key',
        model: 'claude-sonnet-4-6',
      });

      await client.chat(baseMessages, { jsonMode: true });

      const systemContent = anthropicCreate.mock.calls[0][0].system;
      expect(systemContent).toContain('你是求职顾问。');
      expect(systemContent).toContain('只输出合法 JSON');
    });

    it('jsonMode 关闭时 system 不追加 JSON 指令', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'result' }],
      });

      const client = new LLMClient({
        provider: 'anthropic',
        apiKey: 'ant-key',
        model: 'claude-sonnet-4-6',
      });

      await client.chat(baseMessages, { jsonMode: false });

      const systemContent = anthropicCreate.mock.calls[0][0].system;
      expect(systemContent).toBe('你是求职顾问。');
    });

    it('无 system 消息且 jsonMode 时注入 JSON 指令作为 system', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'result' }],
      });

      const client = new LLMClient({
        provider: 'anthropic',
        apiKey: 'ant-key',
        model: 'claude-sonnet-4-6',
      });

      await client.chat(
        [{ role: 'user', content: '评估岗位' }],
        { jsonMode: true },
      );

      expect(anthropicCreate.mock.calls[0][0].system).toContain('只输出合法 JSON');
    });

    it('非 text 块时返回空字符串', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't1' }],
      });

      const client = new LLMClient({
        provider: 'anthropic',
        apiKey: 'ant-key',
        model: 'claude-sonnet-4-6',
      });

      const res = await client.chat(baseMessages);
      expect(res.content).toBe('');
    });

    it('429 错误分类为 RATE_LIMIT', async () => {
      anthropicCreate.mockRejectedValueOnce(
        Object.assign(new Error('Rate limited'), { status: 429 }),
      );

      const client = new LLMClient({
        provider: 'anthropic',
        apiKey: 'ant-key',
        model: 'claude-sonnet-4-6',
      });

      await expect(client.chat(baseMessages)).rejects.toMatchObject({
        kind: 'RATE_LIMIT',
      });
    });
  });

  describe('配置', () => {
    it('baseURL 透传给 SDK', async () => {
      openAIChat.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });

      const client = new LLMClient({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        baseURL: 'https://proxy.example.com/v1',
        temperature: 0.7,
        maxTokens: 1024,
      });

      await client.chat(baseMessages);

      const args = openAIChat.mock.calls[0][0];
      expect(args.temperature).toBe(0.7);
      expect(args.max_tokens).toBe(1024);
    });

    it('不支持的 provider 抛出 CLIENT 错误', () => {
      expect(
        () =>
          new LLMClient({
            provider: 'unknown' as never,
            apiKey: 'x',
            model: 'm',
          }),
      ).toThrow();
    });
  });
});
