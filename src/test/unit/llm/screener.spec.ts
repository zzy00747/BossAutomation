import { describe, it, expect, beforeEach } from 'vitest';
import { JobScreener } from '../../../llm/screener.js';
import { MockLLMClient } from '../../__mocks__/mock-llm-client.js';
import { MockJobStorage } from '../../__mocks__/mock-storage.js';
import { fixtureJobDetail } from '../../fixtures/job-detail.js';
import { fixtureScreenPass, fixtureScreenFail } from '../../fixtures/llm-responses.js';
import { createLogger } from '../../../logger.js';
import type { Config } from '../../../config.js';
import type { ScreenResult } from '../../../types.js';

const silentLogger = createLogger({ level: 'silent', pretty: false });

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    DRY_RUN: true,
    CDP_URL: 'http://localhost:9222',
    LLM_PROVIDER: 'openai',
    LLM_MODEL: 'gpt-4o-mini',
    OPENAI_API_KEY: 'sk-test',
    MATCH_SCORE_THRESHOLD: 75,
    APPLY_DAILY_LIMIT: 20,
    DETAIL_CONCURRENCY: 3,
    LLM_CONCURRENCY: 5,
    APPLY_CONCURRENCY: 1,
    SCREENSHOT_DIR: 'data/logs/screenshots',
    DB_PATH: 'data/jobs.sqlite',
    ...overrides,
  };
}

