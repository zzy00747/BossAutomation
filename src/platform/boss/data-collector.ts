import type { IPage } from '../../interfaces/browser.js';
import type { NormalizedJob, RecommendJobItem } from '../../types.js';
import { createChild } from '../../logger.js';
import { extractPageState, extractJobsFromState } from './state-extractor.js';
import { normalizeJobList } from './normalize.js';
import {
  COMPANY_NAME_SELECTOR,
  JOB_AREA_SELECTOR,
  JOB_CARD_SELECTOR,
  JOB_CARD_ALT_SELECTORS,
  JOB_SALARY_SELECTOR,
  JOB_TITLE_SELECTOR,
} from './selectors.js';

export type LayerName =
  | 'state'
  | 'route'
  | 'response'
  | 'cdp'
  | 'inject'
  | 'fallback'
  | 'dom';

export interface LayerHit {
  layer: LayerName;
  count: number;
  durationMs: number;
}

export interface DataCollectorOptions {
  logger?: import('pino').Logger;
  /** Layer 4 JS 注入收集到的原始职位（由外部注入器写入 window.__BOSS_COLLECTED__）。 */
  injectedJobs?: RecommendJobItem[];
  /** Fallback：直接 API 请求结果。 */
  fallbackJobs?: NormalizedJob[];
  /** 各层等待响应的延时（默认 3000ms）。 */
  networkWaitMs?: number;
  /** 用于注入 sleep 的可替换函数，测试中立即返回。 */
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * 多层数据获取器。按 Layer0→Layer4→Fallback→DOM 降级，
 * 首个命中非空结果的层即返回，并记录每层捕获数量。
 */
export class BossDataCollector {
  private logger: import('pino').Logger;
  private injectedJobs: RecommendJobItem[];
  private fallbackJobs: NormalizedJob[];
  private networkWaitMs: number;
  private sleepFn: (ms: number) => Promise<void>;
  private collectedFromResponse: RecommendJobItem[] = [];
  private routeBuffer: RecommendJobItem[] = [];
  private hits: LayerHit[] = [];

  constructor(options: DataCollectorOptions = {}) {
    this.logger = options.logger ?? createChild('data-collector');
    this.injectedJobs = options.injectedJobs ?? [];
    this.fallbackJobs = options.fallbackJobs ?? [];
    this.networkWaitMs = options.networkWaitMs ?? 3000;
    this.sleepFn = options.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  }

  getHits(): LayerHit[] {
    return [...this.hits];
  }

  /** Layer 2：响应监听写入的缓冲。供 page.on('response') handler 调用。 */
  pushResponseJobs(jobs: RecommendJobItem[]): void {
    this.collectedFromResponse.push(...jobs);
  }

  /** Layer 1：route 拦截写入的缓冲。供 page.route handler 调用。 */
  pushRouteJobs(jobs: RecommendJobItem[]): void {
    this.routeBuffer.push(...jobs);
  }

  async collectFromPage(page: IPage): Promise<NormalizedJob[]> {
    let jobs = await this.tryLayer('state', () => this.collectFromState(page));
    if (jobs.length > 0) return jobs;

    await this.sleepFn(this.networkWaitMs);

    jobs = await this.tryLayer('route', () => Promise.resolve(normalizeJobList(this.routeBuffer)));
    if (jobs.length > 0) return jobs;

    jobs = await this.tryLayer('response', () =>
      Promise.resolve(normalizeJobList(this.collectedFromResponse)),
    );
    if (jobs.length > 0) return jobs;

    jobs = await this.tryLayer('inject', () =>
      Promise.resolve(normalizeJobList(this.injectedJobs)),
    );
    if (jobs.length > 0) return jobs;

    jobs = await this.tryLayer('fallback', () => Promise.resolve(this.fallbackJobs));
    if (jobs.length > 0) return jobs;

    jobs = await this.tryLayer('dom', () => this.parseJobsFromDOM(page));
    return jobs;
  }

  private async tryLayer(
    layer: LayerName,
    fn: () => Promise<NormalizedJob[]>,
  ): Promise<NormalizedJob[]> {
    const start = Date.now();
    try {
      const result = await fn();
      const jobs = Array.isArray(result) ? result : [];
      const durationMs = Date.now() - start;
      this.hits.push({ layer, count: jobs.length, durationMs });
      this.logger.info({ layer, count: jobs.length, durationMs }, '数据层命中');
      return jobs;
    } catch (err) {
      const durationMs = Date.now() - start;
      this.hits.push({ layer, count: 0, durationMs });
      this.logger.warn({ layer, err }, '数据层失败，降级到下一层');
      return [];
    }
  }

  private async collectFromState(page: IPage): Promise<NormalizedJob[]> {
    const state = await extractPageState(page);
    return extractJobsFromState(state);
  }

  /** DOM 兜底：按选择器解析职位卡片文本。 */
  async parseJobsFromDOM(page: IPage): Promise<NormalizedJob[]> {
    return page.evaluate<NormalizedJob[], string[]>(
      (selectors: string[]) => {
        const cards = Array.from(
          document.querySelectorAll(selectors[0]),
        ) as Array<HTMLElement>;
        if (cards.length === 0 && selectors.length > 1) {
          for (let i = 1; i < selectors.length; i++) {
            const alt = document.querySelectorAll(selectors[i]);
            if (alt.length > 0) {
              return Array.from(alt).map(() => ({})) as unknown as NormalizedJob[];
            }
          }
        }
        return cards
          .map((card): NormalizedJob | null => {
            const titleEl = card.querySelector(selectors[0] + ' *') ?? null;
            const id = card.getAttribute('ka') || card.dataset.jobid || '';
            if (!id) return null;
            return {
              encryptJobId: String(id),
              jobName: titleEl?.textContent?.trim() ?? '未知职位',
              brandName: '',
            };
          })
          .filter((j): j is NormalizedJob => j !== null);
      },
      [JOB_CARD_SELECTOR, ...JOB_CARD_ALT_SELECTORS, JOB_TITLE_SELECTOR, JOB_SALARY_SELECTOR, JOB_AREA_SELECTOR, COMPANY_NAME_SELECTOR],
    );
  }
}
