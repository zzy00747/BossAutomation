import type { IPage } from '../../interfaces/browser.js';
import type { PageState, NormalizedJob } from '../../types.js';
import { normalizeJobList } from './normalize.js';

/**
 * 抽取页面初始状态（Vue/Nuxt 注入的 window.__NUXT__ / __INITIAL_STATE__）。
 * 这些结构化数据比 API 拦截更稳定，是 Layer 0 的数据来源。
 */
export async function extractPageState(page: IPage): Promise<PageState> {
  return page.evaluate<PageState>(() => {
    const w = window as unknown as {
      __NUXT__?: Record<string, unknown>;
      __INITIAL_STATE__?: Record<string, unknown>;
    };
    return {
      nuxt: w.__NUXT__,
      initialState: w.__INITIAL_STATE__,
    };
  });
}

function asArray(value: unknown): unknown[] | null {
  if (Array.isArray(value) && value.length > 0) return value;
  return null;
}

/**
 * 从多种候选路径中提取首个非空 jobList 并规范化。
 * Boss 不同页面结构不同：推荐页、搜索页、详情页路径各异。
 */
export function extractJobsFromState(state: PageState): NormalizedJob[] {
  if (!state) return [];

  const nuxt = (state.nuxt ?? {}) as Record<string, unknown>;
  const nuxtData = (nuxt['data'] ?? {}) as Record<string, unknown>;
  const nuxtData0 = (nuxtData['0'] ?? {}) as Record<string, unknown>;
  const nuxtState = (nuxt['state'] ?? {}) as Record<string, unknown>;
  const init = (state.initialState ?? {}) as Record<string, unknown>;

  const candidates: unknown[] = [
    nuxtData0['jobList'],
    (nuxtState['job'] as Record<string, unknown> | undefined)?.['jobList'],
    (nuxtState['recommend'] as Record<string, unknown> | undefined)?.['jobList'],
    (init['job'] as Record<string, unknown> | undefined)?.['jobList'],
    (init['recommend'] as Record<string, unknown> | undefined)?.['jobList'],
    (init['search'] as Record<string, unknown> | undefined)?.['jobList'],
  ];

  for (const candidate of candidates) {
    const list = asArray(candidate);
    if (list) {
      return normalizeJobList(list);
    }
  }

  return [];
}

/** 递归查找 state 中首个非空 jobList 数组（兜底探测未知结构）。 */
export function findFirstJobList(state: PageState): unknown[] | null {
  if (!state) return null;
  const stack: unknown[] = [state.nuxt, state.initialState];
  const visited = new Set<unknown>();

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);

    if (Array.isArray(node) && node.length > 0 && isJobLike(node[0])) {
      return node;
    }

    if (Array.isArray(node)) {
      stack.push(...node);
    } else {
      stack.push(...Object.values(node as Record<string, unknown>));
    }
  }

  return null;
}

function isJobLike(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const r = item as Record<string, unknown>;
  return (
    'encryptJobId' in r ||
    'jobId' in r ||
    'encryptId' in r ||
    'id' in r ||
    'jobName' in r ||
    'jobDetailUrl' in r
  );
}
