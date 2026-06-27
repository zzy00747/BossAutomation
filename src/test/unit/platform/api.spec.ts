import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { BossAPIClient, BossAPIError } from '../../../platform/boss/api.js';
import { BossRequestBuilder } from '../../../platform/boss/request-builder.js';
import { CookieManager } from '../../../platform/boss/cookie-manager.js';
import { MockPage, MockBrowserContext } from '../../__mocks__/mock-browser.js';
import { server } from '../../msw/handlers.js';
import { fixtureJobs } from '../../fixtures/jobs.js';

function createClient(page: MockPage) {
  const cookieManager = new CookieManager(new MockBrowserContext());
  const requestBuilder = new BossRequestBuilder({ page, cookieManager });
  return new BossAPIClient({ requestBuilder });
}

describe('BossAPIClient', () => {
  let page: MockPage;

  afterAll(() => server.close());
  afterEach(() => server.resetHandlers());

  beforeEach(() => {
    page = new MockPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0',
    );
  });

  it('getRecommendJobs 解包 zpData 并规范化', async () => {
    const client = createClient(page);
    const res = await client.getRecommendJobs({ page: 1, pageSize: 15 });
    expect(res.code).toBe(0);
    expect(res.jobList.length).toBeGreaterThan(0);
    expect(res.jobList[0]).toHaveProperty('encryptJobId');
    expect(res.hasMore).toBe(true); // page 1 < 3
    expect(res.cursor).toBe('cursor-1');
  });

  it('getRecommendJobs 越过末页时 hasMore=false', async () => {
    const client = createClient(page);
    const res = await client.getRecommendJobs({ page: 3, pageSize: 15 });
    expect(res.hasMore).toBe(false);
    expect(res.cursor).toBeUndefined();
  });

  it('getRecommendJobs 兼容顶层 jobList（无 zpData）', async () => {
    server.use(
      http.get('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json', () =>
        HttpResponse.json({
          code: 0,
          message: 'OK',
          jobList: [{ id: 'flat-1', jobName: 'x', brandName: 'b' }],
          hasMore: false,
        }),
      ),
    );
    const client = createClient(page);
    const res = await client.getRecommendJobs({ page: 1 });
    expect(res.jobList[0].encryptJobId).toBe('flat-1');
    expect(res.hasMore).toBe(false);
  });

  it('getJobDetail 返回结构化详情', async () => {
    const client = createClient(page);
    const detail = await client.getJobDetail(fixtureJobs[0]);
    expect(detail.encryptJobId).toBe(fixtureJobs[0].encryptJobId);
    expect(detail.postDescription).toBeTruthy();
    expect(detail.skills).toContain('React');
  });

  it('getJobDetail 缺失描述时抛 BossAPIError', async () => {
    server.use(
      http.get('https://www.zhipin.com/wapi/zpgeek/job/detail.json', () =>
        HttpResponse.json({ code: 0, message: 'OK', zpData: { encryptJobId: 'x' } }),
      ),
    );
    const client = createClient(page);
    await expect(client.getJobDetail(fixtureJobs[0])).rejects.toBeInstanceOf(BossAPIError);
  });

  it('业务码非 0 时抛 BossAPIError 携带 code', async () => {
    server.use(
      http.get('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json', () =>
        HttpResponse.json({ code: 3001, message: '未登录' }),
      ),
    );
    const client = createClient(page);
    try {
      await client.getRecommendJobs({ page: 1 });
      throw new Error('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BossAPIError);
      expect((err as BossAPIError).code).toBe(3001);
    }
  });

  it('403 风控错误抛 BossAPIError', async () => {
    server.use(
      http.get('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json', () =>
        HttpResponse.json({ code: 0, message: 'blocked' }, { status: 403 }),
      ),
    );
    const client = createClient(page);
    await expect(client.getRecommendJobs({ page: 1 })).rejects.toMatchObject({
      name: 'BossAPIError',
      statusCode: 403,
    });
  });

  it('429 限流错误抛 BossAPIError', async () => {
    server.use(
      http.get('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json', () =>
        HttpResponse.json({ code: 0, message: 'rate limited' }, { status: 429 }),
      ),
    );
    const client = createClient(page);
    await expect(client.getRecommendJobs({ page: 1 })).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it('greetBoss 成功返回 success', async () => {
    const client = createClient(page);
    const res = await client.greetBoss('sec-001', 'job-001');
    expect(res.success).toBe(true);
    expect(res.code).toBe(0);
  });

  it('greetBoss 遇 401 抛 BossAPIError', async () => {
    server.use(
      http.get('https://www.zhipin.com/wapi/zpgeek/friend/add.json', () =>
        HttpResponse.json({ code: 3001, message: '未登录' }, { status: 401 }),
      ),
    );
    const client = createClient(page);
    await expect(client.greetBoss('sec-001', 'job-001')).rejects.toMatchObject({
      statusCode: 401,
      code: 3001,
    });
  });

  it('网络错误向上抛出', async () => {
    server.use(
      http.get('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json', () =>
        HttpResponse.error(),
      ),
    );
    const client = createClient(page);
    await expect(client.getRecommendJobs({ page: 1 })).rejects.toThrow();
  });
});
