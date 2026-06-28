import { describe, it, expect, beforeEach } from 'vitest';
import { LLMScreenerWorker } from '../../../pipeline/workers/llm-screener.js';
import { Queue } from '../../../pipeline/queues.js';
import { MockJobStorage } from '../../__mocks__/mock-storage.js';
import { createLogger } from '../../../logger.js';
import { fixtureJobDetail } from '../../fixtures/job-detail.js';
import { fixtureScreenPass, fixtureScreenFail } from '../../fixtures/llm-responses.js';
import type { JobScreener, ScreenOutcome } from '../../../llm/screener.js';
import type { DetailedJob, ScreenedJob } from '../../../pipeline/queues.js';
import type { NormalizedJob, ScreenResult } from '../../../types.js';

const silentLogger = createLogger({ level: 'silent', pretty: false });

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: 'test',
    DRY_RUN: true,
    CDP_URL: 'http://localhost:9222',
    LLM_PROVIDER: 'openai' as const,
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
  return { encryptJobId: id, jobName: `职位${id}`, brandName: '某公司' };
}

function makeDetailedJob(id: string): DetailedJob {
  return {
    rawJob: makeJob(id),
    detail: { ...fixtureJobDetail, encryptJobId: id },
    sourceKeyword: '前端',
  };
}

class FakeScreener {
  public calls: string[] = [];
  public maxConcurrent = 0;
  private active = 0;
  constructor(
    private resultsByOutcome: Partial<Record<'pass' | 'fail' | 'cache', ScreenResult>> = {},
    private behavior: 'sequence' | 'concurrent' = 'sequence',
  ) {}

  async screen(_detail: typeof fixtureJobDetail, encryptJobId: string): Promise<ScreenOutcome> {
    this.calls.push(encryptJobId);
    this.active++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
    if (this.behavior === 'concurrent') {
      await new Promise((r) => setTimeout(r, 20));
    }
    this.active--;

    if (encryptJobId === 'cache') {
      const result = this.resultsByOutcome.cache ?? fixtureScreenPass;
      return { result, isShortlisted: true, fromCache: true, usedFallback: false };
    }
    if (encryptJobId.startsWith('fail')) {
      const result = this.resultsByOutcome.fail ?? fixtureScreenFail;
      return { result, isShortlisted: false, fromCache: false, usedFallback: false };
    }
    const result = this.resultsByOutcome.pass ?? fixtureScreenPass;
    return { result, isShortlisted: true, fromCache: false, usedFallback: false };
  }
}

