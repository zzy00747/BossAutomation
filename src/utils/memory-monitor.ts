import { createChild } from '../logger.js';

export interface MemoryMonitorOptions {
  intervalMs?: number;
  logger?: import('pino').Logger;
}

/**
 * 定期输出 process.memoryUsage()，用于长跑内存观测。
 * start() 返回 stop() 句柄。
 */
export class MemoryMonitor {
  private intervalMs: number;
  private logger: import('pino').Logger;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: MemoryMonitorOptions = {}) {
    this.intervalMs = options.intervalMs ?? 60_000;
    this.logger = options.logger ?? createChild('memory');
  }

  start(): () => void {
    if (this.timer) return () => this.stop();
    this.log();
    this.timer = setInterval(() => this.log(), this.intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  private log(): void {
    const mem = process.memoryUsage();
    this.logger.info(
      {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
      },
      '内存使用快照',
    );
  }
}

/** 便捷函数：启动一次性内存监控并返回停止句柄。 */
export function startMemoryMonitor(
  logger?: import('pino').Logger,
  intervalMs: number = 60_000,
): () => void {
  const monitor = new MemoryMonitor({ intervalMs, logger });
  return monitor.start();
}
