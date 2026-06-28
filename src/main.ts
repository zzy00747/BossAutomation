import path from 'node:path';
import { getConfig, type Config } from './config.js';
import { createLogger } from './logger.js';
import { JobStorage } from './storage/store.js';
import { BrowserManager } from './browser/manager.js';
import { PagePool } from './browser/page-pool.js';
import { BossAuthService } from './platform/boss/auth.js';
import { SessionManager } from './platform/boss/session-manager.js';
import { CookieManager } from './platform/boss/cookie-manager.js';
import { BossRequestBuilder } from './platform/boss/request-builder.js';
import type { IBossAPIClient } from './interfaces/api.js';
import type { IBrowserDriver } from './interfaces/browser.js';
import { BossAPIClient } from './platform/boss/api.js';
import { JobSearchService } from './platform/boss/search.js';
import { JobDetailService } from './platform/boss/job-detail.js';
import { SecurityIdResolver } from './platform/boss/security-id-resolver.js';
import { ApplyService } from './platform/boss/apply.js';
import { LLMClient } from './llm/client.js';
import { JobScreener } from './llm/screener.js';
import { loadJobIntent } from './intent/job-intent.js';
import { Orchestrator } from './pipeline/orchestrator.js';
import { ReportExporter } from './report/exporter.js';
import { startMemoryMonitor } from './utils/memory-monitor.js';
import { cleanOldScreenshots } from './utils/screenshot-cleanup.js';
import { randomSleep } from './browser/human-actions.js';
import type { SearchConfig } from './pipeline/workers/browser-producer.js';
import type { JobSearchParams } from './types.js';

export interface RuntimeDependencies {
  config: Config;
  storage: JobStorage;
  browserManager: IBrowserDriver;
  sessionManager: Pick<SessionManager, 'checkLoginState' | 'refreshSession'>;
  apiClient: IBossAPIClient;
  searchService: JobSearchService;
  jobDetailService: JobDetailService;
  securityIdResolver: SecurityIdResolver;
  applyService: ApplyService;
  jobScreener: JobScreener;
  orchestrator: Orchestrator;
  reportExporter: ReportExporter;
  logger: import('pino').Logger;
  stopMemoryMonitor: () => void;
}

export interface BuildRuntimeOptions {
  config?: Config;
  now?: () => Date;
}

/**
 * 组合根：把所有模块按依赖顺序装配起来。
 * 拆分为独立函数便于集成测试注入 mock config 与断开真实浏览器。
 */
export async function buildRuntime(options: BuildRuntimeOptions = {}): Promise<RuntimeDependencies> {
  const config = options.config ?? getConfig();
  const logger = createLogger({ level: config.NODE_ENV === 'test' ? 'silent' : 'info' });
  const stopMemoryMonitor = startMemoryMonitor(logger, 60_000);

  const storage = new JobStorage({
    dbPath: config.DB_PATH,
    logger,
  });

  const browserManager = new BrowserManager({
    cdpUrl: config.CDP_URL,
    chromePath: config.CHROME_PATH,
    restartIntervalMs: 60 * 60 * 1000,
    logger,
  });
  await browserManager.connect();

  const context = await browserManager.getContext();
  const page = await browserManager.getPage();
  const pagePool = new PagePool(context, { maxPages: config.DETAIL_CONCURRENCY });

  const authService = new BossAuthService({
    browserManager,
    sessionPath: path.resolve(process.cwd(), 'data', 'session', 'boss.json'),
    logger,
  });
  const sessionManager = new SessionManager({
    page,
    context,
    authService,
    logger,
  });
  const cookieManager = new CookieManager(context);
  const requestBuilder = new BossRequestBuilder({ page, cookieManager });
  const apiClient = new BossAPIClient({ requestBuilder });

  const searchService = new JobSearchService({
    apiClient,
    storage,
    logger,
    sleepFn: randomSleep,
  });
  const jobDetailService = new JobDetailService({
    apiClient,
    pagePool,
    storage,
    logger,
  });
  const securityIdResolver = new SecurityIdResolver({ apiClient, logger });

  const provider = config.LLM_PROVIDER;
  const apiKey = provider === 'openai' ? config.OPENAI_API_KEY : config.ANTHROPIC_API_KEY;
  const baseURL = provider === 'openai' ? config.OPENAI_BASE_URL : config.ANTHROPIC_BASE_URL;
  const llmClient = new LLMClient({
    provider,
    apiKey: apiKey ?? '',
    model: config.LLM_MODEL,
    baseURL,
  });
  const jobIntent = loadJobIntent();
  const jobScreener = new JobScreener({
    llmClient,
    storage,
    config,
    jobIntent,
    logger,
  });

  const applyService = new ApplyService({
    apiClient,
    securityIdResolver,
    storage,
    config,
    logger,
    sleepFn: randomSleep,
  });

  const reportExporter = new ReportExporter({ storage, logger });

  const orchestrator = new Orchestrator({
    browserManager,
    sessionManager,
    searchService,
    jobDetailService,
    jobScreener,
    applyService,
    storage,
    config,
    logger,
    now: options.now ?? (() => new Date()),
    applySleepFn: randomSleep,
  });

  return {
    config,
    storage,
    browserManager,
    sessionManager,
    apiClient,
    searchService,
    jobDetailService,
    securityIdResolver,
    applyService,
    jobScreener,
    orchestrator,
    reportExporter,
    logger,
    stopMemoryMonitor,
  };
}