describe('LLMScreenerWorker', () => {
  let storage: MockJobStorage;
  let detailQueue: Queue<DetailedJob>;
  let shortlistedQueue: Queue<ScreenedJob>;

  beforeEach(() => {
    storage = new MockJobStorage();
    detailQueue = new Queue<DetailedJob>();
    shortlistedQueue = new Queue<ScreenedJob>();
  });

  function createWorker(screener: FakeScreener, config = createConfig()) {
    return new LLMScreenerWorker({
      jobScreener: screener as unknown as JobScreener,
      storage,
      detailQueue,
      shortlistedQueue,
      config: config as never,
      logger: silentLogger,
    });
  }

  it('通过的职位入 shortlistedQueue', async () => {
    const screener = new FakeScreener();
    const worker = createWorker(screener);

    detailQueue.enqueue(makeDetailedJob('1'));
    detailQueue.close();

    const stats = await worker.run(2);

    expect(stats.processed).toBe(1);
    expect(stats.shortlisted).toBe(1);
    expect(shortlistedQueue.size).toBe(1);
    expect(shortlistedQueue.tryDequeue()?.rawJob.encryptJobId).toBe('1');
  });

  it('未通过阈值的职位记录 skipped + skip_reason', async () => {
    const screener = new FakeScreener();
    const worker = createWorker(screener);

    detailQueue.enqueue(makeDetailedJob('fail-1'));
    detailQueue.close();

    const stats = await worker.run(1);

    expect(stats.skipped).toBe(1);
    expect(stats.shortlisted).toBe(0);
    expect(shortlistedQueue.size).toBe(0);

    const record = await storage.getJobById('fail-1');
    expect(record?.status).toBe('skipped');
    expect(record?.skipReason).toContain('matchScore');
  });

  it('skip_reason 包含 redFlags 信息', async () => {
    const screener = new FakeScreener({
      fail: { ...fixtureScreenPass, matchScore: 90, redFlags: ['可疑条款'] },
    });
    const worker = createWorker(screener);

    detailQueue.enqueue(makeDetailedJob('fail-1'));
    detailQueue.close();

    await worker.run(1);

    const record = await storage.getJobById('fail-1');
    expect(record?.skipReason).toContain('redFlags');
    expect(record?.skipReason).toContain('可疑条款');
  });

  it('缓存命中时 stats.fromCache 增加', async () => {
    const screener = new FakeScreener();
    const worker = createWorker(screener);

    detailQueue.enqueue(makeDetailedJob('cache'));
    detailQueue.close();

    const stats = await worker.run(1);

    expect(stats.fromCache).toBe(1);
    expect(stats.shortlisted).toBe(1);
  });

  it('并发度默认 5', async () => {
    const screener = new FakeScreener({}, 'concurrent');
    const worker = createWorker(screener, createConfig({ LLM_CONCURRENCY: 5 }));

    for (let i = 0; i < 10; i++) {
      detailQueue.enqueue(makeDetailedJob(`${i}`));
    }
    detailQueue.close();

    await worker.run();

    expect(screener.maxConcurrent).toBeGreaterThan(1);
    expect(screener.maxConcurrent).toBeLessThanOrEqual(5);
  });

  it('显式传入 concurrency 覆盖配置', async () => {
    const screener = new FakeScreener({}, 'concurrent');
    const worker = createWorker(screener, createConfig({ LLM_CONCURRENCY: 5 }));

    for (let i = 0; i < 6; i++) {
      detailQueue.enqueue(makeDetailedJob(`${i}`));
    }
    detailQueue.close();

    await worker.run(2);

    expect(screener.maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('screen 抛出异常时记 failed 并继续', async () => {
    const failingScreener = {
      screen: async () => {
        throw new Error('LLM 不可用');
      },
    } as unknown as JobScreener;

    const worker = new LLMScreenerWorker({
      jobScreener: failingScreener,
      storage,
      detailQueue,
      shortlistedQueue,
      config: createConfig() as never,
      logger: silentLogger,
    });

    detailQueue.enqueue(makeDetailedJob('1'));
    detailQueue.enqueue(makeDetailedJob('2'));
    detailQueue.close();

    const stats = await worker.run(1);

    expect(stats.skipped).toBe(2);
    expect(shortlistedQueue.size).toBe(0);

    const record = await storage.getJobById('1');
    expect(record?.status).toBe('failed');
    expect(record?.failedReason).toContain('LLM 不可用');
  });

  it('ScreenedJob 携带 rawJob、detail、screenResult', async () => {
    const screener = new FakeScreener();
    const worker = createWorker(screener);

    detailQueue.enqueue(makeDetailedJob('42'));
    detailQueue.close();

    await worker.run(1);

    const got = shortlistedQueue.tryDequeue();
    expect(got?.rawJob.encryptJobId).toBe('42');
    expect(got?.detail.encryptJobId).toBe('42');
    expect(got?.screenResult.matchScore).toBe(fixtureScreenPass.matchScore);
  });

  it('空队列立即结束', async () => {
    const screener = new FakeScreener();
    const worker = createWorker(screener);

    detailQueue.close();
    const stats = await worker.run(3);

    expect(stats.processed).toBe(0);
  });

  it('混合通过/不通过任务正确分流', async () => {
    const screener = new FakeScreener();
    const worker = createWorker(screener);

    detailQueue.enqueue(makeDetailedJob('1'));
    detailQueue.enqueue(makeDetailedJob('fail-1'));
    detailQueue.enqueue(makeDetailedJob('2'));
    detailQueue.enqueue(makeDetailedJob('fail-2'));
    detailQueue.close();

    const stats = await worker.run(2);

    expect(stats.shortlisted).toBe(2);
    expect(stats.skipped).toBe(2);
    expect(shortlistedQueue.size).toBe(2);
  });
});
