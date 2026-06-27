import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BossDataCollector } from '../../../platform/boss/data-collector.js';
import { MockPage } from '../../__mocks__/mock-browser.js';
import type { PageState, RecommendJobItem } from '../../../types.js';

const sleepFn = vi.fn().mockResolvedValue(undefined);

function stateWithJobs(jobs: RecommendJobItem[]): PageState {
  return { initialState: { job: { jobList: jobs } } };
}

describe('BossDataCollector', () => {
  let page: MockPage;

  beforeEach(() => {
    page = new MockPage();
    sleepFn.mockClear();
  });

  it('Layer0 state 命中则跳过其他层', async () => {
    const collector = new BossDataCollector({ sleepFn });
    vi.spyOn(page, 'evaluate').mockResolvedValue(
      stateWithJobs([{ id: 'a', jobName: 'x', brandName: 'b' }]),
    );

    const jobs = await collector.collectFromPage(page);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].encryptJobId).toBe('a');
    expect(sleepFn).not.toHaveBeenCalled(); // state 命中不等待网络
    const layers = collector.getHits().map((h) => h.layer);
    expect(layers).toEqual(['state']);
  });

  it('state 未命中 → 等待网络 → route 命中', async () => {
    const collector = new BossDataCollector({ sleepFn });
    vi.spyOn(page, 'evaluate').mockResolvedValue({}); // 空 state

    collector.pushRouteJobs([{ id: 'r1', jobName: 'x', brandName: 'b' }]);

    const jobs = await collector.collectFromPage(page);

    expect(sleepFn).toHaveBeenCalledWith(3000);
    expect(jobs[0].encryptJobId).toBe('r1');
    const layers = collector.getHits().map((h) => h.layer);
    expect(layers).toEqual(['state', 'route']);
  });

  it('route 未命中 → response 命中', async () => {
    const collector = new BossDataCollector({ sleepFn });
    vi.spyOn(page, 'evaluate').mockResolvedValue({});
    collector.pushResponseJobs([{ id: 'resp1', jobName: 'x', brandName: 'b' }]);

    const jobs = await collector.collectFromPage(page);

    expect(jobs[0].encryptJobId).toBe('resp1');
    const layers = collector.getHits().map((h) => h.layer);
    expect(layers).toContain('response');
  });

  it('response 未命中 → inject 命中', async () => {
    const collector = new BossDataCollector({
      sleepFn,
      injectedJobs: [{ id: 'inj1', jobName: 'x', brandName: 'b' }],
    });
    vi.spyOn(page, 'evaluate').mockResolvedValue({});

    const jobs = await collector.collectFromPage(page);

    expect(jobs[0].encryptJobId).toBe('inj1');
    expect(collector.getHits().map((h) => h.layer)).toContain('inject');
  });

  it('inject 未命中 → fallback 直接 API 命中', async () => {
    const fallback = [{ encryptJobId: 'fb1', jobName: 'x', brandName: 'b' }];
    const collector = new BossDataCollector({ sleepFn, fallbackJobs: fallback });
    vi.spyOn(page, 'evaluate').mockResolvedValue({});

    const jobs = await collector.collectFromPage(page);

    expect(jobs[0].encryptJobId).toBe('fb1');
    const layers = collector.getHits().map((h) => h.layer);
    expect(layers).toContain('fallback');
  });

  it('全部失败 → DOM 兜底', async () => {
    const domJobs = [{ encryptJobId: 'dom1', jobName: '岗位', brandName: '公司' }];
    const collector = new BossDataCollector({ sleepFn });
    const evalSpy = vi.spyOn(page, 'evaluate');
    // 第一次 evaluate 是 extractPageState 返回空；第二次是 parseJobsFromDOM 返回 DOM 解析结果
    evalSpy.mockResolvedValueOnce({}).mockResolvedValueOnce(domJobs);

    const jobs = await collector.collectFromPage(page);

    expect(jobs[0].encryptJobId).toBe('dom1');
    const layers = collector.getHits().map((h) => h.layer);
    expect(layers[layers.length - 1]).toBe('dom');
  });

  it('全部为空返回空数组并记录所有层', async () => {
    const collector = new BossDataCollector({ sleepFn });
    const evalSpy = vi.spyOn(page, 'evaluate');
    // state 抽取返回空，DOM 解析返回空数组
    evalSpy.mockResolvedValueOnce({}).mockResolvedValueOnce([]);

    const jobs = await collector.collectFromPage(page);

    expect(jobs).toEqual([]);
    const layers = collector.getHits().map((h) => h.layer);
    expect(layers).toEqual(['state', 'route', 'response', 'inject', 'fallback', 'dom']);
  });

  it('某层抛错不影响后续层降级', async () => {
    const fallback = [{ encryptJobId: 'fb1', jobName: 'x', brandName: 'b' }];
    const collector = new BossDataCollector({ sleepFn, fallbackJobs: fallback });
    vi.spyOn(page, 'evaluate').mockRejectedValueOnce(new Error('page crashed'));

    const jobs = await collector.collectFromPage(page);

    expect(jobs[0].encryptJobId).toBe('fb1');
    const stateHit = collector.getHits().find((h) => h.layer === 'state');
    expect(stateHit?.count).toBe(0);
  });

  it('记录每层耗时', async () => {
    const collector = new BossDataCollector({ sleepFn });
    vi.spyOn(page, 'evaluate').mockResolvedValue(
      stateWithJobs([{ id: 'a', jobName: 'x', brandName: 'b' }]),
    );
    await collector.collectFromPage(page);
    const hit = collector.getHits()[0];
    expect(hit.durationMs).toBeGreaterThanOrEqual(0);
  });
});
