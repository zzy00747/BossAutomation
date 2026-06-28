import type {
  BlacklistEntry,
  DailyStats,
  JobRecord,
  ScreenResult,
} from '../types.js';

export interface IJobStorage {
  saveJob(job: JobRecord): Promise<void>;
  getJobById(encryptJobId: string): Promise<JobRecord | undefined>;
  hasJob(encryptJobId: string): Promise<boolean>;
  updateJobStatus(
    encryptJobId: string,
    status: JobRecord['status'],
    meta?: Partial<JobRecord>,
  ): Promise<void>;

  blacklistCompany(companyName: string, reason?: string): Promise<void>;
  isBlacklisted(companyName: string): Promise<boolean>;
  getBlacklist(): Promise<BlacklistEntry[]>;

  saveDailyStats(stats: DailyStats): Promise<void>;
  getDailyStats(date: string): Promise<DailyStats | undefined>;

  cacheLLMResult(encryptJobId: string, result: ScreenResult, ttlDays?: number): Promise<void>;
  getLLMCache(encryptJobId: string): Promise<ScreenResult | undefined>;

  /** 查询某天（按 createdAt 日期）创建或处理的职位记录，用于报告导出。 */
  getJobsByDate(date: string): Promise<JobRecord[]>;

  close?(): Promise<void>;
}
