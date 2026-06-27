import type { NormalizedJob, RecommendJobItem } from '../../types.js';

const JOB_ID_FROM_URL_PATTERN = /\/job_detail\/([A-Za-z0-9_-]+)\.html/;

/**
 * 从职位详情页 URL 提取 encryptJobId。
 * 支持 /job_detail/{id}.html 与纯 path 形式。
 */
export function extractJobIdFromUrl(url?: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(JOB_ID_FROM_URL_PATTERN);
  if (match?.[1]) return match[1];

  try {
    const u = new URL(url, 'https://www.zhipin.com');
    const m = u.pathname.match(JOB_ID_FROM_URL_PATTERN);
    if (m?.[1]) return m[1];
    const seg = u.searchParams.get('encryptJobId');
    if (seg) return seg;
  } catch {
    return null;
  }
  return null;
}

function pickFirst(...values: Array<unknown>): string | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') {
      return String(v);
    }
  }
  return undefined;
}

/**
 * 将不同接口返回的职位对象统一规范化为 NormalizedJob。
 * 主键缺失时返回 null，调用方应跳过。
 */
export function normalizeJob(raw: RecommendJobItem | Record<string, unknown>): NormalizedJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const encryptJobId = pickFirst(
    r['encryptJobId'],
    r['jobId'],
    r['encryptId'],
    r['id'],
    extractJobIdFromUrl(r['jobDetailUrl'] as string | undefined),
    extractJobIdFromUrl(r['detailUrl'] as string | undefined),
  );

  if (!encryptJobId) return null;

  const securityId = pickFirst(r['securityId'], r['encryptSecurityId'], r['secId']);
  const encryptBossId = pickFirst(r['encryptBossId'], r['bossId']);
  const lid = pickFirst(r['lid'], r['lId'], r['listId']);
  const jobName = pickFirst(r['jobName'], r['title'], r['name']) ?? '未知职位';

  const rawSkills = r['skills'];
  const skills = Array.isArray(rawSkills)
    ? rawSkills.map((s) => String(s)).filter(Boolean)
    : undefined;

  const job: NormalizedJob = {
    encryptJobId,
    jobName,
    brandName: pickFirst(r['brandName']) ?? '',
  };

  if (securityId) job.securityId = securityId;
  if (encryptBossId) job.encryptBossId = encryptBossId;
  if (lid) job.lid = lid;

  const cityName = pickFirst(r['cityName']);
  if (cityName) job.cityName = cityName;
  const areaDistrict = pickFirst(r['areaDistrict']);
  if (areaDistrict) job.areaDistrict = areaDistrict;
  const salaryDesc = pickFirst(r['salaryDesc']);
  if (salaryDesc) job.salaryDesc = salaryDesc;
  const jobExperience = pickFirst(r['jobExperience']);
  if (jobExperience) job.jobExperience = jobExperience;
  const jobDegree = pickFirst(r['jobDegree']);
  if (jobDegree) job.jobDegree = jobDegree;
  if (skills && skills.length > 0) job.skills = skills;

  const industry = pickFirst(r['industry']);
  if (industry) job.industry = industry;
  const brandScaleName = pickFirst(r['brandScaleName']);
  if (brandScaleName) job.brandScaleName = brandScaleName;

  const detailUrl = pickFirst(r['jobDetailUrl'], r['detailUrl']);
  if (detailUrl) job.jobDetailUrl = detailUrl;

  const bossName = pickFirst(r['bossName']);
  if (bossName) job.bossName = bossName;
  const bossTitle = pickFirst(r['bossTitle']);
  if (bossTitle) job.bossTitle = bossTitle;

  return job;
}

/** 批量规范化并过滤掉主键缺失的项。 */
export function normalizeJobList(rawList: unknown[]): NormalizedJob[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((item) => normalizeJob(item as RecommendJobItem))
    .filter((j): j is NormalizedJob => j !== null);
}
