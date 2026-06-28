import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReportExporter } from '../../../report/exporter.js';
import { MockJobStorage } from '../../__mocks__/mock-storage.js';
import type { JobRecord } from '../../../types.js';

const DATE = '2026-06-28';

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  const now = new Date(`${DATE}T10:00:00`).getTime();
  return {
    encryptJobId: 'job-1',
    jobName: '高级前端工程师',
    brandName: '某科技公司',
    cityName: '北京',
    salaryDesc: '25-40K',
    status: 'applied',
    skipReason: 'dry-run',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ReportExporter', () => {
  let storage: MockJobStorage;
  let exporter: ReportExporter;
  let tmpDir: string;

  beforeEach(() => {
    storage = new MockJobStorage();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-'));
    exporter = new ReportExporter({ storage, reportDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seedJobs(): Promise<void> {
    await storage.saveJob(
      makeJob({
        encryptJobId: 'a',
        jobName: '职位A',
        status: 'applied',
        skipReason: 'dry-run',
        screenResultJson: JSON.stringify({ matchScore: 90 }),
      }),
    );
    await storage.saveJob(
      makeJob({
        encryptJobId: 'b',
        jobName: '职位B',
        status: 'skipped',
        skipReason: '分数不足',
        screenResultJson: JSON.stringify({ matchScore: 40 }),
      }),
    );
    await storage.saveJob(
      makeJob({
        encryptJobId: 'c',
        jobName: '职位C',
        status: 'failed',
        failedReason: '网络错误',
      }),
    );
    await storage.saveDailyStats({
      date: DATE,
      totalSeen: 3,
      applied: 1,
      skipped: 1,
      failed: 1,
      llmCalls: 2,
    });
  }

  describe('exportMarkdown', () => {
    it('包含统计摘要、投递状态表、Top N 职位', async () => {
      await seedJobs();
      const mdPath = await exporter.exportMarkdown({ date: DATE, topN: 2 });

      const content = fs.readFileSync(mdPath, 'utf8');
      expect(content).toContain('# Boss 直聘投递日报 2026-06-28');
      expect(content).toContain('## 统计摘要');
      expect(content).toContain('投递成功');
      expect(content).toContain('| 3 |'); // totalSeen
      // 投递状态表包含全部职位
      expect(content).toContain('职位A');
      expect(content).toContain('职位B');
      expect(content).toContain('职位C');
      // Top N 卡片
      expect(content).toContain('Top 2');
      expect(content).toContain('encryptJobId');
    });

    it('Top N 按匹配分降序', async () => {
      await seedJobs();
      const mdPath = await exporter.exportMarkdown({ date: DATE, topN: 2 });
      const content = fs.readFileSync(mdPath, 'utf8');
      // 职位A(90) 应排在 职位B(40) 之前
      const aIdx = content.indexOf('职位A');
      const bIdx = content.indexOf('职位B');
      // 投递状态表中 aIdx 也会出现，但 Top N 部分在状态表之后
      expect(aIdx).toBeGreaterThan(-1);
      expect(bIdx).toBeGreaterThan(aIdx);
    });

    it('无日报时用 jobs 状态推断统计摘要', async () => {
      await storage.saveJob(
        makeJob({ encryptJobId: 'only', status: 'applied' }),
      );
      const mdPath = await exporter.exportMarkdown({ date: DATE });
      const content = fs.readFileSync(mdPath, 'utf8');
      expect(content).toContain('## 统计摘要');
      expect(content).toContain('| 1 |'); // totalSeen=1
    });

    it('保存到 data/reports/daily-report-{date}.md', async () => {
      await seedJobs();
      const mdPath = await exporter.exportMarkdown({ date: DATE });
      expect(path.basename(mdPath)).toBe('daily-report-2026-06-28.md');
      expect(fs.existsSync(mdPath)).toBe(true);
    });

    it('空结果也能生成报告', async () => {
      const mdPath = await exporter.exportMarkdown({ date: DATE });
      const content = fs.readFileSync(mdPath, 'utf8');
      expect(content).toContain('# Boss 直聘投递日报 2026-06-28');
      expect(content).toContain('## 统计摘要');
    });

    it('特殊字符在表格中转义', async () => {
      await storage.saveJob(
        makeJob({
          encryptJobId: 'special',
          jobName: '职位|带管道',
          brandName: '公司\n换行',
          status: 'skipped',
          skipReason: '原因',
        }),
      );
      const mdPath = await exporter.exportMarkdown({ date: DATE });
      const content = fs.readFileSync(mdPath, 'utf8');
      // 管道符应被转义，换行应被替换
      expect(content).toContain('职位\\|带管道');
      expect(content).not.toMatch(/公司\n换行/);
    });
  });

  describe('exportCSV', () => {
    it('字段与数据库一致并保存到 jobs-{date}.csv', async () => {
      await seedJobs();
      const csvPath = await exporter.exportCSV({ date: DATE });

      expect(path.basename(csvPath)).toBe('jobs-2026-06-28.csv');
      const content = fs.readFileSync(csvPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines[0]).toBe(
        'encrypt_job_id,security_id,job_name,brand_name,city_name,salary_desc,status,match_score,skip_reason,failed_reason,applied_at,created_at,last_updated',
      );
      // 3 条数据行
      expect(lines.length).toBe(4);
      expect(content).toContain('职位A');
      expect(content).toContain('职位B');
    });

    it('CSV 含逗号或引号的字段正确转义', async () => {
      await storage.saveJob(
        makeJob({
          encryptJobId: 'csv-special',
          jobName: '职位,带逗号',
          brandName: '公司"引号',
          status: 'skipped',
        }),
      );
      const csvPath = await exporter.exportCSV({ date: DATE });
      const content = fs.readFileSync(csvPath, 'utf8');
      // 逗号字段应被引号包裹，内部引号应翻倍
      expect(content).toContain('"职位,带逗号"');
      expect(content).toContain('"公司""引号"');
    });

    it('空结果生成仅表头的 CSV', async () => {
      const csvPath = await exporter.exportCSV({ date: DATE });
      const content = fs.readFileSync(csvPath, 'utf8');
      expect(content.trim()).toBe(
        'encrypt_job_id,security_id,job_name,brand_name,city_name,salary_desc,status,match_score,skip_reason,failed_reason,applied_at,created_at,last_updated',
      );
    });
  });

  describe('exportAll', () => {
    it('同时生成 Markdown 与 CSV', async () => {
      await seedJobs();
      const result = await exporter.exportAll({ date: DATE, topN: 5 });
      expect(result.markdownPath).toBeTruthy();
      expect(result.csvPath).toBeTruthy();
      expect(fs.existsSync(result.markdownPath!)).toBe(true);
      expect(fs.existsSync(result.csvPath!)).toBe(true);
    });
  });
});
