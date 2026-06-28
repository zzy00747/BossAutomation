import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApplyWorker } from '../../../pipeline/workers/apply-worker.js';
import { Queue } from '../../../pipeline/queues.js';
import { MockJobStorage } from '../../__mocks__/mock-storage.js';
import { createLogger } from '../../../logger.js';
import { fixtureJobDetail } from '../../fixtures/job-detail.js';
import { fixtureScreenPass } from '../../fixtures/llm-responses.js';
import type { ApplyService, ApplyResult } from '../../../platform/boss/apply.js';
import type { ScreenedJob } from '../../../pipeline/queues.js';
import type { NormalizedJob } from '../../../types.js';

const silentLogger = createLogger({ level: 'silent', pretty: false });
const noopSleep = vi.fn(async (_min: number, _max: number): Promise<void> => {});
const FIXED_DATE = new Date('2026-06-28T10:00:00Z');
const now = () => FIXED_DATE;

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: 'test',
    DRY_RUN: true,
    CDP_URL: 'http://localhost:9222',
    LLM_PROVIDER: 'openai' as const,
    LLM_MODEL: 'gpt-4o-mini',
    OPENAI_API_KEY: 'sk-test',
    MATCH_SCORE_THRESHOLD: 75,
    APPLY_DAILY_LIMIT: 2,
    DETAIL_CONCURRENCY: 3,
    LLM_CONCURRENCY: 5,
    APPLY_CONCURRENCY: 1,
    SCREENSHOT_DIR: 'data/logs/screenshots',
    DB_PATH: 'data/jobs.sqlite',
    ...overrides,
  };
}

function makeJob(id: string): NormalizedJob {
  return { encryptJobId: id, jobName: `职位${id}`, brandName: '某公司' };
}

function makeScreenedJob(id: string): ScreenedJob {
  return {
    rawJob: makeJob(id),
    detail: { ...fixtureJobDetail, encryptJobId: id },
    screenResult: fixtureScreenPass,
    sourceKeyword: '前端',
  };
}

class FakeApplyService {
  public calls: string[] = [];
  constructor(private results: Array<Partial<ApplyResult>> = []) {}

  async apply(job: NormalizedJob & { screenResult: typeof fixtureScreenPass }): Promise<ApplyResult> {
    this.calls.push(job.encryptJobId);
    const r = this.results.shift() ?? {};
    return {
      success: r.success ?? true,
      encryptJobId: job.encryptJobId,
      dryRun: r.dryRun ?? false,
      error: r.error,
      greetResult: r.greetResult,
    };
  }
}

