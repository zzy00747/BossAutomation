import { describe, it, expect, beforeEach } from 'vitest';
import { Queue, ClosedQueueError } from '../../../pipeline/queues.js';
import type { BrowserJob, DetailedJob, ScreenedJob } from '../../../pipeline/queues.js';
import { fixtureJobDetail } from '../../fixtures/job-detail.js';
import { fixtureScreenPass } from '../../fixtures/llm-responses.js';
import type { NormalizedJob } from '../../../types.js';

const job: NormalizedJob = {
  encryptJobId: 'job-001',
  jobName: '前端',
  brandName: '某公司',
};

describe('Queue', () => {
  let queue: Queue<number>;

  beforeEach(() => {
    queue = new Queue<number>();
  });

  it('FIFO 顺序出队', () => {
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);

    expect(queue.size).toBe(3);
    expect(queue.tryDequeue()).toBe(1);
    expect(queue.tryDequeue()).toBe(2);
    expect(queue.tryDequeue()).toBe(3);
    expect(queue.size).toBe(0);
  });

  it('tryDequeue 空队列返回 undefined', () => {
    expect(queue.tryDequeue()).toBeUndefined();
  });

  it('enqueue 后立即 dequeue 返回 Promise', async () => {
    queue.enqueue(42);
    await expect(queue.dequeue()).resolves.toBe(42);
  });

  it('空队列 dequeue 阻塞，enqueue 后唤醒', async () => {
    const promise = queue.dequeue();
    queue.enqueue(99);

    await expect(promise).resolves.toBe(99);
  });

  it('多个消费者按 enqueue 顺序唤醒', async () => {
    const p1 = queue.dequeue();
    const p2 = queue.dequeue();
    const p3 = queue.dequeue();

    queue.enqueue(10);
    queue.enqueue(20);
    queue.enqueue(30);

    await expect(p1).resolves.toBe(10);
    await expect(p2).resolves.toBe(20);
    await expect(p3).resolves.toBe(30);
  });

  it('并发消费：多消费者各取不同项', async () => {
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    queue.enqueue(4);

    const results = await Promise.all([
      queue.dequeue(),
      queue.dequeue(),
      queue.dequeue(),
      queue.dequeue(),
    ]);

    expect(results.sort()).toEqual([1, 2, 3, 4]);
  });

  it('close 后 enqueue 抛出 ClosedQueueError', () => {
    queue.close();
    expect(() => queue.enqueue(1)).toThrow(ClosedQueueError);
  });

  it('close 后正在等待的 dequeue 被 reject', async () => {
    const promise = queue.dequeue();
    queue.close();
    await expect(promise).rejects.toThrow(ClosedQueueError);
  });

  it('close 后有剩余项仍可消费', async () => {
    queue.enqueue(1);
    queue.enqueue(2);
    queue.close();

    expect(await queue.dequeue()).toBe(1);
    expect(await queue.dequeue()).toBe(2);
    await expect(queue.dequeue()).rejects.toThrow(ClosedQueueError);
  });

  it('重复 close 是幂等的', () => {
    queue.close();
    expect(() => queue.close()).not.toThrow();
  });

  it('isClosed 状态正确', () => {
    expect(queue.isClosed).toBe(false);
    queue.close();
    expect(queue.isClosed).toBe(true);
  });
});

describe('队列消息结构', () => {
  it('BrowserJob 携带 rawJob 与 sourceKeyword', () => {
    const q = new Queue<BrowserJob>();
    const bj: BrowserJob = { rawJob: job, sourceKeyword: '前端' };
    q.enqueue(bj);
    expect(q.tryDequeue()?.sourceKeyword).toBe('前端');
  });

  it('DetailedJob 携带 rawJob、detail、sourceKeyword', () => {
    const q = new Queue<DetailedJob>();
    const dj: DetailedJob = {
      rawJob: job,
      detail: fixtureJobDetail,
      sourceKeyword: '前端',
    };
    q.enqueue(dj);
    const got = q.tryDequeue();
    expect(got?.detail.postDescription).toBe(fixtureJobDetail.postDescription);
  });

  it('ScreenedJob 携带 rawJob、detail、screenResult', () => {
    const q = new Queue<ScreenedJob>();
    const sj: ScreenedJob = {
      rawJob: job,
      detail: fixtureJobDetail,
      screenResult: fixtureScreenPass,
      sourceKeyword: '前端',
    };
    q.enqueue(sj);
    const got = q.tryDequeue();
    expect(got?.screenResult.matchScore).toBe(fixtureScreenPass.matchScore);
  });
});
