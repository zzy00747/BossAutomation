import { describe, it, expect } from 'vitest';
import {
  normalizeJob,
  normalizeJobList,
  extractJobIdFromUrl,
} from '../../../platform/boss/normalize.js';
import type { RecommendJobItem } from '../../../types.js';

describe('extractJobIdFromUrl', () => {
  it('从标准详情页 URL 提取 ID', () => {
    expect(
      extractJobIdFromUrl('https://www.zhipin.com/job_detail/abc123.html'),
    ).toBe('abc123');
  });

  it('从相对路径提取 ID', () => {
    expect(extractJobIdFromUrl('/job_detail/xyz-456.html')).toBe('xyz-456');
  });

  it('从带查询参数的 URL 提取 encryptJobId', () => {
    expect(
      extractJobIdFromUrl('https://www.zhipin.com/job_detail/?encryptJobId=q1'),
    ).toBe('q1');
  });

  it('空值或无效返回 null', () => {
    expect(extractJobIdFromUrl(undefined)).toBeNull();
    expect(extractJobIdFromUrl('')).toBeNull();
    expect(extractJobIdFromUrl('not-a-url')).toBeNull();
  });
});

describe('normalizeJob', () => {
  it('使用 encryptJobId 作为主键', () => {
    const job = normalizeJob({
      encryptJobId: 'job-1',
      jobName: '前端',
      brandName: 'A公司',
      salaryDesc: '20-30K',
    });
    expect(job).not.toBeNull();
    expect(job!.encryptJobId).toBe('job-1');
    expect(job!.jobName).toBe('前端');
    expect(job!.salaryDesc).toBe('20-30K');
  });

  it('主键 fallback: encryptJobId > jobId > encryptId > id', () => {
    expect(normalizeJob({ jobId: 'j', jobName: 'x', brandName: 'b' })!.encryptJobId).toBe('j');
    expect(normalizeJob({ encryptId: 'e', jobName: 'x', brandName: 'b' })!.encryptJobId).toBe('e');
    expect(normalizeJob({ id: 'i', jobName: 'x', brandName: 'b' })!.encryptJobId).toBe('i');
  });

  it('主键从 URL 提取作为最后 fallback', () => {
    const job = normalizeJob({
      jobDetailUrl: 'https://www.zhipin.com/job_detail/url-id.html',
      jobName: 'x',
      brandName: 'b',
    });
    expect(job!.encryptJobId).toBe('url-id');
  });

  it('缺少主键返回 null', () => {
    expect(normalizeJob({ jobName: 'x', brandName: 'b' })).toBeNull();
    expect(normalizeJob({})).toBeNull();
    expect(normalizeJob(null as unknown as RecommendJobItem)).toBeNull();
  });

  it('securityId fallback: securityId > encryptSecurityId > secId', () => {
    expect(
      normalizeJob({ id: '1', secId: 's1', jobName: 'x', brandName: 'b' })!.securityId,
    ).toBe('s1');
    expect(
      normalizeJob({
        id: '1',
        encryptSecurityId: 's2',
        jobName: 'x',
        brandName: 'b',
      })!.securityId,
    ).toBe('s2');
    expect(
      normalizeJob({ id: '1', securityId: 's3', jobName: 'x', brandName: 'b' })!.securityId,
    ).toBe('s3');
  });

  it('lid fallback: lid > lId > listId', () => {
    expect(normalizeJob({ id: '1', listId: 'l1', jobName: 'x', brandName: 'b' })!.lid).toBe('l1');
    expect(normalizeJob({ id: '1', lId: 'l2', jobName: 'x', brandName: 'b' })!.lid).toBe('l2');
  });

  it('encryptBossId fallback: encryptBossId > bossId', () => {
    expect(
      normalizeJob({ id: '1', bossId: 'b1', jobName: 'x', brandName: 'b' })!.encryptBossId,
    ).toBe('b1');
  });

  it('jobName fallback: jobName > title > name，缺失时为未知职位', () => {
    expect(normalizeJob({ id: '1', title: '岗位', brandName: 'b' })!.jobName).toBe('岗位');
    expect(normalizeJob({ id: '1', name: '名称', brandName: 'b' })!.jobName).toBe('名称');
    expect(normalizeJob({ id: '1', brandName: 'b' })!.jobName).toBe('未知职位');
  });

  it('skills 数组被规范化为字符串数组', () => {
    const job = normalizeJob({
      id: '1',
      jobName: 'x',
      brandName: 'b',
      skills: ['React', 123, ''],
    });
    expect(job!.skills).toEqual(['React', '123']);
  });

  it('仅写入存在的可选字段，避免 undefined 污染', () => {
    const job = normalizeJob({ id: '1', jobName: 'x', brandName: 'b' })!;
    expect(job).not.toHaveProperty('securityId');
    expect(job).not.toHaveProperty('skills');
    expect(job).not.toHaveProperty('cityName');
  });

  it('保留 detailUrl / jobDetailUrl', () => {
    const job = normalizeJob({
      id: '1',
      jobName: 'x',
      brandName: 'b',
      jobDetailUrl: 'https://www.zhipin.com/job_detail/1.html',
    })!;
    expect(job.jobDetailUrl).toBe('https://www.zhipin.com/job_detail/1.html');
  });
});

describe('normalizeJobList', () => {
  it('过滤掉主键缺失项', () => {
    const list = normalizeJobList([
      { encryptJobId: 'a', jobName: 'x', brandName: 'b' },
      { jobName: '无主键', brandName: 'b' },
      { jobId: 'c', jobName: 'y', brandName: 'b' },
    ]);
    expect(list).toHaveLength(2);
    expect(list.map((j) => j.encryptJobId)).toEqual(['a', 'c']);
  });

  it('非数组输入返回空数组', () => {
    expect(normalizeJobList([])).toEqual([]);
  });
});
