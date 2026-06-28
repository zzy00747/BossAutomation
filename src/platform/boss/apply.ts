import type { IBossAPIClient } from '../../interfaces/api.js';
import type { IJobStorage } from '../../interfaces/storage.js';
import type { Config } from '../../config.js';
import type { NormalizedJob, ScreenResult, GreetResult } from '../../types.js';
import { SecurityIdResolver } from './security-id-resolver.js';
import { randomSleep } from '../../browser/human-actions.js';
import { createChild } from '../../logger.js';

const APPLY_DELAY_MIN = 10_000;
const APPLY_DELAY_MAX = 20_000;

export type ApplyInput = NormalizedJob & { screenResult: ScreenResult };

export interface ApplyResult {
  success: boolean;
  encryptJobId: string;
  dryRun: boolean;
  greetResult?: GreetResult;
  error?: string;
  screenshotPath?: string;
}

export interface ApplyServiceOptions {
  apiClient: IBossAPIClient;
  securityIdResolver: SecurityIdResolver;
  storage: IJobStorage;
  config: Config;
  logger?: import('pino').Logger;
  sleepFn?: (min: number, max: number) => Promise<void>;
}

/**
 * 打招呼/投递服务。
 * Dry-run 模式只记录不调用 API；真实模式先解析 securityId 再 greetBoss，
 * 投递前后随机间隔，结果与截图回写 storage。
 */
export class ApplyService {
  private apiClient: IBossAPIClient;
  private securityIdResolver: SecurityIdResolver;
  private storage: IJobStorage;
  private config: Config;
  private logger: import('pino').Logger;
  private sleepFn: (min: number, max: number) => Promise<void>;

  constructor(options: ApplyServiceOptions) {
    this.apiClient = options.apiClient;
    this.securityIdResolver = options.securityIdResolver;
    this.storage = options.storage;
    this.config = options.config;
    this.logger = options.logger ?? createChild('apply');
    this.sleepFn = options.sleepFn ?? randomSleep;
  }

  async apply(job: ApplyInput): Promise<ApplyResult> {
    const { encryptJobId, screenResult } = job;

    if (this.config.DRY_RUN) {
      this.logger.info(
        { encryptJobId, jobName: job.jobName, brandName: job.brandName },
        'Dry-run 模式：跳过真实投递',
      );
      await this.storage.updateJobStatus(encryptJobId, 'applied', {
        jobName: job.jobName,
        brandName: job.brandName,
        screenResultJson: JSON.stringify(screenResult),
        appliedAt: Date.now(),
        skipReason: 'dry-run',
      });
      return {
        success: true,
        encryptJobId,
        dryRun: true,
      };
    }

    const securityId = await this.securityIdResolver.resolve(job);
    if (!securityId) {
      this.logger.warn({ encryptJobId }, 'securityId 解析失败，跳过投递');
      await this.storage.updateJobStatus(encryptJobId, 'failed', {
        jobName: job.jobName,
        brandName: job.brandName,
        failedReason: 'securityId 解析失败',
      });
      return {
        success: false,
        encryptJobId,
        dryRun: false,
        error: 'securityId 解析失败',
      };
    }

    await this.sleepFn(APPLY_DELAY_MIN, APPLY_DELAY_MAX);

    try {
      const greetResult = await this.apiClient.greetBoss(
        securityId,
        encryptJobId,
        screenResult.suggestedGreeting || undefined,
      );

      if (!greetResult.success) {
        this.logger.warn(
          { encryptJobId, code: greetResult.code, message: greetResult.message },
          '打招呼失败',
        );
        await this.storage.updateJobStatus(encryptJobId, 'failed', {
          jobName: job.jobName,
          brandName: job.brandName,
          failedReason: `greetBoss 返回失败: code=${greetResult.code} ${greetResult.message ?? ''}`.trim(),
        });
        return {
          success: false,
          encryptJobId,
          dryRun: false,
          greetResult,
          error: greetResult.message ?? `code=${greetResult.code}`,
        };
      }

      this.logger.info({ encryptJobId }, '投递成功');
      await this.storage.updateJobStatus(encryptJobId, 'applied', {
        jobName: job.jobName,
        brandName: job.brandName,
        screenResultJson: JSON.stringify(screenResult),
        appliedAt: Date.now(),
      });
      return {
        success: true,
        encryptJobId,
        dryRun: false,
        greetResult,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: message, encryptJobId }, '投递异常');
      await this.storage.updateJobStatus(encryptJobId, 'failed', {
        jobName: job.jobName,
        brandName: job.brandName,
        failedReason: message,
      });
      return {
        success: false,
        encryptJobId,
        dryRun: false,
        error: message,
      };
    } finally {
      await this.sleepFn(APPLY_DELAY_MIN, APPLY_DELAY_MAX);
    }
  }
}
