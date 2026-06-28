import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { IJobStorage } from '../interfaces/storage.js';
import type {
  BlacklistEntry,
  DailyStats,
  JobRecord,
  JobStatus,
  ScreenResult,
} from '../types.js';
import { SQLiteWriteQueue } from './write-queue.js';
import { createChild } from '../logger.js';

const JOB_COLUMNS = [
  'encrypt_job_id',
  'security_id',
  'encrypt_boss_id',
  'lid',
  'job_name',
  'brand_name',
  'city_name',
  'salary_desc',
  'status',
  'screen_result_json',
  'api_detail_json',
  'html_detail_json',
  'llm_cached_at',
  'detail_cached_at',
  'applied_at',
  'failed_reason',
  'skip_reason',
  'screenshot_path',
  'created_at',
  'last_updated',
] as const;

export interface JobStorageOptions {
  dbPath: string;
  writeQueue?: SQLiteWriteQueue;
  logger?: import('pino').Logger;
}

/**
 * SQLite 持久化存储，实现 IJobStorage。
 * WAL 模式 + busy_timeout；写操作经 SQLiteWriteQueue 串行化；批量写入用事务。
 */
export class JobStorage implements IJobStorage {
  private db: DatabaseType;
  private writeQueue: SQLiteWriteQueue;
  private logger: import('pino').Logger;