describe('ApplyWorker', () => {
  let storage: MockJobStorage;
  let shortlistedQueue: Queue<ScreenedJob>;

  beforeEach(() => {
    storage = new MockJobStorage();
    shortlistedQueue = new Queue<ScreenedJob>();
    noopSleep.mockClear();
  });

  function createWorker(
    service: FakeApplyService,
    config = createConfig(),
  ) {
    return new ApplyWorker({
      applyService: service as unknown as ApplyService,
      storage,
      shortlistedQueue,
      config: config as never,
      logger: silentLogger,
      sleepFn: noopSleep,
      now,
    });
  }

  it('串行消费 shortlistedQueue 并投递', async () => {
    const service = new FakeApplyService();
    const worker = createWorker(service, createConfig({ APPLY_DAILY_LIMIT: 20 }));

    shortlistedQueue.enqueue(makeScreenedJob('1'));
    shortlistedQueue.enqueue(makeScreenedJob('2'));
    shortlistedQueue.close();

    const stats = await worker.run();

    expect(stats.processed).toBe(2);
    expect(stats.applied).toBe(2);
    expect(service.calls).toEqual(['1', '2']);
  });

  it('每次投递后 sleep 10-20s', async () => {
    const service = new FakeApplyService();
    const worker = createWorker(service, createConfig({ APPLY_DAILY_LIMIT: 20 }));

    shortlistedQueue.enqueue(makeScreenedJob('1'));
    shortlistedQueue.close();

    await worker.run();

    expect(noopSleep).toHaveBeenCalledTimes(1);
    const [min, max] = noopSleep.mock.calls[0];
    expect(min).toBe(10000);
    expect(max).toBe(20000);
  });

  it('达到日上限后停止投递', async () => {
    const service = new FakeApplyService();
    const worker = createWorker(service, createConfig({ APPLY_DAILY_LIMIT: 2 }));

    await storage.saveDailyStats({
      date: '2026-06-28',
      totalSeen: 10,
      applied: 2,
      skipped: 0,
      failed: 0,
      llmCalls: 5,
    });

    shortlistedQueue.enqueue(makeScreenedJob('1'));
    shortlistedQueue.enqueue(makeScreenedJob('2'));
    shortlistedQueue.close();

    const stats = await worker.run();

    expect(stats.dailyLimitReached).toBe(true);
    expect(stats.processed).toBe(0);
    expect(service.calls).toHaveLength(0);
  });

  it('投递失败计入 failed 与 daily_stats', async () => {
    const service = new FakeApplyService([{ success: false, error: 'API 失败' }]);
    const worker = createWorker(service, createConfig({ APPLY_DAILY_LIMIT: 20 }));

    shortlistedQueue.enqueue(makeScreenedJob('1'));
    shortlistedQueue.close();

    const stats = await worker.run();

    expect(stats.applied).toBe(0);
    expect(stats.failed).toBe(1);

    const daily = await storage.getDailyStats('2026-06-28');
    expect(daily?.failed).toBe(1);
    expect(daily?.applied).toBe(0);
  });

  it('投递成功计入 daily_stats.applied', async () => {
    const service = new FakeApplyService([{ success: true }]);
    const worker = createWorker(service, createConfig({ APPLY_DAILY_LIMIT: 20 }));

    shortlistedQueue.enqueue(makeScreenedJob('1'));
    shortlistedQueue.close();

    await worker.run();

    const daily = await storage.getDailyStats('2026-06-28');
    expect(daily?.applied).toBe(1);
  });

  it('多次投递累计 daily_stats', async () => {
    const service = new FakeApplyService([
      { success: true },
      { success: false, error: 'x' },
      { success: true },
    ]);
    const worker = createWorker(service, createConfig({ APPLY_DAILY_LIMIT: 20 }));

    shortlistedQueue.enqueue(makeScreenedJob('1'));
    shortlistedQueue.enqueue(makeScreenedJob('2'));
    shortlistedQueue.enqueue(makeScreenedJob('3'));
    shortlistedQueue.close();

    const stats = await worker.run();

    expect(stats.applied).toBe(2);
    expect(stats.failed).toBe(1);

    const daily = await storage.getDailyStats('2026-06-28');
    expect(daily?.applied).toBe(2);
    expect(daily?.failed).toBe(1);
  });

  it('Dry-run 模式透传 ApplyService（不在此层拦截）', async () => {
    const service = new FakeApplyService([{ success: true, dryRun: true }]);
    const worker = createWorker(service, createConfig({ DRY_RUN: true, APPLY_DAILY_LIMIT: 20 }));

    shortlistedQueue.enqueue(makeScreenedJob('1'));
    shortlistedQueue.close();

    const stats = await worker.run();

    expect(stats.applied).toBe(1);
    expect(service.calls).toHaveLength(1);
  });

  it('投递到刚好达上限后停止后续投递', async () => {
    const service = new FakeApplyService();
    const worker = createWorker(service, createConfig({ APPLY_DAILY_LIMIT: 2 }));

    shortlistedQueue.enqueue(makeScreenedJob('1'));
    shortlistedQueue.enqueue(makeScreenedJob('2'));
    shortlistedQueue.enqueue(makeScreenedJob('3'));
    shortlistedQueue.close();

    const stats = await worker.run();

    expect(stats.applied).toBe(2);
    expect(stats.dailyLimitReached).toBe(true);
    expect(service.calls).toHaveLength(2);
  });

  it('空队列立即结束', async () => {
    const service = new FakeApplyService();
    const worker = createWorker(service, createConfig({ APPLY_DAILY_LIMIT: 20 }));

    shortlistedQueue.close();
    const stats = await worker.run();

    expect(stats.processed).toBe(0);
  });

  it('ScreenedJob 的 screenResult 透传给 ApplyService', async () => {
    const service = new FakeApplyService();
    const worker = createWorker(service, createConfig({ APPLY_DAILY_LIMIT: 20 }));

    shortlistedQueue.enqueue(makeScreenedJob('1'));
    shortlistedQueue.close();

    await worker.run();

    expect(service.calls).toHaveLength(1);
  });
});
