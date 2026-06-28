import { createChild } from '../logger.js';

interface QueueItem<T> {
  fn: () => T | Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * SQLite 写入队列：单消费者串行执行，避免并发写入导致 SQLITE_BUSY。
 * enqueue(fn) 返回 Promise，fn 内部执行 db 写操作。
 */
export class SQLiteWriteQueue {
  private queue: QueueItem<unknown>[] = [];
  private processing = false;
  private closed = false;
  private logger = createChild('write-queue');
  private idleResolvers: Array<() => void> = [];

  get size(): number {
    return this.queue.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('写入队列已关闭，无法 enqueue'));
    }
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = { fn, resolve, reject };
      this.queue.push(item as QueueItem<unknown>);
      void this.process();
    });
  }

  /** 等待队列清空。关闭后立即 resolve。 */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && !this.processing) return;
    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  close(): void {
    this.closed = true;
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift() as QueueItem<unknown>;
        try {
          const result = await item.fn();
          item.resolve(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn({ err: message }, '写入操作失败');
          item.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
      this.notifyIdle();
    } finally {
      this.processing = false;
    }
  }

  private notifyIdle(): void {
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }
}
