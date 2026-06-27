import type { RecommendJobItem } from '../../types.js';

export interface JobFieldMapping {
  encryptJobId: string | null;
  securityId: string | null;
  encryptBossId: string | null;
  lid: string | null;
  jobName: string | null;
  jobDetailUrl: string | null;
  detectedFields: string[];
}

const FIELD_ALIASES: Record<keyof JobFieldMapping, string[]> = {
  encryptJobId: ['encryptJobId', 'jobId', 'encryptId', 'id'],
  securityId: ['securityId', 'encryptSecurityId', 'secId'],
  encryptBossId: ['encryptBossId', 'bossId'],
  lid: ['lid', 'lId', 'listId'],
  jobName: ['jobName', 'title', 'name'],
  jobDetailUrl: ['jobDetailUrl', 'detailUrl'],
  detectedFields: [],
};

/**
 * 探测单个职位对象实际可用的字段名映射。
 * 优先按已知别名精确匹配；记录所有命中的字段名。
 */
export function detectJobIdFields(jobItem: RecommendJobItem | Record<string, unknown>): JobFieldMapping {
  const r = jobItem as Record<string, unknown>;
  const mapping: JobFieldMapping = {
    encryptJobId: null,
    securityId: null,
    encryptBossId: null,
    lid: null,
    jobName: null,
    jobDetailUrl: null,
    detectedFields: [],
  };

  for (const key of Object.keys(r)) {
    if (r[key] !== undefined && r[key] !== null && r[key] !== '') {
      mapping.detectedFields.push(key);
    }
  }

  (Object.keys(FIELD_ALIASES) as Array<keyof typeof FIELD_ALIASES>).forEach((field) => {
    if (field === 'detectedFields') return;
    for (const alias of FIELD_ALIASES[field]) {
      const val = r[alias];
      if (val !== undefined && val !== null && val !== '') {
        mapping[field] = alias;
        break;
      }
    }
  });

  return mapping;
}

/**
 * 对一批职位样本聚合字段映射，找出每类字段最常出现的别名。
 * 用于在结构变更时自动适配。
 */
export function detectCommonFields(samples: unknown[]): JobFieldMapping {
  const fieldKeys = ['encryptJobId', 'securityId', 'encryptBossId', 'lid', 'jobName', 'jobDetailUrl'] as const;
  const counts: Record<string, Record<string, number>> = {};
  for (const k of fieldKeys) counts[k] = {};
  const detected = new Map<string, number>();

  for (const sample of samples) {
    if (!sample || typeof sample !== 'object') continue;
    const mapping = detectJobIdFields(sample as RecommendJobItem);
    for (const f of mapping.detectedFields) {
      detected.set(f, (detected.get(f) ?? 0) + 1);
    }
    for (const field of fieldKeys) {
      const hit = mapping[field as keyof JobFieldMapping] as string | null;
      if (hit) counts[field][hit] = (counts[field][hit] ?? 0) + 1;
    }
  }

  const result: JobFieldMapping = {
    encryptJobId: pickMostFrequent(counts.encryptJobId),
    securityId: pickMostFrequent(counts.securityId),
    encryptBossId: pickMostFrequent(counts.encryptBossId),
    lid: pickMostFrequent(counts.lid),
    jobName: pickMostFrequent(counts.jobName),
    jobDetailUrl: pickMostFrequent(counts.jobDetailUrl),
    detectedFields: [...detected.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k),
  };
  return result;
}

function pickMostFrequent(counts: Record<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [alias, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = alias;
      bestCount = count;
    }
  }
  return best;
}
