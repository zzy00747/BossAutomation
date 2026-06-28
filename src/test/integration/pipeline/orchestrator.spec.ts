import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Orchestrator } from '../../../pipeline/orchestrator.js';
import { MockJobStorage } from '../../__mocks__/mock-storage.js';
import { MockLLMClient } from '../../__mocks__/mock-llm-client.js';
import { MockBossAPIClient } from '../../__mocks__/mock-api-client.js';
import { JobScreener } from '../../../llm/screener.js';
import { ApplyService } from '../../../platform/boss/apply.js';
import { SecurityIdResolver } from '../../../platform/boss/security-id-resolver.js';
import { createLogger } from '../../../logger.js';
import { fixtureScreenPass } from '../../fixtures/llm-responses.js';
import type { JobSearchService } from '../../../platform/boss/search.js';
import type { JobDetailService } from '../../../platform/boss/job-detail.js';
import type { BrowserManager } from '../../../browser/manager.js';
import type { SessionManager } from '../../../platform/boss/session-manager.js';
import type { Config } from '../../../config.js';
import type { JobDetail, JobSearchParams, NormalizedJob } from '../../../types.js';

const silentLogger = createLogger({ level: 'silent', pretty: false });
const FIXED_DATE = new Date('2026-06-28T10:00:00Z');

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

function makeJob(id: string): NormalizedJob {
  return {
    encryptJobId: id,
    securityId: `sec-${id}-long-enough`,
    jobName: `高级前端工程师 ${id}`,
    brandName: id.startsWith('bad') ? '黑名单公司' : '某科技公司',
  };
}

function makeDetail(id: string): JobDetail {
  return {
    encryptJobId: id,
    securityId: `sec-${id}-long-enough`,
    jobName: `高级前端工程师 ${id}`,
    brandName: '某科技公司',
    salary: '25-40K',
    location: '北京',
    postDescription: `JD 正文 ${id}，React TypeScript 前端`,
    fetchedAt: Date.now(),
  };
}

class FakeBrowserManager {
  public connected = false;
  async connect() {
    this.connected = true;
  }
  async disconnect() {
    this.connected = false;
  }
}

class FakeSessionManager {
  async checkLoginState() {
    return true;
  }
  async refreshSession() {
    return true;
  }
}

class FakeSearchService {
  public calls: JobSearchParams[] = [];
  constructor(private jobs: NormalizedJob[]) {}
  async fetchAllPages(params: JobSearchParams): Promise<NormalizedJob[]> {
    this.calls.push(params);
    return this.jobs;
  }
}

class FakeJobDetailService {
  async getJobDetail(job: NormalizedJob): Promise<JobDetail> {
    return makeDetail(job.encryptJobId);
  }
}

