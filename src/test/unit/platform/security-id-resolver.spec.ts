import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityIdResolver } from '../../../platform/boss/security-id-resolver.js';
import { PagePool } from '../../../browser/page-pool.js';
import { MockBrowserContext, MockPage } from '../../__mocks__/mock-browser.js';
import type { IBossAPIClient } from '../../../interfaces/api.js';
import type { JobDetail, NormalizedJob } from '../../../types.js';

const job: NormalizedJob = {
  encryptJobId: 'job-001',
  jobName: 'x',
  brandName: 'b',
};

function createApi(detail?: Partial<JobDetail>): IBossAPIClient {
  return {
    async getRecommendJobs() {
      throw new Error();
    },
    async getJobDetail(): Promise<JobDetail> {
      return {
        encryptJobId: 'job-001',
        securityId: 'sec-from-api-12345',
        jobName: 'x',
        brandName: 'b',
        postDescription: 'desc',
        fetchedAt: Date.now(),
        ...detail,
      };
    },
    async greetBoss() {
      throw new Error();
    },
  };
}

describe('SecurityIdResolver', () => {
  let context: MockBrowserContext;
  let pagePool: PagePool;

  beforeEach(() => {
    context = new MockBrowserContext();
    pagePool = new PagePool(context, { maxPages: 1 });
  });

  it('优先使用 job.securityId 缓存', async () => {
    const api = createApi();
    const spy = vi.spyOn(api, 'getJobDetail');
    const resolver = new SecurityIdResolver({ apiClient: api, pagePool });

    const sid = await resolver.resolve({ ...job, securityId: 'cached-sec-12345' });

    expect(sid).toBe('cached-sec-12345');
    expect(spy).not.toHaveBeenCalled();
  });

  it('job.securityId 无效时从详情 API 获取', async () => {
    const api = createApi({ securityId: 'sec-from-api-12345' });
    const resolver = new SecurityIdResolver({ apiClient: api, pagePool });

    const sid = await resolver.resolve({ ...job, securityId: 'short' });

    expect(sid).toBe('sec-from-api-12345');
  });

  it('forceRefresh 忽略缓存，从 API 获取', async () => {
    const api = createApi({ securityId: 'sec-from-api-12345' });
    const resolver = new SecurityIdResolver({ apiClient: api, pagePool });

    const sid = await resolver.resolve(
      { ...job, securityId: 'cached-sec-12345' },
      { forceRefresh: true },
    );

    expect(sid).toBe('sec-from-api-12345');
  });

  it('API 也无 securityId 时从详情页提取', async () => {
    const api = createApi({ securityId: undefined });
    const page = new MockPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue('sec-from-page-12345');
    vi.spyOn(context, 'newPage').mockResolvedValue(page);
    const resolver = new SecurityIdResolver({ apiClient: api, pagePool });

    const sid = await resolver.resolve(job);

    expect(sid).toBe('sec-from-page-12345');
  });

  it('所有层失败返回 null', async () => {
    const api = createApi({ securityId: undefined });
    const page = new MockPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue(null);
    vi.spyOn(context, 'newPage').mockResolvedValue(page);
    const resolver = new SecurityIdResolver({ apiClient: api, pagePool });

    const sid = await resolver.resolve(job);

    expect(sid).toBeNull();
  });

  it('API 抛错时降级到详情页', async () => {
    const api: IBossAPIClient = {
      async getRecommendJobs() {
        throw new Error();
      },
      async getJobDetail() {
        throw new Error('api down');
      },
      async greetBoss() {
        throw new Error();
      },
    };
    const page = new MockPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue('sec-from-page-12345');
    vi.spyOn(context, 'newPage').mockResolvedValue(page);
    const resolver = new SecurityIdResolver({ apiClient: api, pagePool });

    const sid = await resolver.resolve(job);

    expect(sid).toBe('sec-from-page-12345');
  });

  it('validate 拒绝过短与 null 字符串', async () => {
    const resolver = new SecurityIdResolver({ apiClient: createApi(), pagePool });
    expect(resolver.validate('short', 'id')).toBe(false);
    expect(resolver.validate('contains-null-string', 'id')).toBe(false);
    expect(resolver.validate('valid-sec-id-12345', 'id')).toBe(true);
  });

  it('无 pagePool 时跳过详情页层', async () => {
    const api = createApi({ securityId: undefined });
    const resolver = new SecurityIdResolver({ apiClient: api });

    const sid = await resolver.resolve(job);

    expect(sid).toBeNull();
  });
});
