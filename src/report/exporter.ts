import fs from 'node:fs';
import path from 'node:path';
import type { IJobStorage } from '../interfaces/storage.js';
import type { JobRecord, ScreenResult } from '../types.js';
import { createChild } from '../logger.js';

export interface ReportExporterOptions {
  storage: IJobStorage;
  reportDir?: string;
  logger?: import('pino').Logger;
}

export interface ExportMarkdownOptions {
  date: string;
  topN?: number;
}

export interface ExportResult {
  markdownPath?: string;
  csvPath?: string;
}

const DEFAULT_REPORT_DIR = 'data/reports';

/**
 * 从 SQLite 查询生成 Markdown 与 CSV 报告，保存到 data/reports/。
 */
export class ReportExporter {
  private storage: IJobStorage;
  private reportDir: string;
  private logger: import('pino').Logger;

  constructor(options: ReportExporterOptions) {
    this.storage = options.storage;
    this.reportDir = options.reportDir ?? DEFAULT_REPORT_DIR;
    this.logger = options.logger ?? createChild('report');
  }

  async exportMarkdown(options: ExportMarkdownOptions): Promise<string> {
    const { date, topN = 20 } = options;
    const [stats, jobs] = await Promise.all([
      this.storage.getDailyStats(date),
      this.storage.getJobsByDate(date),
    ]);

    const summary = stats ?? {
      date,
      totalSeen: jobs.length,
      applied: jobs.filter((j) => j.status === 'applied').length,
      skipped: jobs.filter((j) => j.status === 'skipped').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      llmCalls: 0,
    };

    const topJobs = this.pickTopJobs(jobs, topN);
    const md = this.renderMarkdown(date, summary, jobs, topJobs);

    const filePath = path.join(this.reportDir, `daily-report-${date}.md`);
    await this.writeFile(filePath, md);
    this.logger.info({ filePath }, 'Markdown 报告已生成');
    return filePath;
  }

  async exportCSV(options: { date: string }): Promise<string> {
    const { date } = options;
    const jobs = await this.storage.getJobsByDate(date);
    const csv = this.renderCSV(jobs);

    const filePath = path.join(this.reportDir, `jobs-${date}.csv`);
    await this.writeFile(filePath, csv);
    this.logger.info({ filePath, count: jobs.length }, 'CSV 报告已生成');
    return filePath;
  }

  async exportAll(options: ExportMarkdownOptions): Promise<ExportResult> {
    const [markdownPath, csvPath] = await Promise.all([
      this.exportMarkdown(options),
      this.exportCSV({ date: options.date }),
    ]);
    return { markdownPath, csvPath };
  }

  private pickTopJobs(jobs: JobRecord[], topN: number): JobRecord[] {
    return [...jobs]
      .map((j) => ({ job: j, score: this.extractMatchScore(j) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map((x) => x.job);
  }

  private extractMatchScore(job: JobRecord): number {
    if (!job.screenResultJson) return 0;
    try {
      const parsed = JSON.parse(job.screenResultJson) as Partial<ScreenResult>;
      return typeof parsed.matchScore === 'number' ? parsed.matchScore : 0;
    } catch {
      return 0;
    }
  }

  private renderMarkdown(
    date: string,
    summary: {
      totalSeen: number;
      applied: number;
      skipped: number;
      failed: number;
      llmCalls: number;
    },
    jobs: JobRecord[],
    topJobs: JobRecord[],
  ): string {
    const lines: string[] = [];
    lines.push(`# Boss 直聘投递日报 ${date}`, '');
    lines.push('## 统计摘要', '');
    lines.push('| 指标 | 数值 |');
    lines.push('| --- | --- |');
    lines.push(`| 抓取职位数 | ${summary.totalSeen} |`);
    lines.push(`| 投递成功 | ${summary.applied} |`);
    lines.push(`| 跳过 | ${summary.skipped} |`);
    lines.push(`| 失败 | ${summary.failed} |`);
    lines.push(`| LLM 调用次数 | ${summary.llmCalls} |`);
    lines.push('', '## 投递状态表', '');
    lines.push('| encryptJobId | 职位 | 公司 | 城市 | 薪资 | 状态 | 跳过原因 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const j of jobs) {
      lines.push(
        `| ${j.encryptJobId} | ${this.escapeCell(j.jobName)} | ${this.escapeCell(j.brandName)} | ${this.escapeCell(j.cityName ?? '-')} | ${this.escapeCell(j.salaryDesc ?? '-')} | ${j.status} | ${this.escapeCell(j.skipReason ?? '-')} |`,
      );
    }
    lines.push('', `## Top ${topJobs.length} 职位详情`, '');
    for (const j of topJobs) {
      lines.push(...this.renderJobCard(j));
    }
    return lines.join('\n') + '\n';
  }

  private renderJobCard(job: JobRecord): string[] {
    const lines: string[] = [];
    const score = this.extractMatchScore(job);
    lines.push(`### ${this.escapeCell(job.jobName)} — ${this.escapeCell(job.brandName)}`, '');
    lines.push(`- encryptJobId: \`${job.encryptJobId}\``);
    lines.push(`- 城市: ${this.escapeCell(job.cityName ?? '-')}`);
    lines.push(`- 薪资: ${this.escapeCell(job.salaryDesc ?? '-')}`);
    lines.push(`- 匹配分: ${score}`);
    lines.push(`- 状态: ${job.status}`);
    if (job.skipReason) lines.push(`- 跳过原因: ${this.escapeCell(job.skipReason)}`);
    if (job.failedReason) lines.push(`- 失败原因: ${this.escapeCell(job.failedReason)}`);
    if (job.appliedAt) lines.push(`- 投递时间: ${new Date(job.appliedAt).toISOString()}`);
    lines.push('');
    return lines;
  }

  private renderCSV(jobs: JobRecord[]): string {
    const headers = [
      'encrypt_job_id',
      'security_id',
      'job_name',
      'brand_name',
      'city_name',
      'salary_desc',
      'status',
      'match_score',
      'skip_reason',
      'failed_reason',
      'applied_at',
      'created_at',
      'last_updated',
    ];
    const rows = jobs.map((j) =>
      [
        j.encryptJobId,
        j.securityId ?? '',
        j.jobName,
        j.brandName,
        j.cityName ?? '',
        j.salaryDesc ?? '',
        j.status,
        this.extractMatchScore(j),
        j.skipReason ?? '',
        j.failedReason ?? '',
        j.appliedAt ?? '',
        j.createdAt,
        j.updatedAt,
      ]
        .map((v) => this.csvCell(v))
        .join(','),
    );
    return [headers.join(','), ...rows].join('\n') + '\n';
  }

  private csvCell(value: string | number): string {
    const s = String(value);
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  private escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  private async writeFile(filePath: string, content: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf8');
  }
}
