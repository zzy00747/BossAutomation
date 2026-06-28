import type { IBossAPIClient } from '../../interfaces/api.js';
import type { IJobStorage } from '../../interfaces/storage.js';
import type { IPage } from '../../interfaces/browser.js';
import type { JobDetail, NormalizedJob } from '../../types.js';
import { createChild } from '../../logger.js';
import { getJobDetailPageUrl } from './urls.js';
import { PagePool } from '../../browser/page-pool.js';

export interface JobDetailServiceOptions {
  apiClient: IBossAPIClient;
  pagePool: PagePool;
  storage: IJobStorage;
  logger?: import('pino').Logger;
  /** 缓存有效期天数，默认 7。 */
  cacheTtlDays?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface HtmlDetail {
  jobName?: string;
  salary?: string;
  postDescription?: string;
  companyDescription?: string;
  location?: string;
  experience?: string;
  degree?: string;
  skills?: string[];
  brandScaleName?: string;
  industry?: string;
}

/**
 * 职位详情双轨获取：优先 API 结构化详情，
 * 描述缺失时从 HTML 详情页补充，缓存 7 天。
 */
export class JobDetailService {
  private apiClient: IBossAPIClient;
  private pagePool: PagePool;
  private storage: IJobStorage;
  private logger: import('pino').Logger;
  private cacheTtlMs: number;

  constructor(options: JobDetailServiceOptions) {
    this.apiClient = options.apiClient;
    this.pagePool = options.pagePool;
    this.storage = options.storage;
    this.logger = options.logger ?? createChild('job-detail');
    this.cacheTtlMs = (options.cacheTtlDays ?? 7) * MS_PER_DAY;
  }

  async getJobDetail(job: NormalizedJob): Promise<JobDetail> {
    const cached = await this.loadCached(job.encryptJobId);
    if (cached) {
      this.logger.debug({ encryptJobId: job.encryptJobId }, '详情缓存命中');
      return cached;
    }

    let detail = await this.getDetailFromAPI(job);
    if (!detail?.postDescription) {
      detail = await this.mergeWithHTMLDetail(job, detail);
    } else {
      const htmlDetail = await this.getDetailFromHTML(job);
      detail = this.mergeDetails(detail, htmlDetail);
    }

    if (detail) {
      await this.saveCache(job.encryptJobId, detail);
    }

    return detail ?? this.emptyDetail(job);
  }

  private async getDetailFromAPI(job: NormalizedJob): Promise<JobDetail | null> {
    try {
      return await this.apiClient.getJobDetail(job);
    } catch (err) {
      this.logger.warn({ err, encryptJobId: job.encryptJobId }, 'API 详情获取失败');
      return null;
    }
  }

  private async getDetailFromHTML(job: NormalizedJob): Promise<HtmlDetail | null> {
    let page: IPage | null = null;
    try {
      page = await this.pagePool.acquire();
      await page.goto(getJobDetailPageUrl(job.encryptJobId), { waitUntil: 'domcontentloaded' });
      // 使用字符串函数体避免 tsx 转译引入 __name 等辅助函数在页面上下文缺失。
      return await page.evaluate<HtmlDetail>(`(() => {
        const text = (sel) => {
          const el = document.querySelector(sel);
          return el?.textContent?.trim() || undefined;
        };
        const descEl = document.querySelector('.job-sec-text, .job-detail .job-sec-text');
        return {
          jobName: text('.job-banner .name h1') || text('.name .job-title'),
          salary: text('.job-banner .salary'),
          postDescription: descEl?.textContent?.trim() || undefined,
          companyDescription: text('.company-info .company-desc'),
          location: text('.location-address'),
          experience: text('.job-banner .info-primary p'),
          degree: text('.job-banner .info-primary .text-desc'),
          brandScaleName: text('.company-text .company-scale'),
          industry: text('.company-text .industry'),
        };
      })()`);
    } catch (err) {
      this.logger.warn({ err, encryptJobId: job.encryptJobId }, 'HTML 详情获取失败');
      return null;
    } finally {
      if (page) await this.pagePool.release(page);
    }
  }

  private async mergeWithHTMLDetail(
    job: NormalizedJob,
    apiDetail: JobDetail | null,
  ): Promise<JobDetail | null> {
    const html = await this.getDetailFromHTML(job);
    if (!html && !apiDetail) return null;
    const base = apiDetail ?? this.emptyDetail(job);
    return this.mergeDetails(base, html);
  }

  private mergeDetails(api: JobDetail, html: HtmlDetail | null): JobDetail {
    if (!html) return api;
    return {
      ...api,
      jobName: api.jobName || html.jobName || '',
      salary: api.salary || html.salary,
      location: api.location || html.location,
      experience: api.experience || html.experience,
      degree: api.degree || html.degree,
      postDescription: api.postDescription || html.postDescription || '',
      companyDescription: api.companyDescription || html.companyDescription,
      brandScaleName: api.brandScaleName || html.brandScaleName,
      industry: api.industry || html.industry,
      skills: api.skills?.length ? api.skills : html.skills,
    };
  }

  private emptyDetail(job: NormalizedJob): JobDetail {
    return {
      encryptJobId: job.encryptJobId,
      securityId: job.securityId,
      jobName: job.jobName,
      brandName: job.brandName,
      postDescription: '',
      fetchedAt: Date.now(),
    };
  }

  private async loadCached(encryptJobId: string): Promise<JobDetail | undefined> {
    const record = await this.storage.getJobById(encryptJobId);
    if (!record?.detailCachedAt) return undefined;
    if (Date.now() - record.detailCachedAt > this.cacheTtlMs) return undefined;
    if (!record.apiDetailJson) return undefined;
    try {
      const detail = JSON.parse(record.apiDetailJson) as JobDetail;
      return { ...detail, fetchedAt: record.detailCachedAt };
    } catch {
      return undefined;
    }
  }

  private async saveCache(encryptJobId: string, detail: JobDetail): Promise<void> {
    const apiDetailJson = JSON.stringify(detail);
    await this.storage.updateJobStatus(encryptJobId, 'screened', {
      apiDetailJson,
      detailCachedAt: Date.now(),
    });
  }
}
