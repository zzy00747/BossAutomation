import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobDetailService } from '../../../platform/boss/job-detail.js';
import { PagePool } from '../../../browser/page-pool.js';
import { MockBrowserContext, MockPage } from '../../__mocks__/mock-browser.js';
import { MockJobStorage } from '../../__mocks__/mock-storage.js';
import { fixtureJobDetail } from '../../fixtures/job-detail.js';
import type { IBossAPIClient } from '../../../interfaces/api.js';
import type { JobDetail, NormalizedJob } from '../../../types.js';

const job: NormalizedJob = {
  encryptJobId: 'job-001',
  jobName: '高级前端工程师',
  brandName: '字节跳动',
};

function createApi(overrides: Partial<JobDetail> = {}): IBossAPIClient {
  return {
    async getRecommendJobs() {
      throw new Error('not used');
    },
    async getJobDetail(): Promise<JobDetail> {
      return { ...fixtureJobDetail, ...overrides };
    },
    async greetBoss() {
      throw new Error('not used');
    },
  };
}

describe('JobDetailService', () => {
  let storage: MockJobStorage;
  let pagePool: PagePool;
  let context: MockBrowserContext;

  beforeEach(() => {
    storage = new MockJobStorage();
    context = new MockBrowserContext();
    pagePool = new PagePool(context, { maxPages: 1 });
  });

  it('API 详情有描述时直接返回', async () => {
    const api = createApi();
    const service = new JobDetailService({ apiClient: api, pagePool, storage });
    const detail = await service.getJobDetail(job);
    expect(detail.postDescription).toBe(fixtureJobDetail.postDescription);
    expect(detail.encryptJobId).toBe('job-001');
  });

  it('API 详情缺失描述时用 HTML 补充', async () => {
    const api = createApi({ postDescription: '' });
    const htmlDetail = { postDescription: 'HTML 描述内容' };
    const page = new MockPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue(htmlDetail);
    vi.spyOn(context, 'newPage').mockResolvedValue(page);

    const service = new JobDetailService({ apiClient: api, pagePool, storage });
    const detail = await service.getJobDetail(job);

    expect(detail.postDescription).toBe('HTML 描述内容');
  });

  it('API 与 HTML 合并：API 字段优先，HTML 补缺', async () => {
    const api = createApi({
      postDescription: 'API描述',
      salary: 'API薪资',
      location: undefined,
    });
    const htmlDetail = {
      postDescription: 'HTML描述',
      salary: 'HTML薪资',
      location: 'HTML地点',
    };
    const page = new MockPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue(htmlDetail);
    vi.spyOn(context, 'newPage').mockResolvedValue(page);

    const service = new JobDetailService({ apiClient: api, pagePool, storage });
    const detail = await service.getJobDetail(job);

    expect(detail.postDescription).toBe('API描述');
    expect(detail.salary).toBe('API薪资');
    expect(detail.location).toBe('HTML地点');
  });

  it('API 失败时仅用 HTML 详情', async () => {
    const api: IBossAPIClient = {
      async getRecommendJobs() {
        throw new Error();
      },
      async getJobDetail() {
        throw new Error('API down');
      },
      async greetBoss() {
        throw new Error();
      },
    };
    const page = new MockPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue({
      postDescription: '仅 HTML 描述',
      jobName: 'HTML 岗位',
    });
    vi.spyOn(context, 'newPage').mockResolvedValue(page);

    const service = new JobDetailService({ apiClient: api, pagePool, storage });
    const detail = await service.getJobDetail(job);

    expect(detail.postDescription).toBe('仅 HTML 描述');
  });

  it('缓存命中时跳过 API 请求', async () => {
    const api = createApi();
    const spy = vi.spyOn(api, 'getJobDetail');
    await storage.updateJobStatus('job-001', 'screened', {
      apiDetailJson: JSON.stringify(fixtureJobDetail),
      detailCachedAt: Date.now(),
    });

    const service = new JobDetailService({ apiClient: api, pagePool, storage });
    const detail = await service.getJobDetail(job);

    expect(spy).not.toHaveBeenCalled();
    expect(detail.postDescription).toBe(fixtureJobDetail.postDescription);
  });

  it('过期缓存被忽略，重新获取', async () => {
    const api = createApi();
    const spy = vi.spyOn(api, 'getJobDetail');
    await storage.updateJobStatus('job-001', 'screened', {
      apiDetailJson: JSON.stringify(fixtureJobDetail),
      detailCachedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 天前
    });

    const service = new JobDetailService({
      apiClient: api,
      pagePool,
      storage,
      cacheTtlDays: 7,
    });
    await service.getJobDetail(job);

    expect(spy).toHaveBeenCalled();
  });

  it('获取后写入缓存', async () => {
    const api = createApi();
    const service = new JobDetailService({ apiClient: api, pagePool, storage });
    await service.getJobDetail(job);

    const record = await storage.getJobById('job-001');
    expect(record?.apiDetailJson).toBeTruthy();
    expect(record?.detailCachedAt).toBeTruthy();
  });
});
