import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, loadSearchConfigs, type RuntimeDependencies } from '../../main.js';
import { JobStorage } from '../../storage/store.js';
import { ReportExporter } from '../../report/exporter.js';
import { createLogger } from '../../logger.js';
import { MockLLMClient } from '../__mocks__/mock-llm-client.js';
import { MockBossAPIClient } from '../__mocks__/mock-api-client.js';
import { JobScreener } from '../../llm/screener.js';
import { ApplyService } from '../../platform/boss/apply.js';
import { SecurityIdResolver } from '../../platform/boss/security-id-resolver.js';
import { JobSearchService } from '../../platform/boss/search.js';
import { JobDetailService } from '../../platform/boss/job-detail.js';
import { Orchestrator } from '../../pipeline/orchestrator.js';
import { fixtureScreenPass } from '../fixtures/llm-responses.js';
import type { Config } from '../../config.js';
import type { JobDetail, JobSearchParams, NormalizedJob } from '../../types.js';

const FIXED_DATE = new Date('2026-06-28T10:00:00Z');
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
    DETAIL_CONCURRENCY: 2,
    LLM_CONCURRENCY: 2,
    APPLY_CONCURRENCY: 1,
    SCREENSHOT_DIR: 'data/logs/screenshots',
    DB_PATH: ':memory:',
    ...overrides,
  };
}

function makeJob(id: string): NormalizedJob {
  return {
    encryptJobId: id,
    securityId: `sec-${id}`,
    jobName: `前端工程师 ${id}`,
    brandName: '某科技公司',
  };
}

function makeDetail(id: string): JobDetail {
  return {
    encryptJobId: id,
    securityId: `sec-${id}`,
    jobName: `前端工程师 ${id}`,
    brandName: '某科技公司',
    salary: '25-40K',
    location: '北京',
    postDescription: `JD ${id} React TypeScript`,
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
  async getContext() {
    return {} as never;
  }
  async getPage() {
    return {} as never;
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
  constructor(private jobs: NormalizedJob[]) {}
  async fetchAllPages(): Promise<NormalizedJob[]> {
    return this.jobs;
  }
}

class FakeJobDetailService {
  async getJobDetail(job: NormalizedJob): Promise<JobDetail> {
    return makeDetail(job.encryptJobId);
  }
}

function buildMockRuntime(config: Config, jobs: NormalizedJob[], tmpReportDir: string): RuntimeDependencies {
  const storage = new JobStorage({ dbPath: ':memory:' });
  const api = new MockBossAPIClient();
  const llm = new MockLLMClient({ screenResults: [fixtureScreenPass] });
  const searchService = new FakeSearchService(jobs) as unknown as JobSearchService;
  const jobDetailService = new FakeJobDetailService() as unknown as JobDetailService;
  const securityIdResolver = new SecurityIdResolver({ apiClient: api, logger: silentLogger });
  const jobScreener = new JobScreener({
    llmClient: llm,
    storage,
    config,
    jobIntent: 'React TypeScript',
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
  const reportExporter = new ReportExporter({ storage, reportDir: tmpReportDir });
  const orchestrator = new Orchestrator({
    browserManager: new FakeBrowserManager() as never,
    sessionManager: new FakeSessionManager() as never,
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

  return {
    config,
    storage,
    browserManager: new FakeBrowserManager() as never,
    sessionManager: new FakeSessionManager() as never,
    apiClient: api,
    searchService,
    jobDetailService,
    securityIdResolver,
    applyService,
    jobScreener,
    orchestrator,
    reportExporter,
    logger: silentLogger,
    stopMemoryMonitor: () => {},
  };
}

describe('main CLI 集成测试', () => {
  let tmpReportDir: string;

  beforeEach(() => {
    tmpReportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'main-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpReportDir, { recursive: true, force: true });
  });

  it('Dry-run 默认模式跑通完整流程并导出报告', async () => {
    const config = createConfig({ DRY_RUN: true });
    const runtime = buildMockRuntime(config, [makeJob('1'), makeJob('2')], tmpReportDir);

    const result = await main({
      runtime,
      now: () => FIXED_DATE,
      searchConfigs: [{ sourceKeyword: '前端', params: {} as JobSearchParams }],
    });

    expect(result.date).toBe('2026-06-28');
    expect(result.reportPath).toBeTruthy();
    expect(result.csvPath).toBeTruthy();
    expect(fs.existsSync(result.reportPath!)).toBe(true);
    expect(fs.existsSync(result.csvPath!)).toBe(true);

    const md = fs.readFileSync(result.reportPath!, 'utf8');
    expect(md).toContain('Boss 直聘投递日报 2026-06-28');
  });

  it('异常时触发 gracefulShutdown 并抛出', async () => {
    const config = createConfig();
    const runtime = buildMockRuntime(config, [], tmpReportDir);
    const spy = jest_like_spy(runtime.orchestrator);
    // 让 orchestrator.run 抛错
    spy.throwOnRun = true;

    await expect(
      main({
        runtime,
        now: () => FIXED_DATE,
        searchConfigs: [{ sourceKeyword: '前端', params: {} as JobSearchParams }],
      }),
    ).rejects.toThrow('orchestrator 模拟失败');

    expect(spy.gracefulShutdownCalled).toBe(true);
  });

  it('默认 searchConfigs 无 SEARCH_KEYWORDS 时返回 recommend 配置', () => {
    const configs = loadSearchConfigs({});
    expect(configs).toHaveLength(1);
    expect(configs[0].sourceKeyword).toBe('recommend');
  });

  it('SEARCH_KEYWORDS 逗号分隔生成多个配置', () => {
    const configs = loadSearchConfigs({ SEARCH_KEYWORDS: '前端,React,Node' } as NodeJS.ProcessEnv);
    expect(configs).toHaveLength(3);
    expect(configs.map((c) => c.sourceKeyword)).toEqual(['前端', 'React', 'Node']);
  });

  it('SEARCH_MAX_PAGES 注入到每个配置', () => {
    const configs = loadSearchConfigs({ SEARCH_KEYWORDS: '前端', SEARCH_MAX_PAGES: '3' } as NodeJS.ProcessEnv);
    expect(configs[0].maxPages).toBe(3);
  });

  it('注入的 runtime 不被 cleanup 关闭（由测试管理生命周期）', async () => {
    const config = createConfig({ DRY_RUN: true });
    const runtime = buildMockRuntime(config, [makeJob('1')], tmpReportDir);
    const spy = runtime.storage.close.bind(runtime.storage);
    let closed = false;
    runtime.storage.close = async () => {
      closed = true;
      return spy();
    };

    await main({
      runtime,
      now: () => FIXED_DATE,
      searchConfigs: [{ sourceKeyword: '前端', params: {} as JobSearchParams }],
    });

    // 注入 runtime 时 main 不应主动关闭 storage
    expect(closed).toBe(false);
  });
});

// 辅助：包装 orchestrator 使其可在 run 时抛错并记录 gracefulShutdown 调用
function jest_like_spy(orchestrator: Orchestrator): {
  throwOnRun: boolean;
  gracefulShutdownCalled: boolean;
} {
  const state = { throwOnRun: false, gracefulShutdownCalled: false };
  const originalRun = orchestrator.run.bind(orchestrator);
  const originalShutdown = orchestrator.gracefulShutdown.bind(orchestrator);
  orchestrator.run = async (opts: unknown) => {
    if (state.throwOnRun) throw new Error('orchestrator 模拟失败');
    return originalRun(opts as never);
  };
  orchestrator.gracefulShutdown = async () => {
    state.gracefulShutdownCalled = true;
    return originalShutdown();
  };
  return state;
}
