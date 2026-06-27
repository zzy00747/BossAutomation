import { describe, it, expect } from 'vitest';
import { detectJobIdFields, detectCommonFields } from '../../../platform/boss/field-detector.js';
import type { RecommendJobItem } from '../../../types.js';

describe('detectJobIdFields', () => {
  it('识别标准字段名', () => {
    const mapping = detectJobIdFields({
      encryptJobId: 'a',
      securityId: 's',
      encryptBossId: 'b',
      lid: 'l',
      jobName: '前端',
      brandName: '公司',
    });
    expect(mapping.encryptJobId).toBe('encryptJobId');
    expect(mapping.securityId).toBe('securityId');
    expect(mapping.encryptBossId).toBe('encryptBossId');
    expect(mapping.lid).toBe('lid');
    expect(mapping.jobName).toBe('jobName');
  });

  it('识别别名', () => {
    const mapping = detectJobIdFields({
      jobId: 'a',
      secId: 's',
      bossId: 'b',
      listId: 'l',
      title: '前端',
    } as RecommendJobItem);
    expect(mapping.encryptJobId).toBe('jobId');
    expect(mapping.securityId).toBe('secId');
    expect(mapping.encryptBossId).toBe('bossId');
    expect(mapping.lid).toBe('listId');
    expect(mapping.jobName).toBe('title');
  });

  it('未命中字段返回 null', () => {
    const mapping = detectJobIdFields({ brandName: '公司' } as RecommendJobItem);
    expect(mapping.encryptJobId).toBeNull();
    expect(mapping.securityId).toBeNull();
  });

  it('detectedFields 排除空值字段', () => {
    const mapping = detectJobIdFields({
      encryptJobId: 'a',
      jobName: '',
      brandName: null,
      skills: [],
    } as unknown as RecommendJobItem);
    expect(mapping.detectedFields).toContain('encryptJobId');
    expect(mapping.detectedFields).not.toContain('jobName');
    expect(mapping.detectedFields).not.toContain('brandName');
  });
});

describe('detectCommonFields', () => {
  it('聚合样本找出最常出现的别名', () => {
    const samples: RecommendJobItem[] = [
      { jobId: '1', secId: 's', title: 'a', brandName: 'b' },
      { jobId: '2', secId: 's', title: 'a', brandName: 'b' },
      { encryptJobId: '3', securityId: 's', jobName: 'a', brandName: 'b' },
    ];
    const mapping = detectCommonFields(samples);
    expect(mapping.encryptJobId).toBe('jobId'); // 2/3 命中 jobId
    expect(mapping.securityId).toBe('secId');
    expect(mapping.jobName).toBe('title');
  });

  it('空样本返回 null 字段', () => {
    const mapping = detectCommonFields([]);
    expect(mapping.encryptJobId).toBeNull();
    expect(mapping.detectedFields).toEqual([]);
  });
});
