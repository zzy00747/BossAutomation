import { describe, it, expect, vi } from 'vitest';
import { JobSearchService } from '../../../platform/boss/search.js';
import { MockJobStorage } from '../../__mocks__/mock-storage.js';
import type { IBossAPIClient } from '../../../interfaces/api.js';
import type { JobListResponse, JobSearchParams, NormalizedJob } from '../../../types.js';

function makeJob(id: string): NormalizedJob {
  return {
    encryptJobId: id,
    jobName: `岗位-${id}`,
    brandName: '公司',
  };
}

function createMockApi(pages: JobListResponse[]): IBossAPIClient & {
  calls: JobSearchParams[];
} {
  const calls: JobSearchParams[] = [];
  let i = 0;
  return {
    calls,
    async getRecommendJobs(params: JobSearchParams): Promise<JobListResponse> {
      calls.push(params);
      return pages[i++] ?? { code: 0, message: '', jobList: [], hasMore: false };
    },
    async getJobDetail() {
      throw new Error('not used');
    },
    async greetBoss() {
      throw new Error('not used');
    },
  };
}

describe('JobSearchService', () => {
  it('cursor 翻页：使用响应 cursor 继续翻', async () => {
    const api = createMockApi([
      { code: 0, message: '', jobList: [makeJob('a'), makeJob('b')], hasMore: true, cursor: 'cur-1' },
      { code: 0, message: '', jobList: [makeJob('c')], hasMore: true, cursor: 'cur-2' },
      { code: 0, message: '', jobList: [makeJob('d')], hasMore: false },
    ]);
    const storage = new MockJobStorage();
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const service = new JobSearchService({ apiClient: api, storage, sleepFn });

    const jobs = await service.fetchAllPages({ pageSize: 15 }, 5);

    expect(jobs.map((j) => j.encryptJobId)).toEqual(['a', 'b', 'c', 'd']);
    expect(api.calls).toHaveLength(3);
    expect(api.calls[0].page).toBe(1);
    expect(api.calls[0].cursor).toBeUndefined();
    expect(api.calls[1].cursor).toBe('cur-1');
    expect(api.calls[2].cursor).toBe('cur-2');
  });

  it('page 翻页：无 cursor 时 page++', async () => {
    const api = createMockApi([
      { code: 0, message: '', jobList: [makeJob('a')], hasMore: true },
      { code: 0, message: '', jobList: [makeJob('b')], hasMore: true },
      { code: 0, message: '', jobList: [makeJob('c')], hasMore: false },
    ]);
    const storage = new MockJobStorage();
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const service = new JobSearchService({ apiClient: api, storage, sleepFn });

    const jobs = await service.fetchAllPages({ pageSize: 10 });

    expect(jobs).toHaveLength(3);
    expect(api.calls.map((c) => c.page)).toEqual([1, 2, 3]);
    expect(api.calls.every((c) => c.cursor === undefined)).toBe(true);
  });

  it('hasMore=false 提前终止', async () => {
    const api = createMockApi([
      { code: 0, message: '', jobList: [makeJob('a')], hasMore: false },
    ]);
    const service = new JobSearchService({
      apiClient: api,
      storage: new MockJobStorage(),
      sleepFn: vi.fn().mockResolvedValue(undefined),
    });

    const jobs = await service.fetchAllPages({ pageSize: 15 }, 5);
    expect(jobs).toHaveLength(1);
    expect(api.calls).toHaveLength(1);
  });

  it('去重：跳过 storage 已存在的职位', async () => {
    const storage = new MockJobStorage();
    await storage.saveJob({
      encryptJobId: 'a',
      jobName: '岗位-a',
      brandName: '公司',
      status: 'new',
      createdAt: 0,
      updatedAt: 0,
    });
    const api = createMockApi([
      { code: 0, message: '', jobList: [makeJob('a'), makeJob('b')], hasMore: false },
    ]);
    const service = new JobSearchService({
      apiClient: api,
      storage,
      sleepFn: vi.fn().mockResolvedValue(undefined),
    });

    const jobs = await service.fetchAllPages({ pageSize: 15 });
    expect(jobs.map((j) => j.encryptJobId)).toEqual(['b']);
  });

  it('页内重复也去重', async () => {
    const api = createMockApi([
      {
        code: 0,
        message: '',
        jobList: [makeJob('a'), makeJob('a'), makeJob('b')],
        hasMore: false,
      },
    ]);
    const service = new JobSearchService({
      apiClient: api,
      storage: new MockJobStorage(),
      sleepFn: vi.fn().mockResolvedValue(undefined),
    });
    const jobs = await service.fetchAllPages({ pageSize: 15 });
    expect(jobs.map((j) => j.encryptJobId)).toEqual(['a', 'b']);
  });

  it('翻页间调用 sleep', async () => {
    const api = createMockApi([
      { code: 0, message: '', jobList: [makeJob('a')], hasMore: true },
      { code: 0, message: '', jobList: [makeJob('b')], hasMore: false },
    ]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const service = new JobSearchService({
      apiClient: api,
      storage: new MockJobStorage(),
      sleepFn,
    });
    await service.fetchAllPages({ pageSize: 15 });
    expect(sleepFn).toHaveBeenCalledTimes(1); // 仅在两页之间
  });

  it('达到 maxPages 停止', async () => {
    const api = createMockApi([
      { code: 0, message: '', jobList: [makeJob('a')], hasMore: true, cursor: 'c1' },
      { code: 0, message: '', jobList: [makeJob('b')], hasMore: true, cursor: 'c2' },
      { code: 0, message: '', jobList: [makeJob('c')], hasMore: true, cursor: 'c3' },
    ]);
    const service = new JobSearchService({
      apiClient: api,
      storage: new MockJobStorage(),
      sleepFn: vi.fn().mockResolvedValue(undefined),
    });
    const jobs = await service.fetchAllPages({ pageSize: 15 }, 2);
    expect(jobs).toHaveLength(2);
    expect(api.calls).toHaveLength(2);
  });
});
