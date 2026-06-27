import type { IBossAPIClient } from '../../interfaces/api.js';
import type { IPage } from '../../interfaces/browser.js';
import type { NormalizedJob } from '../../types.js';
import { createChild } from '../../logger.js';
import { getJobDetailPageUrl } from './urls.js';
import { PagePool } from '../../browser/page-pool.js';

export interface SecurityIdResolverOptions {
  apiClient: IBossAPIClient;
  pagePool?: PagePool;
  logger?: import('pino').Logger;
}

export interface ResolveOptions {
  forceRefresh?: boolean;
}

const MIN_SECURITY_ID_LENGTH = 8;

/**
 * securityId 多层解析：
 * 1. job.securityId（缓存）→ validate；
 * 2. 详情 API 返回的 securityId → validate；
 * 3. 详情页 DOM/JS 变量/URL 参数提取。
 */
export class SecurityIdResolver {
  private apiClient: IBossAPIClient;
  private pagePool?: PagePool;
  private logger: import('pino').Logger;

  constructor(options: SecurityIdResolverOptions) {
    this.apiClient = options.apiClient;
    this.pagePool = options.pagePool;
    this.logger = options.logger ?? createChild('security-id-resolver');
  }

  async resolve(
    job: NormalizedJob,
    options: ResolveOptions = {},
  ): Promise<string | null> {
    if (job.securityId && !options.forceRefresh) {
      if (this.validate(job.securityId, job.encryptJobId)) {
        this.logger.debug({ encryptJobId: job.encryptJobId }, '使用 job 缓存 securityId');
        return job.securityId;
      }
    }

    const fromApi = await this.resolveFromAPI(job);
    if (fromApi) return fromApi;

    const fromPage = await this.resolveFromPage(job);
    if (fromPage) return fromPage;

    this.logger.warn({ encryptJobId: job.encryptJobId }, 'securityId 解析全部失败');
    return null;
  }

  /**
   * 校验 securityId 有效性。
   * 不实际调用打招呼 API（避免副作用），仅检查非空与长度。
   * 调用方可传入更严格的校验器覆盖。
   */
  validate(securityId: string, _encryptJobId: string): boolean {
    return (
      typeof securityId === 'string' &&
      securityId.length >= MIN_SECURITY_ID_LENGTH &&
      !securityId.includes('null')
    );
  }

  private async resolveFromAPI(job: NormalizedJob): Promise<string | null> {
    try {
      const detail = await this.apiClient.getJobDetail(job);
      const sid = detail.securityId;
      if (sid && this.validate(sid, job.encryptJobId)) {
        this.logger.info({ encryptJobId: job.encryptJobId }, '从详情 API 解析 securityId');
        return sid;
      }
    } catch (err) {
      this.logger.warn({ err, encryptJobId: job.encryptJobId }, '详情 API 解析 securityId 失败');
    }
    return null;
  }

  private async resolveFromPage(job: NormalizedJob): Promise<string | null> {
    if (!this.pagePool) return null;
    let page: IPage | null = null;
    try {
      page = await this.pagePool.acquire();
      await page.goto(getJobDetailPageUrl(job.encryptJobId), { waitUntil: 'domcontentloaded' });
      const sid = await page.evaluate<string | null>(() => {
        const w = window as unknown as {
          __BOSS_SECURITY_ID__?: string;
          __NUXT__?: { state?: { job?: { securityId?: string } } };
        };
        if (w.__BOSS_SECURITY_ID__) return w.__BOSS_SECURITY_ID__;
        const nuxtSid = w.__NUXT__?.state?.job?.securityId;
        if (nuxtSid) return nuxtSid;

        const link = document.querySelector<HTMLAnchorElement>('a[href*="securityId"]');
        if (link) {
          const m = link.href.match(/securityId=([^&]+)/);
          if (m?.[1]) return decodeURIComponent(m[1]);
        }
        const meta = document.querySelector<HTMLMetaElement>('meta[name="securityId"]');
        if (meta?.content) return meta.content;
        return null;
      });

      if (sid && this.validate(sid, job.encryptJobId)) {
        this.logger.info({ encryptJobId: job.encryptJobId }, '从详情页解析 securityId');
        return sid;
      }
    } catch (err) {
      this.logger.warn({ err, encryptJobId: job.encryptJobId }, '详情页解析 securityId 失败');
    } finally {
      if (page) await this.pagePool.release(page);
    }
    return null;
  }
}
