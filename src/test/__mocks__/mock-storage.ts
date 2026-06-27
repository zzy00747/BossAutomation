import type { IJobStorage } from '../../interfaces/storage.js';
import type {
  BlacklistEntry,
  DailyStats,
  JobRecord,
  ScreenResult,
} from '../../types.js';

export class MockJobStorage implements IJobStorage {
  private jobs = new Map<string, JobRecord>();
  private blacklist = new Map<string, BlacklistEntry>();
  private dailyStats = new Map<string, DailyStats>();
  private llmCache = new Map<string, { result: ScreenResult; cachedAt: number }>();

  async saveJob(job: JobRecord): Promise<void> {
    this.jobs.set(job.encryptJobId, job);
  }

  async getJobById(encryptJobId: string): Promise<JobRecord | undefined> {
    return this.jobs.get(encryptJobId);
  }

  async hasJob(encryptJobId: string): Promise<boolean> {
    return this.jobs.has(encryptJobId);
  }

  async updateJobStatus(
    encryptJobId: string,
    status: JobRecord['status'],
    meta?: Partial<JobRecord>,
  ): Promise<void> {
    const existing = this.jobs.get(encryptJobId);
    const now = Date.now();
    if (existing) {
      this.jobs.set(encryptJobId, {
        ...existing,
        ...meta,
        status,
        updatedAt: now,
      });
    } else {
      this.jobs.set(encryptJobId, {
        encryptJobId,
        status,
        createdAt: now,
        updatedAt: now,
        jobName: meta?.jobName ?? '',
        brandName: meta?.brandName ?? '',
        ...meta,
      });
    }
  }

  async blacklistCompany(companyName: string, reason?: string): Promise<void> {
    this.blacklist.set(companyName, {
      companyName,
      reason,
      createdAt: Date.now(),
    });
  }

  async isBlacklisted(companyName: string): Promise<boolean> {
    return this.blacklist.has(companyName);
  }

  async getBlacklist(): Promise<BlacklistEntry[]> {
    return Array.from(this.blacklist.values());
  }

  async saveDailyStats(stats: DailyStats): Promise<void> {
    this.dailyStats.set(stats.date, stats);
  }

  async getDailyStats(date: string): Promise<DailyStats | undefined> {
    return this.dailyStats.get(date);
  }

  async cacheLLMResult(
    encryptJobId: string,
    result: ScreenResult,
    _ttlDays?: number,
  ): Promise<void> {
    this.llmCache.set(encryptJobId, { result, cachedAt: Date.now() });
  }

  async getLLMCache(encryptJobId: string): Promise<ScreenResult | undefined> {
    return this.llmCache.get(encryptJobId)?.result;
  }

  async close(): Promise<void> {}

  // Test helpers
  getJobs(): JobRecord[] {
    return Array.from(this.jobs.values());
  }

  getCachedResults(): Map<string, { result: ScreenResult; cachedAt: number }> {
    return this.llmCache;
  }
}
