import type { JobSearchParams } from '../../types.js';

/** 中文经验值 → 数字代码。 */
export const EXPERIENCE_MAP: Record<string, number> = {
  在校生: 108,
  应届生: 102,
  不限: 101,
  一年以内: 103,
  '一到三年': 104,
  '1-3年': 104,
  '三到五年': 105,
  '3-5年': 105,
  '五到十年': 106,
  '5-10年': 106,
  十年以上: 107,
};

/** 中文工作类型 → 数字代码。 */
export const JOB_TYPE_MAP: Record<string, number> = {
  全职: 1901,
  兼职: 1903,
};

/** 中文薪资范围 → 数字代码。 */
export const SALARY_MAP: Record<string, number> = {
  '3k以下': 402,
  '3-5k': 403,
  '5-10k': 404,
  '10-20k': 405,
  '20-50k': 406,
  '50以上': 407,
  '50k以上': 407,
};

export interface RawSearchParams {
  experience?: string | number;
  jobType?: string | number;
  salary?: string | number;
  page?: number;
  pageSize?: number;
  encryptExpectId?: string;
  cursor?: string;
}

function resolveCode(
  value: string | number | undefined,
  map: Record<string, number>,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return map[trimmed];
}

/**
 * 将中文搜索条件映射为数字代码，构造 API 参数。
 * pageSize 默认 15，与 Boss 推荐列表一致。
 */
export function createSearchParams(raw: RawSearchParams): JobSearchParams {
  const params: JobSearchParams = {
    pageSize: raw.pageSize ?? 15,
  };

  const experience = resolveCode(raw.experience, EXPERIENCE_MAP);
  if (experience) params.experience = experience;
  const jobType = resolveCode(raw.jobType, JOB_TYPE_MAP);
  if (jobType) params.jobType = jobType;
  const salary = resolveCode(raw.salary, SALARY_MAP);
  if (salary) params.salary = salary;

  if (raw.page) params.page = raw.page;
  if (raw.encryptExpectId) params.encryptExpectId = raw.encryptExpectId;
  if (raw.cursor) params.cursor = raw.cursor;

  return params;
}

export type { JobSearchParams };
