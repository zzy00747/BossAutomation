import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserProducer } from '../../../pipeline/workers/browser-producer.js';
import type { SearchConfig } from '../../../pipeline/workers/browser-producer.js';
import { Queue } from '../../../pipeline/queues.js';
import type { BrowserJob } from '../../../pipeline/queues.js';
import { MockJobStorage } from '../../__mocks__/mock-storage.js';
import { createLogger } from '../../../logger.js';
import type { JobSearchService } from '../../../platform/boss/search.js';
import type { NormalizedJob, JobSearchParams } from '../../../types.js';

const silentLogger = createLogger({ level: 'silent', pretty: false });

function createConfig() {
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
  };
}

class FakeSearchService {
  public calls: Array<{ params: JobSearchParams; maxPages?: number }> = [];
  constructor(private pagesByKeyword: Record<string, NormalizedJob[]>) {}

  async fetchAllPages(params: JobSearchParams, maxPages?: number): Promise<NormalizedJob[]> {
    this.calls.push({ params, maxPages });
    const key = (params as { keyword?: string }).keyword ?? 'default';
    return this.pagesByKeyword[key] ?? [];
  }
}

const jobA: NormalizedJob = {
  encryptJobId: 'job-A',
  jobName: '高级前端工程师',
  brandName: '字节跳动',
};

const jobB: NormalizedJob = {
  encryptJobId: 'job-B',
  jobName: 'Java 后端工程师',
  brandName: '某外包公司',
};

const jobC: NormalizedJob = {
  encryptJobId: 'job-C',
  jobName: '前端开发',
  brandName: '阿里巴巴',
};

describe('BrowserProducer', () => {
  let storage: MockJobStorage;
  let queue: Queue<BrowserJob>;

  beforeEach(() => {
    storage = new MockJobStorage();
    queue = new Queue<BrowserJob>();
  });

  function createProducer(search: FakeSearchService) {
    return new BrowserProducer({
      searchService: search as unknown as JobSearchService,
      storage,
      rawJobQueue: queue,
      config: createConfig(),
      logger: silentLogger,
    });
  }

  function config(sourceKeyword: string, overrides: Partial<SearchConfig> = {}): SearchConfig {
    return {
      sourceKeyword,
      params: { keyword: sourceKeyword } as unknown as JobSearchParams,
      ...overrides,
    };
  }

  it('按搜索配置入队所有职位', async () => {
    const search = new FakeSearchService({ 前端: [jobA, jobC] });
    const producer = createProducer(search);

    const stats = await producer.run([config('前端')]);

    expect(stats.totalSeen).toBe(2);
    expect(stats.enqueued).toBe(2);
    expect(queue.size).toBe(2);
    expect(search.calls).toHaveLength(1);
  });

  it('已处理的 encryptJobId 被跳过（去重）', async () => {
    await storage.saveJob({
      encryptJobId: 'job-A',
      jobName: jobA.jobName,
      brandName: jobA.brandName,
      status: 'applied',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const search = new FakeSearchService({ 前端: [jobA, jobC] });
    const producer = createProducer(search);

    const stats = await producer.run([config('前端')]);

    expect(stats.skippedDuplicate).toBe(1);
    expect(stats.enqueued).toBe(1);
    expect(queue.size).toBe(1);
    expect(queue.tryDequeue()?.rawJob.encryptJobId).toBe('job-C');
  });

  it('黑名单公司被过滤', async () => {
    await storage.blacklistCompany('某外包公司');

    const search = new FakeSearchService({ 默认: [jobA, jobB] });
    const producer = createProducer(search);

    const stats = await producer.run([config('默认')]);

    expect(stats.skippedBlacklist).toBe(1);
    expect(stats.enqueued).toBe(1);
    expect(queue.tryDequeue()?.rawJob.encryptJobId).toBe('job-A');
  });

  it('excludeKeywords 命中职位名被过滤', async () => {
    const search = new FakeSearchService({ 默认: [jobA, jobB] });
    const producer = createProducer(search);

    const stats = await producer.run([
      config('默认', { excludeKeywords: ['Java', '外包'] }),
    ]);

    expect(stats.skippedExclude).toBe(1);
    expect(stats.enqueued).toBe(1);
    expect(queue.tryDequeue()?.rawJob.encryptJobId).toBe('job-A');
  });

  it('excludeBrands 命中公司名被过滤', async () => {
    const search = new FakeSearchService({ 默认: [jobA, jobC] });
    const producer = createProducer(search);

    const stats = await producer.run([
      config('默认', { excludeBrands: ['字节'] }),
    ]);

    expect(stats.skippedExclude).toBe(1);
    expect(stats.enqueued).toBe(1);
    expect(queue.tryDequeue()?.rawJob.encryptJobId).toBe('job-C');
  });

  it('多配置按顺序串行处理', async () => {
    const search = new FakeSearchService({
      前端: [jobA],
      全栈: [jobC],
    });
    const producer = createProducer(search);

    const stats = await producer.run([config('前端'), config('全栈')]);

    expect(search.calls).toHaveLength(2);
    expect(stats.enqueued).toBe(2);
    expect(queue.size).toBe(2);
  });

  it('队列已关闭时停止生产', async () => {
    const search = new FakeSearchService({ 前端: [jobA, jobC] });
    const producer = createProducer(search);

    queue.close();
    const stats = await producer.run([config('前端')]);

    expect(stats.enqueued).toBe(0);
  });

  it('入队项携带 sourceKeyword', async () => {
    const search = new FakeSearchService({ 前端: [jobA] });
    const producer = createProducer(search);

    await producer.run([config('前端')]);

    expect(queue.tryDequeue()?.sourceKeyword).toBe('前端');
  });

  it('空搜索结果不影响后续配置', async () => {
    const search = new FakeSearchService({ 空: [], 前端: [jobA] });
    const producer = createProducer(search);

    const stats = await producer.run([config('空'), config('前端')]);

    expect(stats.totalSeen).toBe(1);
    expect(stats.enqueued).toBe(1);
  });
});
