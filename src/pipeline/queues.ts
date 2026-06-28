import type { JobDetail, NormalizedJob, ScreenResult } from '../types.js';

export interface BrowserJob {
  rawJob: NormalizedJob;
  sourceKeyword: string;
}

export interface DetailedJob {
  rawJob: NormalizedJob;
  detail: JobDetail;
  sourceKeyword: string;
}

export interface ScreenedJob {
  rawJob: NormalizedJob;
  detail: JobDetail;
  screenResult: ScreenResult;
  sourceKeyword: string;
}

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * 内存有界队列：FIFO + 异步 dequeue。
 * 关闭后 dequeue 立即抛出 ClosedQueueError，已 enqueue 项仍可被消费。
 */
export class Queue<T> {
  private items: T[] = [];
  private waiters: Waiter<T>[] = [];
  private closed = false;

  get size(): number {
    return this.items.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  enqueue(item: T): void {
    if (this.closed) {
      throw new ClosedQueueError('队列已关闭，无法 enqueue');
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(item);
      return;
    }
    this.items.push(item);
  }

  dequeue(): Promise<T> {
    if (this.items.length > 0) {
      return Promise.resolve(this.items.shift() as T);
    }
    if (this.closed) {
      return Promise.reject(new ClosedQueueError('队列已关闭'));
    }
    return new Promise<T>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /** 非阻塞弹出：无可用项时返回 undefined。 */
  tryDequeue(): T | undefined {
    return this.items.shift();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter.reject(new ClosedQueueError('队列已关闭'));
    }
  }

  /** 唤醒所有等待者（用于优雅退出）。等待者会收到 ClosedQueueError。 */
  drain(): void {
    this.close();
  }
}

export class ClosedQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClosedQueueError';
  }
}

export type { Waiter };
