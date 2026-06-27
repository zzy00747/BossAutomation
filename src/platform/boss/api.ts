import type { IBossAPIClient } from '../../interfaces/api.js';
import type {
  GreetResult,
  JobDetail,
  JobListResponse,
  JobSearchParams,
  NormalizedJob,
  RecommendJobItem,
} from '../../types.js';
import { BossRequestBuilder } from './request-builder.js';
import {
  getGreetUrl,
  getJobDetailApiUrl,
  getRecommendJobsUrl,
} from './urls.js';
import { normalizeJobList } from './normalize.js';

/** Boss API 业务/HTTP 错误，携带状态码与响应体便于上层分类重试。 */
export class BossAPIError extends Error {
  readonly statusCode?: number;
  readonly code?: number;
  readonly resBody?: unknown;

  constructor(
    message: string,
    options: { statusCode?: number; code?: number; resBody?: unknown } = {},
  ) {
    super(message);
    this.name = 'BossAPIError';
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.resBody = options.resBody;
  }
}

interface RawListResponse {
  code: number;
  message?: string;
  zpData?: {
    jobList?: RecommendJobItem[];
    hasMore?: boolean;
    cursor?: string;
    total?: number;
  };
  // 部分接口直接把 jobList 放顶层
  jobList?: RecommendJobItem[];
  hasMore?: boolean;
  cursor?: string;
  total?: number;
}

interface RawDetailResponse {
  code: number;
  message?: string;
  zpData?: JobDetail & { securityId?: string };
}

interface RawGreetResponse {
  code: number;
  message?: string;
  zpData?: Record<string, unknown>;
}

export interface BossAPIClientOptions {
  requestBuilder: BossRequestBuilder;
  /** 自定义 fetch（测试注入）。默认全局 fetch。 */
  fetchImpl?: typeof fetch;
}

/**
 * Boss 直聘 API 客户端。
 * 直接请求 wapi，携带完整 Cookie/请求头；响应解包 zpData 并规范化。
 * route 拦截缓存由上层 DataCollector 负责，这里只做直接请求 fallback。
 */
export class BossAPIClient implements IBossAPIClient {
  private requestBuilder: BossRequestBuilder;
  private fetchImpl: typeof fetch;

  constructor(options: BossAPIClientOptions) {
    this.requestBuilder = options.requestBuilder;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async getRecommendJobs(params: JobSearchParams): Promise<JobListResponse> {
    const url = getRecommendJobsUrl(params);
    const headers = await this.requestBuilder.buildHeaders({
      referer: 'https://www.zhipin.com/web/recommend',
    });

    const res = await this.fetchImpl(url, { headers, method: 'GET' });
    const body = (await this.parseBody(res)) as unknown as RawListResponse;

    this.assertOk(res.status, body);

    const zpData = body.zpData ?? {};
    const rawList = zpData.jobList ?? body.jobList ?? [];
    const jobList = normalizeJobList(rawList);

    return {
      code: body.code,
      message: body.message ?? '',
      jobList,
      hasMore: zpData.hasMore ?? body.hasMore ?? false,
      cursor: zpData.cursor ?? body.cursor,
      total: zpData.total ?? body.total,
    };
  }

  async getJobDetail(job: NormalizedJob): Promise<JobDetail> {
    const url = getJobDetailApiUrl(job.encryptJobId);
    const headers = await this.requestBuilder.buildHeaders({
      referer: `https://www.zhipin.com/job_detail/${job.encryptJobId}.html`,
    });

    const res = await this.fetchImpl(url, { headers, method: 'GET' });
    const body = (await this.parseBody(res)) as unknown as RawDetailResponse;

    this.assertOk(res.status, body);

    const detail = body.zpData;
    if (!detail || !detail.postDescription) {
      throw new BossAPIError('职位详情数据缺失', {
        statusCode: res.status,
        code: body.code,
        resBody: body,
      });
    }

    return {
      ...detail,
      encryptJobId: detail.encryptJobId ?? job.encryptJobId,
      securityId: detail.securityId ?? job.securityId,
      fetchedAt: Date.now(),
    };
  }

  async greetBoss(
    securityId: string,
    encryptJobId: string,
    greeting?: string,
  ): Promise<GreetResult> {
    void greeting;
    const url = getGreetUrl(securityId, encryptJobId);
    const headers = await this.requestBuilder.buildHeaders({
      referer: `https://www.zhipin.com/job_detail/${encryptJobId}.html`,
    });

    const res = await this.fetchImpl(url, { headers, method: 'GET' });
    const body = (await this.parseBody(res)) as unknown as RawGreetResponse;

    if (res.status === 401 || body.code === 3001) {
      throw new BossAPIError('登录态过期', { statusCode: res.status, code: body.code, resBody: body });
    }
    if (res.status === 403) {
      throw new BossAPIError('风控拒绝', { statusCode: res.status, code: body.code, resBody: body });
    }
    if (res.status === 429) {
      throw new BossAPIError('请求限流', { statusCode: res.status, code: body.code, resBody: body });
    }

    return {
      success: body.code === 0,
      code: body.code,
      message: body.message,
      data: body.zpData,
    };
  }

  private assertOk(status: number, body: { code: number; message?: string }): void {
    if (status >= 200 && status < 300 && body.code === 0) return;

    if (status === 401 || body.code === 3001) {
      throw new BossAPIError('登录态过期', { statusCode: status, code: body.code, resBody: body });
    }
    if (status === 403) {
      throw new BossAPIError('风控拒绝', { statusCode: status, code: body.code, resBody: body });
    }
    if (status === 429) {
      throw new BossAPIError('请求限流', { statusCode: status, code: body.code, resBody: body });
    }

    throw new BossAPIError(body.message ?? `Boss API 错误 (status=${status})`, {
      statusCode: status,
      code: body.code,
      resBody: body,
    });
  }

  private async parseBody(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    if (!text) return { code: -1, message: '空响应' };
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { code: -1, message: `非 JSON 响应: ${text.slice(0, 120)}` };
    }
  }
}

export type { NormalizedJob };