describe('JobScreener', () => {
  let storage: MockJobStorage;
  let config: Config;

  beforeEach(() => {
    storage = new MockJobStorage();
    config = createConfig();
  });

  function createScreener(overrides: { screenResults?: ScreenResult[]; threshold?: number; intent?: string } = {}) {
    const client = new MockLLMClient({
      screenResults: overrides.screenResults ?? [fixtureScreenPass],
    });
    return new JobScreener({
      llmClient: client,
      storage,
      config: overrides.threshold ? createConfig({ MATCH_SCORE_THRESHOLD: overrides.threshold }) : config,
      jobIntent: overrides.intent ?? 'React TypeScript 前端 北京 25-40K',
      logger: silentLogger,
    });
  }

  it('首次调用 LLM 并通过 Zod 校验，未命中缓存', async () => {
    const screener = createScreener({ screenResults: [fixtureScreenPass] });

    const outcome = await screener.screen(fixtureJobDetail, 'job-001');

    expect(outcome.fromCache).toBe(false);
    expect(outcome.usedFallback).toBe(false);
    expect(outcome.result.matchScore).toBe(88);
    expect(outcome.isShortlisted).toBe(true);
  });

  it('match_score >= 阈值且无 redFlags 时 isShortlisted=true', async () => {
    const screener = createScreener({ screenResults: [fixtureScreenPass] });

    const outcome = await screener.screen(fixtureJobDetail, 'job-001');

    expect(outcome.result.matchScore).toBeGreaterThanOrEqual(75);
    expect(outcome.result.redFlags).toEqual([]);
    expect(outcome.isShortlisted).toBe(true);
  });

  it('match_score 低于阈值时 isShortlisted=false', async () => {
    const screener = createScreener({
      screenResults: [fixtureScreenFail],
      threshold: 75,
    });

    const outcome = await screener.screen(fixtureJobDetail, 'job-001');

    expect(outcome.result.matchScore).toBe(45);
    expect(outcome.isShortlisted).toBe(false);
  });

  it('存在 redFlags 时即使高分也不通过', async () => {
    const screener = createScreener({
      screenResults: [
        {
          matchScore: 90,
          salaryMatch: true,
          locationMatch: true,
          skillsMatch: 90,
          redFlags: ['可疑条款'],
          reason: '高分但有红旗',
          suggestedGreeting: '',
        },
      ],
    });

    const outcome = await screener.screen(fixtureJobDetail, 'job-001');

    expect(outcome.result.matchScore).toBe(90);
    expect(outcome.result.redFlags).toHaveLength(1);
    expect(outcome.isShortlisted).toBe(false);
  });

  it('同一 encryptJobId 7 天内命中缓存，不再调用 LLM', async () => {
    const screener = createScreener({ screenResults: [fixtureScreenPass] });

    const first = await screener.screen(fixtureJobDetail, 'job-001');
    expect(first.fromCache).toBe(false);

    const second = await screener.screen(fixtureJobDetail, 'job-001');
    expect(second.fromCache).toBe(true);
    expect(second.result.matchScore).toBe(88);
    expect(second.isShortlisted).toBe(true);
  });

  it('缓存过期后重新调用 LLM', async () => {
    const screener = new JobScreener({
      llmClient: new MockLLMClient({ screenResults: [fixtureScreenPass] }),
      storage,
      config,
      jobIntent: 'React TypeScript 前端',
      cacheTtlDays: 7,
      logger: silentLogger,
    });

    await screener.screen(fixtureJobDetail, 'job-001');

    const record = await storage.getJobById('job-001');
    expect(record?.llmCachedAt).toBeDefined();

    // 模拟缓存过期：将 llmCachedAt 改为 8 天前
    const expired = record!.llmCachedAt! - 8 * 24 * 60 * 60 * 1000;
    await storage.updateJobStatus('job-001', 'screened', { llmCachedAt: expired });

    const outcome = await screener.screen(fixtureJobDetail, 'job-001');
    expect(outcome.fromCache).toBe(false);
  });

  it('LLM 失败时降级到关键词 fallback', async () => {
    const failingLlm = new MockLLMClient();
    failingLlm.chat = async () => {
      throw new Error('LLM 不可用');
    };

    const screener = new JobScreener({
      llmClient: failingLlm,
      storage,
      config,
      jobIntent: 'React TypeScript 前端',
      logger: silentLogger,
    });

    const outcome = await screener.screen(fixtureJobDetail, 'job-001');

    expect(outcome.usedFallback).toBe(true);
    expect(outcome.result.reason).toContain('关键词');
    expect(outcome.result.skillsMatch).toBeGreaterThan(0);
  });

  it('fallback 时关键词匹配度影响 skillsMatch', async () => {
    const failingLlm = new MockLLMClient();
    failingLlm.chat = async () => {
      throw new Error('LLM 不可用');
    };

    const screener = new JobScreener({
      llmClient: failingLlm,
      storage,
      config,
      jobIntent: 'React TypeScript 前端',
      logger: silentLogger,
    });

    const outcome = await screener.screen(fixtureJobDetail, 'job-001');

    expect(outcome.result.skillsMatch).toBe(100);
  });

  it('fallback 时无关键词匹配则 skillsMatch 为 0', async () => {
    const failingLlm = new MockLLMClient();
    failingLlm.chat = async () => {
      throw new Error('LLM 不可用');
    };

    const screener = new JobScreener({
      llmClient: failingLlm,
      storage,
      config,
      jobIntent: 'Java 后端 深圳',
      logger: silentLogger,
    });

    const outcome = await screener.screen(fixtureJobDetail, 'job-001');

    expect(outcome.result.skillsMatch).toBe(0);
    expect(outcome.result.matchScore).toBeLessThan(75);
    expect(outcome.isShortlisted).toBe(false);
  });

  it('LLM 返回非法 JSON 时降级到 fallback', async () => {
    const badLlm = new MockLLMClient({
      responses: [{ content: '这不是 JSON' }],
    });

    const screener = new JobScreener({
      llmClient: badLlm,
      storage,
      config,
      jobIntent: 'React TypeScript 前端',
      logger: silentLogger,
    });

    const outcome = await screener.screen(fixtureJobDetail, 'job-001');

    expect(outcome.usedFallback).toBe(true);
  });

  it('screen 结果写入缓存供后续命中', async () => {
    const screener = createScreener({ screenResults: [fixtureScreenPass] });

    await screener.screen(fixtureJobDetail, 'job-001');

    const cached = await storage.getLLMCache('job-001');
    expect(cached).toBeDefined();
    expect(cached?.matchScore).toBe(88);
  });

  it('使用不同 encryptJobId 互不干扰', async () => {
    const screener = createScreener({
      screenResults: [fixtureScreenPass, fixtureScreenFail],
    });

    const a = await screener.screen(fixtureJobDetail, 'job-A');
    const b = await screener.screen(fixtureJobDetail, 'job-B');

    expect(a.result.matchScore).toBe(88);
    expect(b.result.matchScore).toBe(45);
    expect(a.isShortlisted).toBe(true);
    expect(b.isShortlisted).toBe(false);
  });
});
