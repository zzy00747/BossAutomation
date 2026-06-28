import type { JobDetailService } from '../../platform/boss/job-detail.js';
import type { IJobStorage } from '../../interfaces/storage.js';
import type { Config } from '../../config.js';
import type { Queue, BrowserJob, DetailedJob } from '../queues.js';
import { createChild } from '../../logger.js';

export interface DetailFetcherOptions {
  jobDetailService: JobDetailService;
  storage: IJobStorage;
  rawJobQueue: Queue<BrowserJob>;
  detailQueue: Queue<DetailedJob>;
  config: Config;
  logger?: import('pino').Logger;
}

export interface DetailFetcherStats {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * 详情获取 worker：并发消费 rawJobQueue，调用 jobDetailService.getJobDetail，
 * 成功入 detailQueue，失败写 storage 记 failed。支持优雅退出。
 */
export class DetailFetcher {
  private jobDetailService: JobDetailService;
  private storage: IJobStorage;
  private rawJobQueue: Queue<BrowserJob>;
  private detailQueue: Queue<DetailedJob>;
  private config: Config;
  private logger: import('pino').Logger;
  private running = false;
  private active = 0;

  constructor(options: DetailFetcherOptions) {
    this.jobDetailService = options.jobDetailService;
    this.storage = options.storage;
    this.rawJobQueue = options.rawJobQueue;
    this.detailQueue = options.detailQueue;
    this.config = options.config;
    this.logger = options.logger ?? createChild('detail-fetcher');
  }

  get isActive(): boolean {
    return this.active > 0;
  }

  async run(concurrency?: number): Promise<DetailFetcherStats> {
    const maxConcurrency = concurrency ?? this.config.DETAIL_CONCURRENCY;
    this.running = true;

    const stats: DetailFetcherStats = { processed: 0, succeeded: 0, failed: 0 };
    const workers: Promise<void>[] = [];

    for (let i = 0; i < maxConcurrency; i++) {
      workers.push(this.workerLoop(stats));
    }

    await Promise.all(workers);
    return stats;
  }

  /** 优雅退出：停止拉取新任务，等待活跃任务完成。 */
  async shutdown(): Promise<void> {
    this.running = false;
    this.rawJobQueue.drain();
    while (this.active > 0) {
      await new Promise((r) => setImmediate(r));
    }
  }

  private async workerLoop(stats: DetailFetcherStats): Promise<void> {
    while (this.running) {
      let job: BrowserJob;
      try {
        job = await this.rawJobQueue.dequeue();
      } catch {
        // 队列已关闭
        return;
      }

      this.active++;
      try {
        await this.processJob(job, stats);
      } finally {
        this.active--;
      }
    }
  }

  private async processJob(job: BrowserJob, stats: DetailFetcherStats): Promise<void> {
    stats.processed++;
    try {
      const detail = await this.jobDetailService.getJobDetail(job.rawJob);
      this.detailQueue.enqueue({
        rawJob: job.rawJob,
        detail,
        sourceKeyword: job.sourceKeyword,
      });
      stats.succeeded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        { err: message, encryptJobId: job.rawJob.encryptJobId },
        '详情获取失败',
      );
      stats.failed++;
      await this.storage.updateJobStatus(job.rawJob.encryptJobId, 'failed', {
        jobName: job.rawJob.jobName,
        brandName: job.rawJob.brandName,
        failedReason: `详情获取失败: ${message}`,
      });
    }
  }
}
