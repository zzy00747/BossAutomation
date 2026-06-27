import { describe, it, expect } from 'vitest';
import {
  createSearchParams,
  EXPERIENCE_MAP,
  JOB_TYPE_MAP,
  SALARY_MAP,
} from '../../../platform/boss/search-params.js';

describe('createSearchParams', () => {
  it('中文经验映射正确', () => {
    expect(EXPERIENCE_MAP['在校生']).toBe(108);
    expect(EXPERIENCE_MAP['应届生']).toBe(102);
    expect(EXPERIENCE_MAP['不限']).toBe(101);
    expect(EXPERIENCE_MAP['一到三年']).toBe(104);
    expect(EXPERIENCE_MAP['三到五年']).toBe(105);
    expect(EXPERIENCE_MAP['十年以上']).toBe(107);
  });

  it('中文类型映射正确', () => {
    expect(JOB_TYPE_MAP['全职']).toBe(1901);
    expect(JOB_TYPE_MAP['兼职']).toBe(1903);
  });

  it('中文薪资映射正确', () => {
    expect(SALARY_MAP['3k以下']).toBe(402);
    expect(SALARY_MAP['10-20k']).toBe(405);
    expect(SALARY_MAP['50以上']).toBe(407);
  });

  it('中文值映射为数字代码', () => {
    const params = createSearchParams({
      experience: '一到三年',
      jobType: '全职',
      salary: '10-20k',
    });
    expect(params.experience).toBe(104);
    expect(params.jobType).toBe(1901);
    expect(params.salary).toBe(405);
  });

  it('默认 pageSize=15', () => {
    expect(createSearchParams({}).pageSize).toBe(15);
  });

  it('数字直接透传', () => {
    const params = createSearchParams({ experience: 104, salary: 405 });
    expect(params.experience).toBe(104);
    expect(params.salary).toBe(405);
  });

  it('字符串数字被识别', () => {
    const params = createSearchParams({ experience: '104' });
    expect(params.experience).toBe(104);
  });

  it('未知中文不写入该字段', () => {
    const params = createSearchParams({ experience: '火星经验' });
    expect(params.experience).toBeUndefined();
  });

  it('保留 page/cursor/encryptExpectId', () => {
    const params = createSearchParams({
      page: 3,
      cursor: 'abc',
      encryptExpectId: 'expect-1',
    });
    expect(params.page).toBe(3);
    expect(params.cursor).toBe('abc');
    expect(params.encryptExpectId).toBe('expect-1');
  });

  it('空字符串与 undefined 不写入', () => {
    const params = createSearchParams({ experience: '', salary: undefined });
    expect(params.experience).toBeUndefined();
    expect(params.salary).toBeUndefined();
  });

  it('3-5年 别名也映射到 105', () => {
    expect(createSearchParams({ experience: '3-5年' }).experience).toBe(105);
  });
});
