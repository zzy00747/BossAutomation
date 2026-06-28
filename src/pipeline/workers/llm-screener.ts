import type { JobScreener, ScreenOutcome } from '../../llm/screener.js';
import type { IJobStorage } from '../../interfaces/storage.js';
import type { Config } from '../../config.js';
import type { Queue, DetailedJob, ScreenedJob } from '../queues.js';
import { createChild } from '../../logger.js';

export interface LLMScreenerWorkerOptions {
  jobScreener: JobScreener;
  storage: IJobStorage;
  detailQueue: Queue<DetailedJob>;
  shortlistedQueue: Queue<ScreenedJob>;
  config: Config;
  logger?: import('pino').Logger;
}

export interface ScreenerWorkerStats {
  processed: number;
  shortlisted: number;
  skipped: number;
  fromCache: number;
}

/**
 * LLM 筛选 worker：并发消费 detailQueue，调用 JobScreener.screen，
 * 通过阈值则入 shortlistedQueue，否则记 screened/skipped + skip_reason。支持优雅退出。
 */
export class LLMScreenerWorker {
  private jobScreener: JobScreener;
  private storage: IJobStorage;
  private detailQueue: Queue<DetailedJob>;
  private shortlistedQueue: Queue<ScreenedJob>;
  private config: Config;
  private logger: import('pino').Logger;
  private running = false;
  private active = 0;

  constructor(options: LLMScreenerWorkerOptions) {
    this.jobScreener = options.jobScreener;
    this.storage = options.storage;
    this.detailQueue = options.detailQueue;
    this.shortlistedQueue = options.shortlistedQueue;
    this.config = options.config;
    this.logger = options.logger ?? createChild('llm-screener-worker');
  }

  get isActive(): boolean {
    return this.active > 0;
  }

  async run(concurrency?: number): Promise<ScreenerWorkerStats> {
    const maxConcurrency = concurrency ?? this.config.LLM_CONCURRENCY;
    this.running = true;

    const stats: ScreenerWorkerStats = {
      processed: 0,
      shortlisted: 0,
      skipped: 0,
      fromCache: 0,
    };
    const workers: Promise<void>[] = [];

    for (let i = 0; i < maxConcurrency; i++) {
      workers.push(this.workerLoop(stats));
    }

    await Promise.all(workers);
    return stats;
  }

  async shutdown(): Promise<void> {
    this.running = false;
    this.detailQueue.drain();
    while (this.active > 0) {
      await new Promise((r) => setImmediate(r));
    }
  }

  private async workerLoop(stats: ScreenerWorkerStats): Promise<void> {
    while (this.running) {
      let job: DetailedJob;
      try {
        job = await this.detailQueue.dequeue();
      } catch {
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

  private async processJob(job: DetailedJob, stats: ScreenerWorkerStats): Promise<void> {
    stats.processed++;
    const encryptJobId = job.rawJob.encryptJobId;

    let outcome: ScreenOutcome;
    try {
      outcome = await this.jobScreener.screen(job.detail, encryptJobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ err: message, encryptJobId }, 'LLM 筛选异常');
      stats.skipped++;
      await this.storage.updateJobStatus(encryptJobId, 'failed', {
        jobName: job.rawJob.jobName,
        brandName: job.rawJob.brandName,
        failedReason: `LLM 筛选异常: ${message}`,
      });
      return;
    }

    if (outcome.fromCache) stats.fromCache++;

    if (outcome.isShortlisted) {
      this.shortlistedQueue.enqueue({
        rawJob: job.rawJob,
        detail: job.detail,
        screenResult: outcome.result,
        sourceKeyword: job.sourceKeyword,
      });
      stats.shortlisted++;
      this.logger.debug(
        { encryptJobId, matchScore: outcome.result.matchScore },
        '筛选通过，入候选队列',
      );
    } else {
      stats.skipped++;
      const skipReason = this.buildSkipReason(outcome);
      await this.storage.updateJobStatus(encryptJobId, 'skipped', {
        jobName: job.rawJob.jobName,
        brandName: job.rawJob.brandName,
        screenResultJson: JSON.stringify(outcome.result),
        skipReason,
      });
      this.logger.debug(
        { encryptJobId, matchScore: outcome.result.matchScore, skipReason },
        '筛选未通过，跳过',
      );
    }
  }

  private buildSkipReason(outcome: ScreenOutcome): string {
    const parts: string[] = [];
    if (outcome.result.matchScore < this.config.MATCH_SCORE_THRESHOLD) {
      parts.push(`matchScore=${outcome.result.matchScore} 低于阈值 ${this.config.MATCH_SCORE_THRESHOLD}`);
    }
    if (outcome.result.redFlags.length > 0) {
      parts.push(`redFlags=[${outcome.result.redFlags.join(',')}]`);
    }
    if (outcome.usedFallback) {
      parts.push('使用关键词 fallback');
    }
    return parts.join('; ') || '未通过阈值判定';
  }
}
