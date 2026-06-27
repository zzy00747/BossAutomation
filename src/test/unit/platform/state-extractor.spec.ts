import { describe, it, expect, vi } from 'vitest';
import {
  extractPageState,
  extractJobsFromState,
  findFirstJobList,
} from '../../../platform/boss/state-extractor.js';
import { MockPage } from '../../__mocks__/mock-browser.js';
import type { PageState } from '../../../types.js';

describe('extractPageState', () => {
  it('通过 page.evaluate 抽取 nuxt 与 initialState', async () => {
    const page = new MockPage();
    const stub: PageState = {
      nuxt: { data: [{}] },
      initialState: { job: { jobList: [] } },
    };
    vi.spyOn(page, 'evaluate').mockResolvedValue(stub);
    const state = await extractPageState(page);
    expect(state.nuxt).toEqual({ data: [{}] });
    expect(state.initialState).toEqual({ job: { jobList: [] } });
  });

  it('空页面返回空对象', async () => {
    const page = new MockPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue({});
    const state = await extractPageState(page);
    expect(state.nuxt).toBeUndefined();
    expect(state.initialState).toBeUndefined();
  });
});

describe('extractJobsFromState', () => {
  it('从 nuxt.data[0].jobList 提取', () => {
    const state: PageState = {
      nuxt: { data: [{ jobList: [{ encryptJobId: 'a', jobName: 'x', brandName: 'b' }] }] },
    };
    const jobs = extractJobsFromState(state);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].encryptJobId).toBe('a');
  });

  it('从 nuxt.state.job.jobList 提取', () => {
    const state: PageState = {
      nuxt: { state: { job: { jobList: [{ jobId: 'b', jobName: 'x', brandName: 'b' }] } } },
    };
    expect(extractJobsFromState(state)[0].encryptJobId).toBe('b');
  });

  it('从 nuxt.state.recommend.jobList 提取', () => {
    const state: PageState = {
      nuxt: { state: { recommend: { jobList: [{ id: 'c', jobName: 'x', brandName: 'b' }] } } },
    };
    expect(extractJobsFromState(state)[0].encryptJobId).toBe('c');
  });

  it('从 initialState.recommend.jobList 提取', () => {
    const state: PageState = {
      initialState: { recommend: { jobList: [{ id: 'd', jobName: 'x', brandName: 'b' }] } },
    };
    expect(extractJobsFromState(state)[0].encryptJobId).toBe('d');
  });

  it('从 initialState.search.jobList 提取', () => {
    const state: PageState = {
      initialState: { search: { jobList: [{ id: 'e', jobName: 'x', brandName: 'b' }] } },
    };
    expect(extractJobsFromState(state)[0].encryptJobId).toBe('e');
  });

  it('返回首个非空，跳过空数组', () => {
    const state: PageState = {
      nuxt: { state: { job: { jobList: [] } } },
      initialState: { job: { jobList: [{ id: 'f', jobName: 'x', brandName: 'b' }] } },
    };
    expect(extractJobsFromState(state)).toHaveLength(1);
    expect(extractJobsFromState(state)[0].encryptJobId).toBe('f');
  });

  it('过滤主键缺失项', () => {
    const state: PageState = {
      initialState: {
        job: {
          jobList: [
            { id: 'g', jobName: 'x', brandName: 'b' },
            { jobName: '无主键', brandName: 'b' },
          ],
        },
      },
    };
    expect(extractJobsFromState(state)).toHaveLength(1);
  });

  it('无匹配返回空数组', () => {
    expect(extractJobsFromState({})).toEqual([]);
    expect(extractJobsFromState({ nuxt: { foo: 1 } })).toEqual([]);
  });

  it('规范化字段别名', () => {
    const state: PageState = {
      nuxt: {
        data: [
          {
            jobList: [
              { jobId: 'h', secId: 's-h', bossId: 'b-h', jobName: '岗位', brandName: '公司' },
            ],
          },
        ],
      },
    };
    const jobs = extractJobsFromState(state);
    expect(jobs[0].securityId).toBe('s-h');
    expect(jobs[0].encryptBossId).toBe('b-h');
  });
});

describe('findFirstJobList', () => {
  it('递归找到嵌套的 jobList', () => {
    const state: PageState = {
      initialState: {
        customModule: {
          deep: {
            list: [{ id: 'x', jobName: 'x', brandName: 'b' }],
          },
        },
      },
    };
    const found = findFirstJobList(state);
    expect(found).not.toBeNull();
    expect(found).toHaveLength(1);
  });

  it('未找到返回 null', () => {
    expect(findFirstJobList({})).toBeNull();
    expect(findFirstJobList({ nuxt: { foo: { bar: 1 } } })).toBeNull();
  });
});
