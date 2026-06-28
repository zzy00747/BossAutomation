import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JobStorage } from '../../../storage/store.js';
import type { JobRecord, ScreenResult } from '../../../types.js';

const sampleResult: ScreenResult = {
  matchScore: 85,
  salaryMatch: true,
  locationMatch: true,
  skillsMatch: 80,
  redFlags: [],
  reason: '匹配度高',
  suggestedGreeting: '您好',
};

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  const now = Date.now();
  return {
    encryptJobId: 'job-1',
    jobName: '前端工程师',
    brandName: '某科技公司',
    status: 'new',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function toLocalDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('SQLiteWriteQueue', () => {
  // JobStorage 内部即用 SQLiteWriteQueue，下面并发测试间接覆盖队列。

  it('enqueue 返回 fn 的结果', async () => {
    const storage = new JobStorage(':memory:');
    await storage.saveJob(makeJob());
    expect(await storage.hasJob('job-1')).toBe(true);
    await storage.close();
  });

  it('drain 等待队列清空', async () => {
    const storage = new JobStorage(':memory:');
    let done = 0;
    for (let i = 0; i < 50; i++) {
      void storage.saveJob(makeJob({ encryptJobId: `job-${i}` })).then(() => {
        done++;
      });
    }
    await storage['writeQueue'].drain();
    expect(done).toBe(50);
    await storage.close();
  });

  it('close 后 enqueue 拒绝', async () => {
    const storage = new JobStorage(':memory:');
    storage['writeQueue'].close();
    await expect(storage.saveJob(makeJob())).rejects.toThrow('写入队列已关闭');
    await storage.close();
  });
});

describe('JobStorage', () => {
  let storage: JobStorage;

  beforeEach(() => {
    storage = new JobStorage(':memory:');
  });

  afterEach(async () => {
    await storage.close();
  });

  describe('jobs CRUD', () => {
    it('saveJob + getJobById 往返', async () => {
      const job = makeJob({
        encryptJobId: 'a1',
        securityId: 'sec-a1',
        jobName: '高级前端',
        brandName: 'Boss',
        cityName: '北京',
        salaryDesc: '25-40K',
        status: 'screened',
        screenResultJson: JSON.stringify(sampleResult),
      });
      await storage.saveJob(job);
      const got = await storage.getJobById('a1');
      expect(got).toMatchObject({
        encryptJobId: 'a1',
        securityId: 'sec-a1',
        jobName: '高级前端',
        brandName: 'Boss',
        cityName: '北京',
        salaryDesc: '25-40K',
        status: 'screened',
      });
      expect(got?.screenResultJson).toContain('"matchScore":85');
    });

    it('getJobById 不存在返回 undefined', async () => {
      expect(await storage.getJobById('nope')).toBeUndefined();
    });

    it('hasJob', async () => {
      expect(await storage.hasJob('x')).toBe(false);
      await storage.saveJob(makeJob({ encryptJobId: 'x' }));
      expect(await storage.hasJob('x')).toBe(true);
    });

    it('saveJob 同主键 REPLACE 覆盖', async () => {
      await storage.saveJob(makeJob({ encryptJobId: 'k', jobName: '旧' }));
      await storage.saveJob(makeJob({ encryptJobId: 'k', jobName: '新' }));
      const got = await storage.getJobById('k');
      expect(got?.jobName).toBe('新');
    });

    it('updateJobStatus 更新已存在记录', async () => {
      await storage.saveJob(makeJob({ encryptJobId: 'u', status: 'new' }));
      await storage.updateJobStatus('u', 'applied', { skipReason: 'dry-run' });
      const got = await storage.getJobById('u');
      expect(got?.status).toBe('applied');
      expect(got?.skipReason).toBe('dry-run');
      expect(got?.appliedAt).toBeTypeOf('number');
    });

    it('updateJobStatus 对不存在记录插入', async () => {
      await storage.updateJobStatus('fresh', 'screened', {
        jobName: '新职位',
        brandName: '公司',
      });
      const got = await storage.getJobById('fresh');
      expect(got?.status).toBe('screened');
      expect(got?.jobName).toBe('新职位');
    });

    it('updateJobStatus applied 自动设置 appliedAt', async () => {
      await storage.saveJob(makeJob({ encryptJobId: 'ap', status: 'new' }));
      await storage.updateJobStatus('ap', 'applied');
      const got = await storage.getJobById('ap');
      expect(got?.appliedAt).toBeTypeOf('number');
    });
  });

  describe('blacklist', () => {
    it('blacklistCompany + isBlacklisted', async () => {
      expect(await storage.isBlacklisted('黑公司')).toBe(false);
      await storage.blacklistCompany('黑公司', '风控');
      expect(await storage.isBlacklisted('黑公司')).toBe(true);
    });

    it('getBlacklist 返回全部', async () => {
      await storage.blacklistCompany('A', '理由A');
      await storage.blacklistCompany('B');
      const list = await storage.getBlacklist();
      expect(list).toHaveLength(2);
      const a = list.find((b) => b.companyName === 'A');
      expect(a?.reason).toBe('理由A');
      const b = list.find((b) => b.companyName === 'B');
      expect(b?.reason).toBeUndefined();
    });

    it('blacklistCompany 重复覆盖', async () => {
      await storage.blacklistCompany('C', '旧');
      await storage.blacklistCompany('C', '新');
      const list = await storage.getBlacklist();
      expect(list.filter((b) => b.companyName === 'C')).toHaveLength(1);
      expect(list.find((b) => b.companyName === 'C')?.reason).toBe('新');
    });
  });

  describe('daily_stats', () => {
    it('saveDailyStats + getDailyStats', async () => {
      await storage.saveDailyStats({
        date: '2026-06-28',
        totalSeen: 10,
        applied: 5,
        skipped: 3,
        failed: 2,
        llmCalls: 8,
      });
      const got = await storage.getDailyStats('2026-06-28');
      expect(got).toEqual({
        date: '2026-06-28',
        totalSeen: 10,
        applied: 5,
        skipped: 3,
        failed: 2,
        llmCalls: 8,
      });
    });

    it('getDailyStats 不存在返回 undefined', async () => {
      expect(await storage.getDailyStats('1999-01-01')).toBeUndefined();
    });

    it('saveDailyStats 同日期覆盖', async () => {
      await storage.saveDailyStats({
        date: '2026-06-28',
        totalSeen: 1,
        applied: 1,
        skipped: 0,
        failed: 0,
        llmCalls: 1,
      });
      await storage.saveDailyStats({
        date: '2026-06-28',
        totalSeen: 5,
        applied: 5,
        skipped: 0,
        failed: 0,
        llmCalls: 5,
      });
      const got = await storage.getDailyStats('2026-06-28');
      expect(got?.applied).toBe(5);
    });
  });

  describe('LLM 缓存', () => {
    it('cacheLLMResult 仅更新已存在职位', async () => {
      await storage.saveJob(makeJob({ encryptJobId: 'c1' }));
      await storage.cacheLLMResult('c1', sampleResult, 7);
      const got = await storage.getJobById('c1');
      expect(got?.llmCachedAt).toBeTypeOf('number');
      expect(got?.screenResultJson).toContain('"matchScore":85');
    });

    it('getLLMCache 返回缓存结果', async () => {
      await storage.saveJob(makeJob({ encryptJobId: 'c2' }));
      await storage.cacheLLMResult('c2', sampleResult);
      const cached = await storage.getLLMCache('c2');
      expect(cached?.matchScore).toBe(85);
      expect(cached?.redFlags).toEqual([]);
    });

    it('getLLMCache 不存在返回 undefined', async () => {
      expect(await storage.getLLMCache('missing')).toBeUndefined();
    });

    it('getLLMCache 损坏 JSON 返回 undefined', async () => {
      await storage.saveJob(
        makeJob({
          encryptJobId: 'bad',
          screenResultJson: '{not valid json',
          llmCachedAt: Date.now(),
        }),
      );
      expect(await storage.getLLMCache('bad')).toBeUndefined();
    });
  });

  describe('getJobsByDate', () => {
    it('返回当天创建的职位', async () => {
      const now = Date.now();
      await storage.saveJob(makeJob({ encryptJobId: 'today-1', createdAt: now }));
      await storage.saveJob(makeJob({ encryptJobId: 'today-2', createdAt: now + 1 }));
      // 昨天的职位
      const yesterdayMs = now - 25 * 60 * 60 * 1000;
      await storage.saveJob(makeJob({ encryptJobId: 'yesterday', createdAt: yesterdayMs }));

      const todayKey = toLocalDateKey(now);
      const jobs = await storage.getJobsByDate(todayKey);
      const ids = jobs.map((j) => j.encryptJobId);
      expect(ids).toContain('today-1');
      expect(ids).toContain('today-2');
      expect(ids).not.toContain('yesterday');
    });

    it('无匹配返回空数组', async () => {
      const jobs = await storage.getJobsByDate('1999-01-01');
      expect(jobs).toEqual([]);
    });
  });

  describe('并发写入', () => {
    it('100 个并发 saveJob 全部落盘', async () => {
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          storage.saveJob(
            makeJob({
              encryptJobId: `concurrent-${i}`,
              jobName: `职位${i}`,
            }),
          ),
        );
      }
      await Promise.all(promises);
      for (let i = 0; i < 100; i++) {
        expect(await storage.hasJob(`concurrent-${i}`)).toBe(true);
      }
    });

    it('并发 updateJobStatus 与 saveJob 不产生 SQLITE_BUSY', async () => {
      await storage.saveJob(makeJob({ encryptJobId: 'mix', status: 'new' }));
      const tasks: Promise<unknown>[] = [
        storage.updateJobStatus('mix', 'screened', { skipReason: 'r1' }),
        storage.updateJobStatus('mix', 'applied', { skipReason: 'r2' }),
        storage.saveJob(makeJob({ encryptJobId: 'mix', status: 'applied' })),
        storage.updateJobStatus('mix', 'failed', { failedReason: 'err' }),
      ];
      await Promise.all(tasks);
      const got = await storage.getJobById('mix');
      expect(got?.encryptJobId).toBe('mix');
      expect(['screened', 'applied', 'failed']).toContain(got?.status);
    });
  });

  describe('close', () => {
    it('close 排空队列并关闭数据库', async () => {
      const s = new JobStorage(':memory:');
      await s.saveJob(makeJob({ encryptJobId: 'close-1' }));
      await s.close();
      // 关闭后再次操作应抛错
      await expect(s.saveJob(makeJob({ encryptJobId: 'close-2' }))).rejects.toThrow();
    });
  });
});
