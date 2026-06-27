import type { IBossAPIClient } from '../../interfaces/api.js';
import type { IJobStorage } from '../../interfaces/storage.js';
import type { JobSearchParams, NormalizedJob } from '../../types.js';
import { createChild } from '../../logger.js';
import { randomSleep } from '../../browser/human-actions.js';

export interface JobSearchServiceOptions {
  apiClient: IBossAPIClient;
  storage: IJobStorage;
  logger?: import('pino').Logger;
  /** 翻页间隔，默认 8s-15s 随机。 */
  sleepFn?: (min: number, max: number) => Promise<void>;
  maxPages?: number;
}

/**
 * 推荐列表搜索与翻页服务。
 * page/cursor 自适应；跨页去重（基于 storage.hasJob）。
 */
export class JobSearchService {
  private apiClient: IBossAPIClient;
  private storage: IJobStorage;
  private logger: import('pino').Logger;
  private sleepFn: (min: number, max: number) => Promise<void>;
  private defaultMaxPages: number;

  constructor(options: JobSearchServiceOptions) {
    this.apiClient = options.apiClient;
    this.storage = options.storage;
    this.logger = options.logger ?? createChild('search');
    this.sleepFn = options.sleepFn ?? randomSleep;
    this.defaultMaxPages = options.maxPages ?? 5;
  }

  async fetchAllPages(
    baseParams: JobSearchParams,
    maxPages: number = this.defaultMaxPages,
  ): Promise<NormalizedJob[]> {
    const jobs: NormalizedJob[] = [];
    const seen = new Set<string>();
    let page = baseParams.page ?? 1;
    let cursor = baseParams.cursor;
    let totalSeen = 0;
    let totalSkipped = 0;

    for (let i = 0; i < maxPages; i++) {
      const params: JobSearchParams = { ...baseParams, pageSize: baseParams.pageSize ?? 15 };
      if (cursor) {
        params.cursor = cursor;
        delete params.page;
      } else {
        params.page = page;
        delete params.cursor;
      }

      const response = await this.apiClient.getRecommendJobs(params);
      let pageSkipped = 0;
      for (const job of response.jobList) {
        if (seen.has(job.encryptJobId)) {
          pageSkipped++;
          continue;
        }
        seen.add(job.encryptJobId);
        const exists = await this.storage.hasJob(job.encryptJobId);
        if (exists) {
          pageSkipped++;
          continue;
        }
        jobs.push(job);
      }

      totalSeen += response.jobList.length;
      totalSkipped += pageSkipped;
      this.logger.info(
        { page, cursor: !!cursor, fetched: response.jobList.length, skipped: pageSkipped },
        '翻页完成',
      );

      if (!response.hasMore) break;
      if (response.cursor) {
        cursor = response.cursor;
      } else {
        page++;
      }

      if (i < maxPages - 1) {
        await this.sleepFn(8000, 15000);
      }
    }

    this.logger.info(
      { totalSeen, totalSkipped, collected: jobs.length },
      '翻页结束',
    );
    return jobs;
  }
}
