import type { ILLMClient } from '../interfaces/llm.js';
import type { IJobStorage } from '../interfaces/storage.js';
import type { Config } from '../config.js';
import type { JobDetail, ScreenResult } from '../types.js';
import { buildJDScreenPrompt } from './prompts/jd-screen.js';
import { parseScreenResult } from './schema.js';
import { loadJobIntent } from '../intent/job-intent.js';
import { createChild } from '../logger.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ScreenOutcome {
  result: ScreenResult;
  isShortlisted: boolean;
  fromCache: boolean;
  usedFallback: boolean;
}

export interface JobScreenerOptions {
  llmClient: ILLMClient;
  storage: IJobStorage;
  config: Config;
  jobIntent?: string;
  cacheTtlDays?: number;
  logger?: import('pino').Logger;
}

export class JobScreener {
  private llmClient: ILLMClient;
  private storage: IJobStorage;
  private config: Config;
  private jobIntent: string;
  private cacheTtlMs: number;
  private logger: import('pino').Logger;

  constructor(options: JobScreenerOptions) {
    this.llmClient = options.llmClient;
    this.storage = options.storage;
    this.config = options.config;
    this.jobIntent = options.jobIntent ?? loadJobIntent();
    this.cacheTtlMs = (options.cacheTtlDays ?? 7) * MS_PER_DAY;
    this.logger = options.logger ?? createChild('screener');
  }

  async screen(jobDetail: JobDetail, encryptJobId?: string): Promise<ScreenOutcome> {
    const jobId = encryptJobId ?? jobDetail.encryptJobId;

    const cached = await this.loadCached(jobId);
    if (cached) {
      this.logger.debug({ encryptJobId: jobId }, 'LLM 筛选结果缓存命中');
      return {
        result: cached,
        isShortlisted: this.passesThreshold(cached),
        fromCache: true,
        usedFallback: false,
      };
    }

    let result: ScreenResult;
    let usedFallback = false;

    try {
      const prompt = buildJDScreenPrompt(this.jobIntent, jobDetail);
      const response = await this.llmClient.chat(
        [{ role: 'user', content: prompt }],
        { jsonMode: true, temperature: 0.2 },
      );
      result = parseScreenResult(response.content);
    } catch (error) {
      this.logger.warn(
        { err: String(error), encryptJobId: jobId },
        'LLM 筛选失败，降级到关键词 fallback',
      );
      result = this.keywordFallback(jobDetail);
      usedFallback = true;
    }

    await this.saveCache(jobId, result);

    return {
      result,
      isShortlisted: this.passesThreshold(result),
      fromCache: false,
      usedFallback,
    };
  }

  private passesThreshold(result: ScreenResult): boolean {
    return result.matchScore >= this.config.MATCH_SCORE_THRESHOLD && result.redFlags.length === 0;
  }

  private async loadCached(encryptJobId: string): Promise<ScreenResult | undefined> {
    const record = await this.storage.getJobById(encryptJobId);
    if (record?.llmCachedAt && Date.now() - record.llmCachedAt > this.cacheTtlMs) {
      return undefined;
    }
    return this.storage.getLLMCache(encryptJobId);
  }

  private async saveCache(encryptJobId: string, result: ScreenResult): Promise<void> {
    await this.storage.cacheLLMResult(encryptJobId, result, 7);
    await this.storage.updateJobStatus(encryptJobId, 'screened', {
      llmCachedAt: Date.now(),
    });
  }

  private keywordFallback(jobDetail: JobDetail): ScreenResult {
    const keywords = this.extractKeywords(this.jobIntent);
    const jdText = this.buildJdText(jobDetail).toLowerCase();

    const matched = keywords.filter((kw) => jdText.includes(kw.toLowerCase()));
    const skillsMatch = keywords.length === 0 ? 0 : Math.round((matched.length / keywords.length) * 100);
    const matchScore = Math.min(skillsMatch, 100);

    const redFlags: string[] = [];
    if (matchScore < this.config.MATCH_SCORE_THRESHOLD) {
      redFlags.push('关键词匹配度低于阈值');
    }

    const salaryMatch = this.checkSalaryMatch(jobDetail);
    if (!salaryMatch) redFlags.push('薪资未明确或不在预期');

    return {
      matchScore,
      salaryMatch,
      locationMatch: false,
      skillsMatch,
      redFlags,
      reason: 'LLM 不可用，基于关键词匹配的初步筛选结果。',
      suggestedGreeting: '',
    };
  }

  private extractKeywords(intent: string): string[] {
    return intent
      .split(/[，,。；;\n\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
  }

  private buildJdText(jobDetail: JobDetail): string {
    return [
      jobDetail.jobName,
      jobDetail.brandName,
      jobDetail.postDescription,
      jobDetail.companyDescription,
      jobDetail.skills?.join(' ') ?? '',
      jobDetail.salary ?? '',
      jobDetail.location ?? '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  private checkSalaryMatch(jobDetail: JobDetail): boolean {
    if (!jobDetail.salary) return false;
    return /[0-9]/.test(jobDetail.salary);
  }
}
