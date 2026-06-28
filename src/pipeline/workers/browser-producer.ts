import type { JobSearchService } from '../../platform/boss/search.js';
import type { IJobStorage } from '../../interfaces/storage.js';
import type { Config } from '../../config.js';
import type { JobSearchParams, NormalizedJob } from '../../types.js';
import type { Queue, BrowserJob } from '../queues.js';
import { createChild } from '../../logger.js';

export interface SearchConfig {
  /** 来源关键词，用于追溯与统计。 */
  sourceKeyword: string;
  /** 搜索参数（page/cursor 由 searchService 内部维护）。 */
  params: JobSearchParams;
  /** 最大翻页数，缺省使用 searchService 默认。 */
  maxPages?: number;
  /** 命中即过滤的职位名关键词。 */
  excludeKeywords?: string[];
  /** 命中即过滤的公司名（与 storage 黑名单取并集）。 */
  excludeBrands?: string[];
}

export interface BrowserProducerOptions {
  searchService: JobSearchService;
  storage: IJobStorage;
  rawJobQueue: Queue<BrowserJob>;
  config: Config;
  logger?: import('pino').Logger;
}

export interface ProducerStats {
  totalSeen: number;
  enqueued: number;
  skippedDuplicate: number;
  skippedBlacklist: number;
  skippedExclude: number;
}

/**
 * 职位生产者：循环搜索配置，去重 + 黑名单/排除词过滤后入队。
 * 浏览器操作必须单线程，因此按配置顺序串行执行 fetchAllPages。
 */
export class BrowserProducer {
  private searchService: JobSearchService;
  private storage: IJobStorage;
  private rawJobQueue: Queue<BrowserJob>;
  protected readonly config: Config;
  private logger: import('pino').Logger;

  constructor(options: BrowserProducerOptions) {
    this.searchService = options.searchService;
    this.storage = options.storage;
    this.rawJobQueue = options.rawJobQueue;
    this.config = options.config;
    this.logger = options.logger ?? createChild('browser-producer');
  }

  async run(searchConfigs: SearchConfig[]): Promise<ProducerStats> {
    const stats: ProducerStats = {
      totalSeen: 0,
      enqueued: 0,
      skippedDuplicate: 0,
      skippedBlacklist: 0,
      skippedExclude: 0,
    };

    for (const searchConfig of searchConfigs) {
      if (this.rawJobQueue.isClosed) {
        this.logger.info('队列已关闭，停止生产');
        break;
      }

      this.logger.info(
        { sourceKeyword: searchConfig.sourceKeyword },
        '开始搜索配置',
      );

      const jobs = await this.searchService.fetchAllPages(
        searchConfig.params,
        searchConfig.maxPages,
      );

      for (const job of jobs) {
        stats.totalSeen++;

        if (await this.storage.hasJob(job.encryptJobId)) {
          stats.skippedDuplicate++;
          continue;
        }

        if (await this.isBlacklisted(job)) {
          stats.skippedBlacklist++;
          this.logger.debug(
            { encryptJobId: job.encryptJobId, brandName: job.brandName },
            '黑名单公司，跳过',
          );
          continue;
        }

        if (this.matchesExclude(job, searchConfig)) {
          stats.skippedExclude++;
          this.logger.debug(
            { encryptJobId: job.encryptJobId, jobName: job.jobName },
            '命中排除关键词，跳过',
          );
          continue;
        }

        this.rawJobQueue.enqueue({ rawJob: job, sourceKeyword: searchConfig.sourceKeyword });
        stats.enqueued++;
      }

      this.logger.info(
        {
          sourceKeyword: searchConfig.sourceKeyword,
          seen: jobs.length,
          enqueued: stats.enqueued,
        },
        '搜索配置完成',
      );
    }

    this.logger.info(stats, '生产者结束');
    return stats;
  }

  private async isBlacklisted(job: NormalizedJob): Promise<boolean> {
    if (!job.brandName) return false;
    return this.storage.isBlacklisted(job.brandName);
  }

  private matchesExclude(job: NormalizedJob, searchConfig: SearchConfig): boolean {
    const excludeKeywords = searchConfig.excludeKeywords ?? [];
    if (excludeKeywords.length > 0 && job.jobName) {
      const name = job.jobName.toLowerCase();
      if (excludeKeywords.some((kw) => name.includes(kw.toLowerCase()))) {
        return true;
      }
    }
    const excludeBrands = searchConfig.excludeBrands ?? [];
    if (excludeBrands.length > 0 && job.brandName) {
      const brand = job.brandName.toLowerCase();
      if (excludeBrands.some((b) => brand.includes(b.toLowerCase()))) {
        return true;
      }
    }
    return false;
  }
}
