import { describe, it, expect, vi } from 'vitest';
import { server } from '../../msw/handlers.js';
import { http, HttpResponse } from 'msw';
import { BossAPIClient } from '../../../platform/boss/api.js';
import { fixtureJobs } from '../../fixtures/jobs.js';
import { fixtureJobDetail } from '../../fixtures/job-detail.js';
import type { BossRequestBuilder } from '../../../platform/boss/request-builder.js';

function makeRequestBuilder(): BossRequestBuilder {
  return {
    buildHeaders: vi.fn().mockResolvedValue({ Referer: 'https://www.zhipin.com/' }),
  } as unknown as BossRequestBuilder;
}

describe('BossAPIClient 集成测试（MSW）', () => {
  it('getRecommendJobs 通过 MSW 返回规范化职位列表', async () => {
    const client = new BossAPIClient({ requestBuilder: makeRequestBuilder() });
    const res = await client.getRecommendJobs({ page: 1, pageSize: 10 });

    expect(res.code).toBe(0);
    expect(res.jobList).toHaveLength(fixtureJobs.length);
    expect(res.jobList[0].encryptJobId).toBe('job-001');
    expect(res.hasMore).toBe(true);
  });

  it('getJobDetail 通过 MSW 返回职位详情', async () => {
    const client = new BossAPIClient({ requestBuilder: makeRequestBuilder() });
    const res = await client.getJobDetail(fixtureJobs[0]);

    expect(res.encryptJobId).toBe('job-001');
    expect(res.jobName).toBe(fixtureJobDetail.jobName);
    expect(res.brandName).toBe(fixtureJobDetail.brandName);
  });

  it('greetBoss 通过 MSW 返回成功结果', async () => {
    const client = new BossAPIClient({ requestBuilder: makeRequestBuilder() });
    const res = await client.greetBoss('sec-001', 'job-001', '您好');

    expect(res.success).toBe(true);
    expect(res.code).toBe(0);
  });

  it('非 200 响应抛出 BossAPIError', async () => {
    server.use(
      http.get('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json', () => {
        return new HttpResponse('Forbidden', { status: 403 });
      }),
    );

    const client = new BossAPIClient({ requestBuilder: makeRequestBuilder() });
    await expect(client.getRecommendJobs({})).rejects.toThrow('风控拒绝');
  });

  it('业务 code !== 0 抛出 BossAPIError', async () => {
    server.use(
      http.get('https://www.zhipin.com/wapi/zpgeek/job/detail.json', () => {
        return HttpResponse.json({ code: 401, message: '登录过期' });
      }),
    );

    const client = new BossAPIClient({ requestBuilder: makeRequestBuilder() });
    await expect(client.getJobDetail(fixtureJobs[0])).rejects.toThrow('登录过期');
  });
});
