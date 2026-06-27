import type { BossErrorClassified, BossErrorType } from '../types.js';
import type { Logger } from 'pino';
import { createChild } from '../logger.js';
import { classifyError } from '../platform/boss/errors.js';

export interface SessionManagerLike {
  checkLoginState(force?: boolean): Promise<boolean>;
  refreshSession(): Promise<boolean>;
}

export interface RateLimiter {
  getPenaltyDelay(): number;
  slowDown(): void;
}

/** 简易令牌桶式限流器：维护当前延迟惩罚，被限流时增加惩罚。 */
export class SimpleRateLimiter implements RateLimiter {
  private penaltyMs: number;
  private readonly maxPenaltyMs: number;
  private readonly stepMs: number;

  constructor(options: { initialPenaltyMs?: number; stepMs?: number; maxPenaltyMs?: number } = {}) {
    this.penaltyMs = options.initialPenaltyMs ?? 0;
    this.stepMs = options.stepMs ?? 2000;
    this.maxPenaltyMs = options.maxPenaltyMs ?? 60000;
  }

  getPenaltyDelay(): number {
    return this.penaltyMs;
  }

  slowDown(): void {
    this.penaltyMs = Math.min(this.maxPenaltyMs, this.penaltyMs + this.stepMs);
  }

  reset(): void {
    this.penaltyMs = 0;
  }
}

export interface RetryExecutorOptions {
  sessionManager: SessionManagerLike;
  rateLimiter?: RateLimiter;
  logger?: Logger;
  maxAttempts?: number;
  baseBackoffMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  /** 人工介入处理器（如截图、暂停）。默认仅记日志。 */
  onHumanIntervention?: (classified: BossErrorClassified) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 1000;

/** 指数退避：2^(attempt-1) * base，带 10% 抖动。 */
export function calculateBackoff(attempt: number, baseMs = DEFAULT_BASE_BACKOFF_MS): number {
  const exp = Math.pow(2, Math.max(0, attempt - 1));
  const jitter = 1 + (Math.sin(attempt) + 1) / 20; // 0.9~1.1 之间确定抖动
  return Math.round(exp * baseMs * jitter);
}

export interface OperationContext {
  url?: string;
  operationName: string;
}

/**
 * 分类重试执行器：每次操作前检查登录态，
 * 错误按类型刷新会话 / 等待人工 / 退避重试。
 */
export class ClassifiedRetryExecutor {
  private sessionManager: SessionManagerLike;
  private rateLimiter?: RateLimiter;
  private logger: Logger;
  private maxAttempts: number;
  private baseBackoffMs: number;
  private sleepFn: (ms: number) => Promise<void>;
  private onHumanIntervention: (classified: BossErrorClassified) => Promise<void>;

  constructor(options: RetryExecutorOptions) {
    this.sessionManager = options.sessionManager;
    this.rateLimiter = options.rateLimiter;
    this.logger = options.logger ?? createChild('retry');
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.sleepFn = options.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    this.onHumanIntervention =
      options.onHumanIntervention ??
      (async (c) => {
        this.logger.warn({ type: c.type }, '需人工介入，已暂停');
      });
  }

  async execute<T>(operation: () => Promise<T>, context: OperationContext): Promise<T> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await this.sessionManager.checkLoginState();
        return await operation();
      } catch (error) {
        const classified = classifyError(error);
        this.logger.warn(
          { operationName: context.operationName, attempt, type: classified.type, error },
          '操作失败，按分类处理',
        );

        if (classified.needsHumanIntervention) {
          await this.onHumanIntervention(classified);
          if (attempt === this.maxAttempts) throw error;
          continue;
        }

        if (classified.needsAuthRefresh) {
          const refreshed = await this.sessionManager.refreshSession();
          if (!refreshed) {
            this.logger.error({ operationName: context.operationName }, '刷新登录态失败');
            throw error;
          }
          if (attempt === this.maxAttempts) throw error;
          continue;
        }

        if (!classified.retryable || attempt === this.maxAttempts) {
          throw error;
        }

        const backoff = calculateBackoff(attempt, this.baseBackoffMs);
        const penalty =
          classified.type === ('RATE_LIMITED' satisfies BossErrorType) && this.rateLimiter
            ? this.rateLimiter.getPenaltyDelay()
            : 0;
        await this.sleepFn(backoff + penalty);

        if (classified.type === ('RATE_LIMITED' satisfies BossErrorType) && this.rateLimiter) {
          this.rateLimiter.slowDown();
        }
      }
    }
    // 理论不可达：循环要么 return 要么 throw
    throw new Error(`重试耗尽: ${context.operationName}`);
  }
}