/**
 * 从环境变量解析搜索配置。
 * SEARCH_KEYWORDS=前端,React,Node 以逗号分隔；每个关键词生成一个 SearchConfig。
 * 缺省返回单个空参数配置（走推荐列表默认）。
 */
export function loadSearchConfigs(env: NodeJS.ProcessEnv = process.env): SearchConfig[] {
  const raw = env.SEARCH_KEYWORDS;
  if (!raw?.trim()) {
    return [{ sourceKeyword: 'recommend', params: {} as JobSearchParams }];
  }
  return raw
    .split(/[，,]/)
    .map((kw) => kw.trim())
    .filter((kw) => kw.length > 0)
    .map((kw) => ({
      sourceKeyword: kw,
      params: {} as JobSearchParams,
      maxPages: env.SEARCH_MAX_PAGES ? Number(env.SEARCH_MAX_PAGES) : undefined,
    }));
}

export interface MainOptions {
  searchConfigs?: SearchConfig[];
  now?: () => Date;
  runtime?: RuntimeDependencies;
}

export interface MainResult {
  reportPath?: string;
  csvPath?: string;
  date: string;
}

/**
 * 主入口：装载运行时 → 校验登录 → 跑流水线 → 导出报告 → 清理。
 * 全局异常时记录日志并触发 gracefulShutdown。
 */
export async function main(options: MainOptions = {}): Promise<MainResult> {
  let runtime: RuntimeDependencies | undefined = options.runtime;
  const cleanup = async () => {
    if (!options.runtime && runtime) {
      runtime.stopMemoryMonitor();
      await cleanOldScreenshots(runtime.config.SCREENSHOT_DIR, 24, runtime.logger);
      await runtime.storage.close();
    }
  };

  try {
    if (!runtime) {
      runtime = await buildRuntime({ now: options.now });
    }
    const logger = runtime.logger;
    const config = runtime.config;

    if (config.DRY_RUN) {
      logger.warn('当前为 Dry-run 模式，不会真实发起投递');
    } else {
      logger.info('生产模式：将真实发起沟通');
    }

    const searchConfigs = options.searchConfigs ?? loadSearchConfigs();
    const now = options.now ?? (() => new Date());
    const date = toLocalDateKey(now());

    const result = await runtime.orchestrator.run({
      searchConfigs,
      detailConcurrency: config.DETAIL_CONCURRENCY,
      llmConcurrency: config.LLM_CONCURRENCY,
      applyConcurrency: config.APPLY_CONCURRENCY,
    });

    logger.info(
      {
        enqueued: result.producerStats.enqueued,
        details: result.detailStats.succeeded,
        shortlisted: result.screenerStats.shortlisted,
        applied: result.applyStats.applied,
        interrupted: result.interrupted,
      },
      '流水线执行完成',
    );

    const exportResult = await runtime.reportExporter.exportAll({ date, topN: 20 });
    logger.info(
      { markdown: exportResult.markdownPath, csv: exportResult.csvPath },
      '报告已导出',
    );

    return { reportPath: exportResult.markdownPath, csvPath: exportResult.csvPath, date };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime?.logger.error({ err: message }, '主流程异常，准备退出');
    await runtime?.orchestrator.gracefulShutdown().catch(() => {});
    throw error;
  } finally {
    await cleanup();
  }
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 直接执行时调用 main（ts-node / node --import）
const isDirectEntry = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
  } catch {
    return false;
  }
})();

if (isDirectEntry) {
  main()
    .then((result) => {
      console.log(`报告路径: ${result.reportPath ?? '-'}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('运行失败:', err);
      process.exit(1);
    });
}
