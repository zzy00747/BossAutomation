import type { BrowserManager } from '../browser/manager.js';
import type { SessionManager } from '../platform/boss/session-manager.js';
import type { JobSearchService } from '../platform/boss/search.js';
import type { JobDetailService } from '../platform/boss/job-detail.js';
import type { JobScreener } from '../llm/screener.js';
import type { ApplyService } from '../platform/boss/apply.js';
import type { IJobStorage } from '../interfaces/storage.js';
import type { Config } from '../config.js';
import type { DailyStats } from '../types.js';
import { Queue, type BrowserJob, type DetailedJob, type ScreenedJob } from './queues.js';
import type { SearchConfig } from './workers/browser-producer.js';
import { BrowserProducer } from './workers/browser-producer.js';
import { DetailFetcher } from './workers/detail-fetcher.js';
import { LLMScreenerWorker } from './workers/llm-screener.js';
import { ApplyWorker } from './workers/apply-worker.js';
import { createChild } from '../logger.js';

export interface OrchestratorDependencies {
  browserManager: Pick<BrowserManager, 'connect' | 'disconnect'>;
  sessionManager: Pick<SessionManager, 'checkLoginState' | 'refreshSession'>;
  searchService: JobSearchService;
  jobDetailService: JobDetailService;
  jobScreener: JobScreener;
  applyService: ApplyService;
  storage: IJobStorage;
  config: Config;
  logger?: import('pino').Logger;
  now?: () => Date;
  /** 覆盖 apply worker 的投递间隔（测试用）。 */
  applySleepFn?: (min: number, max: number) => Promise<void>;
}

export interface OrchestratorRunOptions {
  searchConfigs: SearchConfig[];
  detailConcurrency?: number;
  llmConcurrency?: number;
  applyConcurrency?: number;
}

export interface OrchestratorResult {
  dailyStats: DailyStats;
  producerStats: Awaited<ReturnType<BrowserProducer['run']>>;
  detailStats: Awaited<ReturnType<DetailFetcher['run']>>;
  screenerStats: Awaited<ReturnType<LLMScreenerWorker['run']>>;
  applyStats: Awaited<ReturnType<ApplyWorker['run']>>;
  interrupted: boolean;
}

/**
 * 主流程编排：连接浏览器 → 检查登录态 → 启动 4 worker 流水线 → 优雅退出 → 生成日报。
 * 中断恢复：启动时 storage 已有的 encryptJobId 由各 worker 通过 hasJob 跳过。
 */
export class Orchestrator {
  private deps: OrchestratorDependencies;
  private logger: import('pino').Logger;
  private now: () => Date;
  private interrupted = false;
  private shuttingDown = false;
  private signalHandlers?: { sigint: NodeJS.SignalsListener; sigterm: NodeJS.SignalsListener };

  private rawJobQueue = new Queue<BrowserJob>();
  private detailQueue = new Queue<DetailedJob>();
  private shortlistedQueue = new Queue<ScreenedJob>();

  private producer?: BrowserProducer;
  private detailFetcher?: DetailFetcher;
  private screenerWorker?: LLMScreenerWorker;
  private applyWorker?: ApplyWorker;

