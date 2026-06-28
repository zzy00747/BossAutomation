import type { IBossAPIClient, SecurityCheckHandler, SecurityCheckPayload } from '../../interfaces/api.js';
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
  /** code 37 风控时刷新 __zp_stoken__ 的处理器。 */
  securityCheckHandler?: SecurityCheckHandler;
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
  private securityCheckHandler?: SecurityCheckHandler;

  constructor(options: BossAPIClientOptions) {
    this.requestBuilder = options.requestBuilder;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.securityCheckHandler = options.securityCheckHandler;
  }

  async getRecommendJobs(params: JobSearchParams): Promise<JobListResponse> {
    const url = getRecommendJobsUrl(params);
    const body = await this.requestWithSecurityCheck(
      url,
      'https://www.zhipin.com/web/geek/job',
      'recommend',
    );
    const typedBody = body as unknown as RawListResponse;

    const zpData = typedBody.zpData ?? {};
    const rawList = zpData.jobList ?? typedBody.jobList ?? [];
    const jobList = normalizeJobList(rawList);

    return {
      code: typedBody.code,
      message: typedBody.message ?? '',
      jobList,
      hasMore: zpData.hasMore ?? typedBody.hasMore ?? false,
      cursor: zpData.cursor ?? typedBody.cursor,
      total: zpData.total ?? typedBody.total,
    };
  }

  async getJobDetail(job: NormalizedJob): Promise<JobDetail> {
    const url = getJobDetailApiUrl(job.encryptJobId, job.lid);
    const body = await this.requestWithSecurityCheck(
      url,
      `https://www.zhipin.com/job_detail/${job.encryptJobId}.html`,
      'detail',
    );
    const typedBody = body as unknown as RawDetailResponse;

    const detail = typedBody.zpData;
    if (!detail || !detail.postDescription) {
      throw new BossAPIError('职位详情数据缺失', {
        statusCode: 200,
        code: typedBody.code,
        resBody: typedBody,
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
    const body = await this.requestWithSecurityCheck(
      url,
      `https://www.zhipin.com/job_detail/${encryptJobId}.html`,
      'greet',
    );
    const typedBody = body as unknown as RawGreetResponse;

    if (typedBody.code === 401 || typedBody.code === 3001) {
      throw new BossAPIError('登录态过期', { statusCode: 200, code: typedBody.code, resBody: typedBody });
    }

    return {
      success: typedBody.code === 0,
      code: typedBody.code,
      message: typedBody.message,
      data: typedBody.zpData,
    };
  }

  private async requestWithSecurityCheck(
    url: string,
    referer: string,
    _operation: string,
  ): Promise<Record<string, unknown>> {
    const headers = await this.requestBuilder.buildHeaders({ referer });
    const res = await this.fetchImpl(url, { headers, method: 'GET' });
    const body = (await this.parseBody(res)) as Record<string, unknown>;

    if (res.status === 200 && body.code === 37) {
      const payload = this.extractSecurityCheckPayload(body);
      if (payload && this.securityCheckHandler) {
        const refreshed = await this.securityCheckHandler.refreshStoken(payload);
        if (refreshed) {
          // 刷新 Cookie 后重试一次
          const retryHeaders = await this.requestBuilder.buildHeaders({ referer });
          const retryRes = await this.fetchImpl(url, { headers: retryHeaders, method: 'GET' });
          return this.parseBody(retryRes);
        }
      }
    }

    this.assertOk(res.status, body as { code: number; message?: string });
    return body;
  }

  private extractSecurityCheckPayload(body: Record<string, unknown>): SecurityCheckPayload | null {
    const zpData = body.zpData as Record<string, unknown> | undefined;
    if (!zpData) return null;
    const seed = typeof zpData.seed === 'string' ? zpData.seed : undefined;
    const name = typeof zpData.name === 'string' ? zpData.name : undefined;
    const ts = typeof zpData.ts === 'number' ? zpData.ts : undefined;
    if (!seed || !name || ts === undefined) return null;
    return { seed, name, ts };
  }

  private assertOk(status: number, body: { code: number; message?: string }): void {
    if (status >= 200 && status < 300 && body.code === 0) return;

    if (status === 401 || body.code === 3001) {
      throw new BossAPIError('登录态过期', { statusCode: status, code: body.code, resBody: body });
    }
    if (status === 403 || body.code === 403) {
      throw new BossAPIError('风控拒绝', { statusCode: status, code: body.code, resBody: body });
    }
    if (status === 429 || body.code === 429) {
      throw new BossAPIError('请求限流', { statusCode: status, code: body.code, resBody: body });
    }
    if (body.code === 37) {
      throw new BossAPIError('您的环境存在异常', { statusCode: status, code: body.code, resBody: body });
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