  constructor(options: JobStorageOptions | string) {
    const opts = typeof options === 'string' ? { dbPath: options } : options;
    this.db = new Database(opts.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.writeQueue = opts.writeQueue ?? new SQLiteWriteQueue();
    this.logger = opts.logger ?? createChild('storage');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        encrypt_job_id TEXT PRIMARY KEY,
        security_id TEXT,
        encrypt_boss_id TEXT,
        lid TEXT,
        job_name TEXT,
        brand_name TEXT,
        city_name TEXT,
        salary_desc TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        screen_result_json TEXT,
        api_detail_json TEXT,
        html_detail_json TEXT,
        llm_cached_at INTEGER,
        detail_cached_at INTEGER,
        applied_at INTEGER,
        failed_reason TEXT,
        skip_reason TEXT,
        screenshot_path TEXT,
        created_at INTEGER NOT NULL,
        last_updated INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS blacklist (
        brand_name TEXT PRIMARY KEY,
        reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        total_seen INTEGER NOT NULL DEFAULT 0,
        applied INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        llm_calls INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_last_updated ON jobs(last_updated);
    `);
  }

  async saveJob(job: JobRecord): Promise<void> {
    await this.writeQueue.enqueue(() => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO jobs (${JOB_COLUMNS.join(', ')})
        VALUES (${JOB_COLUMNS.map(() => '?').join(', ')})
      `);
      stmt.run(
        job.encryptJobId,
        job.securityId ?? null,
        job.encryptBossId ?? null,
        job.lid ?? null,
        job.jobName,
        job.brandName,
        job.cityName ?? null,
        job.salaryDesc ?? null,
        job.status,
        job.screenResultJson ?? null,
        job.apiDetailJson ?? null,
        job.htmlDetailJson ?? null,
        job.llmCachedAt ?? null,
        job.detailCachedAt ?? null,
        job.appliedAt ?? null,
        job.failedReason ?? null,
        job.skipReason ?? null,
        job.screenshotPath ?? null,
        job.createdAt,
        job.updatedAt,
      );
    });
  }

  async getJobById(encryptJobId: string): Promise<JobRecord | undefined> {
    const row = this.db
      .prepare('SELECT * FROM jobs WHERE encrypt_job_id = ?')
      .get(encryptJobId) as JobRow | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  async hasJob(encryptJobId: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 FROM jobs WHERE encrypt_job_id = ?')
      .get(encryptJobId);
    return row !== undefined;
  }

  async updateJobStatus(
    encryptJobId: string,
    status: JobStatus,
    meta?: Partial<JobRecord>,
  ): Promise<void> {
    await this.writeQueue.enqueue(() => {
      const existing = this.db
        .prepare('SELECT * FROM jobs WHERE encrypt_job_id = ?')
        .get(encryptJobId) as JobRow | undefined;
      const now = Date.now();

      if (existing) {
        const merged: JobRow = {
          ...existing,
          status,
          last_updated: now,
          applied_at: status === 'applied' ? now : existing.applied_at,
          ...this.metaToRow(meta),
        };
        this.updateRow(merged);
      } else {
        const row: JobRow = {
          encrypt_job_id: encryptJobId,
          security_id: meta?.securityId ?? null,
          encrypt_boss_id: meta?.encryptBossId ?? null,
          lid: meta?.lid ?? null,
          job_name: meta?.jobName ?? '',
          brand_name: meta?.brandName ?? '',
          city_name: meta?.cityName ?? null,
          salary_desc: meta?.salaryDesc ?? null,
          status,
          screen_result_json: meta?.screenResultJson ?? null,
          api_detail_json: meta?.apiDetailJson ?? null,
          html_detail_json: meta?.htmlDetailJson ?? null,
          llm_cached_at: meta?.llmCachedAt ?? null,
          detail_cached_at: meta?.detailCachedAt ?? null,
          applied_at: status === 'applied' ? now : null,
          failed_reason: meta?.failedReason ?? null,
          skip_reason: meta?.skipReason ?? null,
          screenshot_path: meta?.screenshotPath ?? null,
          created_at: now,
          last_updated: now,
          ...this.metaToRow(meta),
        };
        this.insertRow(row);
      }
    });
  }

  async blacklistCompany(companyName: string, reason?: string): Promise<void> {
    await this.writeQueue.enqueue(() => {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO blacklist (brand_name, reason, created_at) VALUES (?, ?, ?)',
        )
        .run(companyName, reason ?? null, Date.now());
    });
  }

  async isBlacklisted(companyName: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 FROM blacklist WHERE brand_name = ?')
      .get(companyName);
    return row !== undefined;
  }

  async getBlacklist(): Promise<BlacklistEntry[]> {
    const rows = this.db
      .prepare('SELECT brand_name, reason, created_at FROM blacklist ORDER BY created_at')
      .all() as Array<{ brand_name: string; reason: string | null; created_at: number }>;
    return rows.map((r) => ({
      companyName: r.brand_name,
      reason: r.reason ?? undefined,
      createdAt: r.created_at,
    }));
  }

  async saveDailyStats(stats: DailyStats): Promise<void> {
    await this.writeQueue.enqueue(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO daily_stats
           (date, total_seen, applied, skipped, failed, llm_calls)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(stats.date, stats.totalSeen, stats.applied, stats.skipped, stats.failed, stats.llmCalls);
    });
  }

  async getDailyStats(date: string): Promise<DailyStats | undefined> {
    const row = this.db
      .prepare('SELECT * FROM daily_stats WHERE date = ?')
      .get(date) as DailyStatsRow | undefined;
    if (!row) return undefined;
    return {
      date: row.date,
      totalSeen: row.total_seen,
      applied: row.applied,
      skipped: row.skipped,
      failed: row.failed,
      llmCalls: row.llm_calls,
    };
  }

  async cacheLLMResult(encryptJobId: string, result: ScreenResult, _ttlDays?: number): Promise<void> {
    // 存缓存时间戳；TTL 由 screener 通过 llmCachedAt 与 cacheTtlMs 比对判定（与 MockJobStorage 一致）。
    const cachedAt = Date.now();
    await this.writeQueue.enqueue(() => {
      this.db
        .prepare(
          `UPDATE jobs
           SET screen_result_json = ?, llm_cached_at = ?, last_updated = ?
           WHERE encrypt_job_id = ?`,
        )
        .run(JSON.stringify(result), cachedAt, cachedAt, encryptJobId);
    });
  }

  async getLLMCache(encryptJobId: string): Promise<ScreenResult | undefined> {
    const row = this.db
      .prepare('SELECT screen_result_json, llm_cached_at FROM jobs WHERE encrypt_job_id = ?')
      .get(encryptJobId) as
      | { screen_result_json: string | null; llm_cached_at: number | null }
      | undefined;
    if (!row?.screen_result_json) return undefined;
    try {
      return JSON.parse(row.screen_result_json) as ScreenResult;
    } catch {
      this.logger.warn({ encryptJobId }, '解析缓存 ScreenResult 失败');
      return undefined;
    }
  }

  async close(): Promise<void> {
    await this.writeQueue.drain();
    this.writeQueue.close();
    this.db.close();
  }

  private updateRow(row: JobRow): void {
    const sets = JOB_COLUMNS.map((c) => `${c} = @${c}`).join(', ');
    this.db.prepare(`UPDATE jobs SET ${sets} WHERE encrypt_job_id = @encrypt_job_id`).run(row);
  }

  private insertRow(row: JobRow): void {
    const cols = JOB_COLUMNS.join(', ');
    const placeholders = JOB_COLUMNS.map((c) => `@${c}`).join(', ');
    this.db.prepare(`INSERT INTO jobs (${cols}) VALUES (${placeholders})`).run(row);
  }

  private metaToRow(meta?: Partial<JobRecord>): Partial<JobRow> {
    if (!meta) return {};
    const row: Partial<JobRow> = {};
    if (meta.securityId !== undefined) row.security_id = meta.securityId;
    if (meta.encryptBossId !== undefined) row.encrypt_boss_id = meta.encryptBossId;
    if (meta.lid !== undefined) row.lid = meta.lid;
    if (meta.jobName !== undefined) row.job_name = meta.jobName;
    if (meta.brandName !== undefined) row.brand_name = meta.brandName;
    if (meta.cityName !== undefined) row.city_name = meta.cityName;
    if (meta.salaryDesc !== undefined) row.salary_desc = meta.salaryDesc;
    if (meta.screenResultJson !== undefined) row.screen_result_json = meta.screenResultJson;
    if (meta.apiDetailJson !== undefined) row.api_detail_json = meta.apiDetailJson;
    if (meta.htmlDetailJson !== undefined) row.html_detail_json = meta.htmlDetailJson;
    if (meta.llmCachedAt !== undefined) row.llm_cached_at = meta.llmCachedAt;
    if (meta.detailCachedAt !== undefined) row.detail_cached_at = meta.detailCachedAt;
    if (meta.appliedAt !== undefined) row.applied_at = meta.appliedAt;
    if (meta.failedReason !== undefined) row.failed_reason = meta.failedReason;
    if (meta.skipReason !== undefined) row.skip_reason = meta.skipReason;
    if (meta.screenshotPath !== undefined) row.screenshot_path = meta.screenshotPath;
    return row;
  }

  private rowToRecord(row: JobRow): JobRecord {
    return {
      encryptJobId: row.encrypt_job_id,
      securityId: row.security_id ?? undefined,
      encryptBossId: row.encrypt_boss_id ?? undefined,
      lid: row.lid ?? undefined,
      jobName: row.job_name,
      brandName: row.brand_name,
      cityName: row.city_name ?? undefined,
      salaryDesc: row.salary_desc ?? undefined,
      status: row.status as JobStatus,
      screenResultJson: row.screen_result_json ?? undefined,
      apiDetailJson: row.api_detail_json ?? undefined,
      htmlDetailJson: row.html_detail_json ?? undefined,
      llmCachedAt: row.llm_cached_at ?? undefined,
      detailCachedAt: row.detail_cached_at ?? undefined,
      appliedAt: row.applied_at ?? undefined,
      failedReason: row.failed_reason ?? undefined,
      skipReason: row.skip_reason ?? undefined,
      screenshotPath: row.screenshot_path ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.last_updated,
    };
  }
}

interface JobRow {
  encrypt_job_id: string;
  security_id: string | null;
  encrypt_boss_id: string | null;
  lid: string | null;
  job_name: string;
  brand_name: string;
  city_name: string | null;
  salary_desc: string | null;
  status: string;
  screen_result_json: string | null;
  api_detail_json: string | null;
  html_detail_json: string | null;
  llm_cached_at: number | null;
  detail_cached_at: number | null;
  applied_at: number | null;
  failed_reason: string | null;
  skip_reason: string | null;
  screenshot_path: string | null;
  created_at: number;
  last_updated: number;
}

interface DailyStatsRow {
  date: string;
  total_seen: number;
  applied: number;
  skipped: number;
  failed: number;
  llm_calls: number;
}
