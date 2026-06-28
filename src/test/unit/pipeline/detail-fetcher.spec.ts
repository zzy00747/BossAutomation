import { describe, it, expect, beforeEach } from 'vitest';
import { DetailFetcher } from '../../../pipeline/workers/detail-fetcher.js';
import { Queue, ClosedQueueError } from '../../../pipeline/queues.js';
import { MockJobStorage } from '../../__mocks__/mock-storage.js';
import { createLogger } from '../../../logger.js';
import { fixtureJobDetail } from '../../fixtures/job-detail.js';
import type { JobDetailService } from '../../../platform/boss/job-detail.js';
import type { BrowserJob, DetailedJob } from '../../../pipeline/queues.js';
import type { NormalizedJob } from '../../../types.js';

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

function makeBrowserJob(id: string): BrowserJob {
  return { rawJob: makeJob(id), sourceKeyword: '前端' };
}

class FakeDetailService {
  public calls: NormalizedJob[] = [];
  public maxConcurrent = 0;
  private active = 0;
  constructor(
    private failIds: Set<string> = new Set(),
    private delayMs: number = 0,
  ) {}

  async getJobDetail(job: NormalizedJob): Promise<typeof fixtureJobDetail> {
    this.calls.push(job);
    this.active++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    this.active--;
    if (this.failIds.has(job.encryptJobId)) {
      throw new Error(`详情获取失败: ${job.encryptJobId}`);
    }
    return { ...fixtureJobDetail, encryptJobId: job.encryptJobId };
  }
}

describe('DetailFetcher', () => {
  let storage: MockJobStorage;
  let rawJobQueue: Queue<BrowserJob>;
  let detailQueue: Queue<DetailedJob>;

  beforeEach(() => {
    storage = new MockJobStorage();
    rawJobQueue = new Queue<BrowserJob>();
    detailQueue = new Queue<DetailedJob>();
  });

  function createFetcher(service: FakeDetailService, config = createConfig()) {
    return new DetailFetcher({
      jobDetailService: service as unknown as JobDetailService,
      storage,
      rawJobQueue,
      detailQueue,
      config: config as never,
      logger: silentLogger,
    });
  }

  it('消费 rawJobQueue 并写入 detailQueue', async () => {
    const service = new FakeDetailService();
    const fetcher = createFetcher(service);

    rawJobQueue.enqueue(makeBrowserJob('1'));
    rawJobQueue.enqueue(makeBrowserJob('2'));
    rawJobQueue.close();

    const stats = await fetcher.run(2);

    expect(stats.processed).toBe(2);
    expect(stats.succeeded).toBe(2);
    expect(service.calls).toHaveLength(2);
    expect(detailQueue.size).toBe(2);
  });

  it('详情获取失败时记录 failed 并跳过入队', async () => {
    const service = new FakeDetailService(new Set(['1']));
    const fetcher = createFetcher(service);

    rawJobQueue.enqueue(makeBrowserJob('1'));
    rawJobQueue.enqueue(makeBrowserJob('2'));
    rawJobQueue.close();

    const stats = await fetcher.run(1);

    expect(stats.succeeded).toBe(1);
    expect(stats.failed).toBe(1);
    expect(detailQueue.size).toBe(1);
    expect(detailQueue.tryDequeue()?.rawJob.encryptJobId).toBe('2');

    const failedRecord = await storage.getJobById('1');
    expect(failedRecord?.status).toBe('failed');
    expect(failedRecord?.failedReason).toContain('详情获取失败');
  });

  it('并发度默认 3', async () => {
    const service = new FakeDetailService(new Set(), 20);
    const fetcher = createFetcher(service, createConfig({ DETAIL_CONCURRENCY: 3 }));

    for (let i = 0; i < 6; i++) {
      rawJobQueue.enqueue(makeBrowserJob(`${i}`));
    }
    rawJobQueue.close();

    await fetcher.run();

    expect(service.maxConcurrent).toBeGreaterThan(1);
    expect(service.maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('显式传入 concurrency 覆盖配置', async () => {
    const service = new FakeDetailService(new Set(), 20);
    const fetcher = createFetcher(service, createConfig({ DETAIL_CONCURRENCY: 3 }));

    for (let i = 0; i < 4; i++) {
      rawJobQueue.enqueue(makeBrowserJob(`${i}`));
    }
    rawJobQueue.close();

    await fetcher.run(1);

    expect(service.maxConcurrent).toBe(1);
  });

  it('空队列立即结束', async () => {
    const service = new FakeDetailService();
    const fetcher = createFetcher(service);

    rawJobQueue.close();
    const stats = await fetcher.run(2);

    expect(stats.processed).toBe(0);
  });

  it('shutdown 优雅退出：等待活跃任务', async () => {
    const service = new FakeDetailService(new Set(), 30);
    const fetcher = createFetcher(service, createConfig({ DETAIL_CONCURRENCY: 2 }));

    for (let i = 0; i < 4; i++) {
      rawJobQueue.enqueue(makeBrowserJob(`${i}`));
    }

    const runPromise = fetcher.run(2);
    await new Promise((r) => setTimeout(r, 10));
    await fetcher.shutdown();

    await runPromise;

    expect(fetcher.isActive).toBe(false);
  });

  it('DetailedJob 携带 rawJob、detail、sourceKeyword', async () => {
    const service = new FakeDetailService();
    const fetcher = createFetcher(service);

    rawJobQueue.enqueue(makeBrowserJob('99'));
    rawJobQueue.close();

    await fetcher.run(1);

    const got = detailQueue.tryDequeue();
    expect(got?.rawJob.encryptJobId).toBe('99');
    expect(got?.detail.encryptJobId).toBe('99');
    expect(got?.sourceKeyword).toBe('前端');
  });

  it('dequeue 抛出 ClosedQueueError 时 worker 安全退出', async () => {
    const service = new FakeDetailService();
    const fetcher = createFetcher(service);

    rawJobQueue.close();

    const stats = await fetcher.run(3);

    expect(stats.processed).toBe(0);
    expect(ClosedQueueError).toBeDefined();
  });

  it('失败任务不影响后续任务处理', async () => {
    const service = new FakeDetailService(new Set(['1', '3']));
    const fetcher = createFetcher(service);

    for (let i = 1; i <= 4; i++) {
      rawJobQueue.enqueue(makeBrowserJob(`${i}`));
    }
    rawJobQueue.close();

    const stats = await fetcher.run(1);

    expect(stats.failed).toBe(2);
    expect(stats.succeeded).toBe(2);
    expect(detailQueue.size).toBe(2);
  });
});
