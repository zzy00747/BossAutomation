import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApplyService } from '../../../platform/boss/apply.js';
import { SecurityIdResolver } from '../../../platform/boss/security-id-resolver.js';
import { MockBossAPIClient } from '../../__mocks__/mock-api-client.js';
import { MockJobStorage } from '../../__mocks__/mock-storage.js';
import { fixtureScreenPass } from '../../fixtures/llm-responses.js';
import { createLogger } from '../../../logger.js';
import type { NormalizedJob, ScreenResult } from '../../../types.js';
import type { Config } from '../../../config.js';

const silentLogger = createLogger({ level: 'silent', pretty: false });
const noopSleep = vi.fn(async (_min: number, _max: number): Promise<void> => {});

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

const baseJob: NormalizedJob = {
  encryptJobId: 'job-001',
  securityId: 'sec-001-long-enough',
  jobName: '高级前端工程师',
  brandName: '字节跳动',
};

function makeApplyInput(job: NormalizedJob = baseJob, screen: ScreenResult = fixtureScreenPass) {
  return { ...job, screenResult: screen };
}

describe('ApplyService', () => {
  let api: MockBossAPIClient;
  let storage: MockJobStorage;
  let resolver: SecurityIdResolver;

  beforeEach(() => {
    storage = new MockJobStorage();
    api = new MockBossAPIClient();
    resolver = new SecurityIdResolver({ apiClient: api, logger: silentLogger });
    noopSleep.mockClear();
  });

  function createService(config: Config = createConfig()) {
    return new ApplyService({
      apiClient: api,
      securityIdResolver: resolver,
      storage,
      config,
      logger: silentLogger,
      sleepFn: noopSleep,
    });
  }

  it('Dry-run 模式不调用 greetBoss，记录 applied + skipReason=dry-run', async () => {
    const service = createService(createConfig({ DRY_RUN: true }));

    const result = await service.apply(makeApplyInput());

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(api.greetBossCalls).toHaveLength(0);

    const record = await storage.getJobById('job-001');
    expect(record?.status).toBe('applied');
    expect(record?.skipReason).toBe('dry-run');
    expect(record?.appliedAt).toBeDefined();
  });

  it('Dry-run 模式不触发 sleep', async () => {
    const service = createService(createConfig({ DRY_RUN: true }));

    await service.apply(makeApplyInput());

    expect(noopSleep).not.toHaveBeenCalled();
  });

  it('真实模式调用 greetBoss 并附带 suggested_greeting', async () => {
    const service = createService(createConfig({ DRY_RUN: false }));

    const result = await service.apply(makeApplyInput());

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(api.greetBossCalls).toHaveLength(1);
    expect(api.greetBossCalls[0].securityId).toBe('sec-001-long-enough');
    expect(api.greetBossCalls[0].encryptJobId).toBe('job-001');
    expect(api.greetBossCalls[0].greeting).toBe(fixtureScreenPass.suggestedGreeting);

    const record = await storage.getJobById('job-001');
    expect(record?.status).toBe('applied');
    expect(record?.screenResultJson).toContain(String(fixtureScreenPass.matchScore));
  });

  it('真实模式投递前后各 sleep 一次（10-20s 间隔）', async () => {
    const service = createService(createConfig({ DRY_RUN: false }));

    await service.apply(makeApplyInput());

    expect(noopSleep).toHaveBeenCalledTimes(2);
    const [first, second] = noopSleep.mock.calls;
    expect(first[0]).toBe(10000);
    expect(first[1]).toBe(20000);
    expect(second[0]).toBe(10000);
    expect(second[1]).toBe(20000);
  });

  it('securityId 解析失败时不投递，记录 failed', async () => {
    const job: NormalizedJob = {
      encryptJobId: 'job-no-sec',
      jobName: '前端',
      brandName: '某公司',
    };
    const failingResolver = {
      resolve: vi.fn().mockResolvedValue(null),
      validate: vi.fn(),
    } as unknown as SecurityIdResolver;

    const service = new ApplyService({
      apiClient: api,
      securityIdResolver: failingResolver,
      storage,
      config: createConfig({ DRY_RUN: false }),
      logger: silentLogger,
      sleepFn: noopSleep,
    });

    const result = await service.apply(makeApplyInput(job));

    expect(result.success).toBe(false);
    expect(result.error).toContain('securityId');
    expect(api.greetBossCalls).toHaveLength(0);

    const record = await storage.getJobById('job-no-sec');
    expect(record?.status).toBe('failed');
    expect(record?.failedReason).toContain('securityId');
  });

  it('greetBoss 返回 success=false 时记录 failed', async () => {
    api = new MockBossAPIClient({ greetSuccess: false });
    resolver = new SecurityIdResolver({ apiClient: api, logger: silentLogger });
    const service = createService(createConfig({ DRY_RUN: false }));

    const result = await service.apply(makeApplyInput());

    expect(result.success).toBe(false);
    expect(api.greetBossCalls).toHaveLength(1);

    const record = await storage.getJobById('job-001');
    expect(record?.status).toBe('failed');
    expect(record?.failedReason).toContain('greetBoss');
  });

  it('greetBoss 抛出异常时捕获并记录 failed', async () => {
    api.greetBoss = vi.fn().mockRejectedValue(new Error('网络中断'));
    const service = createService(createConfig({ DRY_RUN: false }));

    const result = await service.apply(makeApplyInput());

    expect(result.success).toBe(false);
    expect(result.error).toBe('网络中断');

    const record = await storage.getJobById('job-001');
    expect(record?.status).toBe('failed');
    expect(record?.failedReason).toBe('网络中断');
  });

  it('无 suggested_greeting 时不附带打招呼语', async () => {
    const service = createService(createConfig({ DRY_RUN: false }));
    const screenWithoutGreeting: ScreenResult = {
      ...fixtureScreenPass,
      suggestedGreeting: '',
    };

    await service.apply(makeApplyInput(baseJob, screenWithoutGreeting));

    expect(api.greetBossCalls[0].greeting).toBeUndefined();
  });
});