describe('Orchestrator 集成测试', () => {
  let storage: MockJobStorage;
  let api: MockBossAPIClient;
  let llm: MockLLMClient;
  let browserManager: FakeBrowserManager;
  let sessionManager: FakeSessionManager;

  beforeEach(() => {
    storage = new MockJobStorage();
    api = new MockBossAPIClient();
    browserManager = new FakeBrowserManager();
    sessionManager = new FakeSessionManager();
    llm = new MockLLMClient({
      screenResults: [fixtureScreenPass],
    });
  });

  function buildOrchestrator(config: Config = createConfig(), jobs: NormalizedJob[] = [makeJob('1'), makeJob('2')]) {
    const searchService = new FakeSearchService(jobs) as unknown as JobSearchService;
    const jobDetailService = new FakeJobDetailService() as unknown as JobDetailService;
    const jobScreener = new JobScreener({
      llmClient: llm,
      storage,
      config,
      jobIntent: 'React TypeScript 前端',
      logger: silentLogger,
    });
    const securityIdResolver = new SecurityIdResolver({
      apiClient: api,
      logger: silentLogger,
    });
    const applyService = new ApplyService({
      apiClient: api,
      securityIdResolver,
      storage,
      config,
      logger: silentLogger,
      sleepFn: async () => {},
    });

    const orchestrator = new Orchestrator({
      browserManager: browserManager as unknown as Pick<BrowserManager, 'connect' | 'disconnect'>,
      sessionManager: sessionManager as unknown as Pick<SessionManager, 'checkLoginState' | 'refreshSession'>,
      searchService,
      jobDetailService,
      jobScreener,
      applyService,
      storage,
      config,
      logger: silentLogger,
      now: () => FIXED_DATE,
      applySleepFn: async () => {},
    });

    return { orchestrator, searchService };
  }

  it('完整 Dry-run 流程：搜索→详情→筛选→投递（不真实调用 API）', async () => {
    const { orchestrator } = buildOrchestrator(
      createConfig({ DRY_RUN: true, APPLY_DAILY_LIMIT: 20 }),
      [makeJob('1'), makeJob('2')],
    );

    const result = await orchestrator.run({
      searchConfigs: [
        { sourceKeyword: '前端', params: { keyword: '前端' } as unknown as JobSearchParams },
      ],
      detailConcurrency: 2,
      llmConcurrency: 2,
      applyConcurrency: 1,
    });

    expect(result.interrupted).toBe(false);
    expect(result.producerStats.enqueued).toBe(2);
    expect(result.detailStats.succeeded).toBe(2);
    expect(result.screenerStats.shortlisted).toBe(2);
    expect(result.applyStats.applied).toBe(2);

    // Dry-run 不应调用真实 greetBoss
    expect(api.greetBossCalls).toHaveLength(0);

    // 投递记录写入 storage
    const job1 = await storage.getJobById('1');
    expect(job1?.status).toBe('applied');
    expect(job1?.skipReason).toBe('dry-run');

    // 浏览器已断开
    expect(browserManager.connected).toBe(false);
  });

  it('登录态检查失败时抛出错误', async () => {
    const failingSession = {
      checkLoginState: async () => false,
      refreshSession: async () => false,
    };
    const { orchestrator } = buildOrchestrator();
    orchestrator['deps'].sessionManager = failingSession as never;

    await expect(
      orchestrator.run({
        searchConfigs: [{ sourceKeyword: '前端', params: {} as JobSearchParams }],
      }),
    ).rejects.toThrow('登录态检查失败');

    expect(browserManager.connected).toBe(false);
  });

  it('已处理职位在再次启动时被跳过', async () => {
    const { orchestrator: orch1 } = buildOrchestrator(
      createConfig({ DRY_RUN: true }),
      [makeJob('1'), makeJob('2')],
    );

    await orch1.run({
      searchConfigs: [{ sourceKeyword: '前端', params: {} as JobSearchParams }],
      detailConcurrency: 1,
      llmConcurrency: 1,
    });

    // 第二次运行，相同职位应被去重
    const { orchestrator: orch2 } = buildOrchestrator(
      createConfig({ DRY_RUN: true }),
      [makeJob('1'), makeJob('2'), makeJob('3')],
    );

    const result = await orch2.run({
      searchConfigs: [{ sourceKeyword: '前端', params: {} as JobSearchParams }],
      detailConcurrency: 1,
      llmConcurrency: 1,
    });

    expect(result.producerStats.enqueued).toBe(1);
    expect(result.producerStats.skippedDuplicate).toBe(2);
    expect(result.applyStats.applied).toBe(1);
  });

  it('日上限生效：达到上限后停止投递', async () => {
    const { orchestrator } = buildOrchestrator(
      createConfig({ DRY_RUN: true, APPLY_DAILY_LIMIT: 1 }),
      [makeJob('1'), makeJob('2')],
    );

    const result = await orchestrator.run({
      searchConfigs: [{ sourceKeyword: '前端', params: {} as JobSearchParams }],
      detailConcurrency: 1,
      llmConcurrency: 1,
    });

    expect(result.applyStats.dailyLimitReached).toBe(true);
    expect(result.applyStats.applied).toBe(1);
  });

  it('gracefulShutdown 排空队列并标记中断', async () => {
    const { orchestrator } = buildOrchestrator(
      createConfig({ DRY_RUN: true }),
      [makeJob('1')],
    );

    await orchestrator.gracefulShutdown();

    expect(orchestrator.isShuttingDown).toBe(true);
  });

  it('SIGINT 注册并注销信号处理器', async () => {
    const { orchestrator } = buildOrchestrator();
    const onSpy = vi.spyOn(process, 'on');
    const offSpy = vi.spyOn(process, 'off');

    orchestrator['installSignalHandlers']();
    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    orchestrator['uninstallSignalHandlers']();
    expect(offSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  it('空搜索结果正常结束', async () => {
    const { orchestrator } = buildOrchestrator(
      createConfig({ DRY_RUN: true }),
      [],
    );

    const result = await orchestrator.run({
      searchConfigs: [{ sourceKeyword: '前端', params: {} as JobSearchParams }],
      detailConcurrency: 1,
      llmConcurrency: 1,
    });

    expect(result.producerStats.enqueued).toBe(0);
    expect(result.detailStats.processed).toBe(0);
    expect(result.applyStats.applied).toBe(0);
  });

  it('日报写入 storage', async () => {
    const { orchestrator } = buildOrchestrator(
      createConfig({ DRY_RUN: true }),
      [makeJob('1')],
    );

    await orchestrator.run({
      searchConfigs: [{ sourceKeyword: '前端', params: {} as JobSearchParams }],
      detailConcurrency: 1,
      llmConcurrency: 1,
    });

    const daily = await storage.getDailyStats('2026-06-28');
    expect(daily).toBeDefined();
    expect(daily?.applied).toBe(1);
  });
});