  constructor(deps: OrchestratorDependencies) {
    this.deps = deps;
    this.logger = deps.logger ?? createChild('orchestrator');
    this.now = deps.now ?? (() => new Date());
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async run(options: OrchestratorRunOptions): Promise<OrchestratorResult> {
    this.logger.info('启动编排器');

    try {
      await this.deps.browserManager.connect();

      const loggedIn = await this.deps.sessionManager.checkLoginState(true);
      if (!loggedIn) {
        throw new Error('登录态检查失败，无法继续');
      }

      this.installSignalHandlers();
      const result = await this.runPipeline(options);
      await this.generateDailyReport();
      return result;
    } finally {
      this.uninstallSignalHandlers();
      await this.deps.browserManager.disconnect();
    }
  }

  private async runPipeline(options: OrchestratorRunOptions): Promise<OrchestratorResult> {
    this.producer = new BrowserProducer({
      searchService: this.deps.searchService,
      storage: this.deps.storage,
      rawJobQueue: this.rawJobQueue,
      config: this.deps.config,
      logger: this.logger,
    });

    this.detailFetcher = new DetailFetcher({
      jobDetailService: this.deps.jobDetailService,
      storage: this.deps.storage,
      rawJobQueue: this.rawJobQueue,
      detailQueue: this.detailQueue,
      config: this.deps.config,
      logger: this.logger,
    });

    this.screenerWorker = new LLMScreenerWorker({
      jobScreener: this.deps.jobScreener,
      storage: this.deps.storage,
      detailQueue: this.detailQueue,
      shortlistedQueue: this.shortlistedQueue,
      config: this.deps.config,
      logger: this.logger,
    });

    this.applyWorker = new ApplyWorker({
      applyService: this.deps.applyService,
      storage: this.deps.storage,
      shortlistedQueue: this.shortlistedQueue,
      config: this.deps.config,
      logger: this.logger,
      now: this.now,
      ...(this.deps.applySleepFn && { sleepFn: this.deps.applySleepFn }),
    });

    // 下游 worker 先启动，避免上游入队时无消费者
    const detailPromise = this.detailFetcher.run(options.detailConcurrency).then((s) => {
      this.detailQueue.close();
      return s;
    });
    const screenerPromise = this.screenerWorker.run(options.llmConcurrency).then((s) => {
      this.shortlistedQueue.close();
      return s;
    });
    const applyPromise = this.applyWorker.run(options.applyConcurrency);

    const producerPromise = this.producer.run(options.searchConfigs).then((s) => {
      // 生产完成后关闭 rawJobQueue，detail fetcher 消费完即可退出
      this.rawJobQueue.close();
      return s;
    });

    const producerStats = await producerPromise;
    const detailStats = await detailPromise;
    const screenerStats = await screenerPromise;
    const applyStats = await applyPromise;

    return {
      dailyStats: await this.loadDailyStats(),
      producerStats,
      detailStats,
      screenerStats,
      applyStats,
      interrupted: this.interrupted,
    };
  }

  private installSignalHandlers(): void {
    const handler = (signal: NodeJS.Signals) => {
      if (this.shuttingDown) return;
      this.shuttingDown = true;
      this.interrupted = true;
      this.logger.warn({ signal }, '收到退出信号，开始优雅关闭');
      void this.gracefulShutdown();
    };
    this.signalHandlers = { sigint: handler, sigterm: handler };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  }

  private uninstallSignalHandlers(): void {
    if (!this.signalHandlers) return;
    process.off('SIGINT', this.signalHandlers.sigint);
    process.off('SIGTERM', this.signalHandlers.sigterm);
    this.signalHandlers = undefined;
  }

  async gracefulShutdown(): Promise<void> {
    this.shuttingDown = true;
    this.rawJobQueue.drain();
    this.detailQueue.drain();
    this.shortlistedQueue.drain();
    await Promise.allSettled([
      this.detailFetcher?.shutdown(),
      this.screenerWorker?.shutdown(),
      this.applyWorker?.shutdown(),
    ]);
    await this.generateDailyReport();
  }

  private async generateDailyReport(): Promise<DailyStats> {
    const stats = await this.loadDailyStats();
    this.logger.info(stats, '日报生成');
    return stats;
  }

  private async loadDailyStats(): Promise<DailyStats> {
    const date = this.todayKey();
    const existing = await this.deps.storage.getDailyStats(date);
    return existing ?? {
      date,
      totalSeen: 0,
      applied: 0,
      skipped: 0,
      failed: 0,
      llmCalls: 0,
    };
  }

  private todayKey(): string {
    const d = this.now();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
