import type { ApplyService } from '../../platform/boss/apply.js';
import type { IJobStorage } from '../../interfaces/storage.js';
import type { Config } from '../../config.js';
import type { DailyStats } from '../../types.js';
import type { Queue, ScreenedJob } from '../queues.js';
import { randomSleep } from '../../browser/human-actions.js';
import { createChild } from '../../logger.js';

const APPLY_DELAY_MIN = 10_000;
const APPLY_DELAY_MAX = 20_000;

export interface ApplyWorkerOptions {
  applyService: ApplyService;
  storage: IJobStorage;
  shortlistedQueue: Queue<ScreenedJob>;
  config: Config;
  logger?: import('pino').Logger;
  sleepFn?: (min: number, max: number) => Promise<void>;
  now?: () => Date;
}

export interface ApplyWorkerStats {
  processed: number;
  applied: number;
  failed: number;
  dailyLimitReached: boolean;
}

/**
 * 投递 worker：串行消费 shortlistedQueue，受日上限与频率限制。
 * 默认串行（concurrency=1）；每次投递后随机间隔 10-20s。
 */
export class ApplyWorker {
  private applyService: ApplyService;
  private storage: IJobStorage;
  private shortlistedQueue: Queue<ScreenedJob>;
  private config: Config;
  private logger: import('pino').Logger;
  private sleepFn: (min: number, max: number) => Promise<void>;
  private now: () => Date;
  private running = false;

  constructor(options: ApplyWorkerOptions) {
    this.applyService = options.applyService;
    this.storage = options.storage;
    this.shortlistedQueue = options.shortlistedQueue;
    this.config = options.config;
    this.logger = options.logger ?? createChild('apply-worker');
    this.sleepFn = options.sleepFn ?? randomSleep;
    this.now = options.now ?? (() => new Date());
  }

  async run(concurrency?: number): Promise<ApplyWorkerStats> {
    const maxConcurrency = concurrency ?? this.config.APPLY_CONCURRENCY;
    this.running = true;

    const stats: ApplyWorkerStats = {
      processed: 0,
      applied: 0,
      failed: 0,
      dailyLimitReached: false,
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
    this.shortlistedQueue.drain();
  }

  private async workerLoop(stats: ApplyWorkerStats): Promise<void> {
    while (this.running) {
      if (await this.isDailyLimitReached()) {
        stats.dailyLimitReached = true;
        this.logger.warn(
          { limit: this.config.APPLY_DAILY_LIMIT },
          '已达日投递上限，停止投递',
        );
        return;
      }

      let job: ScreenedJob;
      try {
        job = await this.shortlistedQueue.dequeue();
      } catch {
        return;
      }

      stats.processed++;
      await this.processJob(job, stats);
      await this.sleepFn(APPLY_DELAY_MIN, APPLY_DELAY_MAX);
    }
  }

  private async isDailyLimitReached(): Promise<boolean> {
    const today = this.todayKey();
    const stats = await this.storage.getDailyStats(today);
    return (stats?.applied ?? 0) >= this.config.APPLY_DAILY_LIMIT;
  }

  private async processJob(job: ScreenedJob, stats: ApplyWorkerStats): Promise<void> {
    const result = await this.applyService.apply({
      ...job.rawJob,
      screenResult: job.screenResult,
    });

    if (result.success) {
      stats.applied++;
    } else {
      stats.failed++;
    }

    await this.recordDailyStats(result.success);
  }

  private async recordDailyStats(success: boolean): Promise<void> {
    const today = this.todayKey();
    const existing = await this.storage.getDailyStats(today);
    const next: DailyStats = existing ?? {
      date: today,
      totalSeen: 0,
      applied: 0,
      skipped: 0,
      failed: 0,
      llmCalls: 0,
    };
    if (success) {
      next.applied += 1;
    } else {
      next.failed += 1;
    }
    await this.storage.saveDailyStats(next);
  }

  private todayKey(): string {
    const d = this.now();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
