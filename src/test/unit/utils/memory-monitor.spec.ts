import { describe, it, expect, vi } from 'vitest';
import { MemoryMonitor, startMemoryMonitor } from '../../../utils/memory-monitor.js';
import { createLogger } from '../../../logger.js';

const silentLogger = createLogger({ level: 'silent', pretty: false });

describe('MemoryMonitor', () => {
  it('start 后处于运行状态', () => {
    const monitor = new MemoryMonitor({ intervalMs: 100, logger: silentLogger });
    const stop = monitor.start();
    expect(monitor.isRunning).toBe(true);
    stop();
    expect(monitor.isRunning).toBe(false);
  });

  it('stop 清除定时器', () => {
    const monitor = new MemoryMonitor({ intervalMs: 100, logger: silentLogger });
    monitor.start();
    monitor.stop();
    expect(monitor.isRunning).toBe(false);
  });

  it('重复 start 不会创建多个定时器', () => {
    const monitor = new MemoryMonitor({ intervalMs: 100, logger: silentLogger });
    monitor.start();
    monitor.start();
    expect(monitor.isRunning).toBe(true);
    monitor.stop();
    expect(monitor.isRunning).toBe(false);
  });

  it('立即输出一次内存快照', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    } as unknown as import('pino').Logger;
    const monitor = new MemoryMonitor({ intervalMs: 100, logger });
    monitor.start();
    expect(logger.info).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it('日志包含 rss/heapUsed 等字段', () => {
    const calls: Array<[Record<string, unknown>, string]> = [];
    const logger = {
      info: (obj: Record<string, unknown>, msg: string) => calls.push([obj, msg]),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    } as unknown as import('pino').Logger;
    const monitor = new MemoryMonitor({ intervalMs: 100, logger });
    monitor.start();
    monitor.stop();
    const payload = calls[0]?.[0];
    expect(payload).toHaveProperty('rss');
    expect(payload).toHaveProperty('heapUsed');
    expect(payload).toHaveProperty('heapTotal');
  });

  it('startMemoryMonitor 便捷函数返回 stop 句柄', () => {
    const stop = startMemoryMonitor(silentLogger, 100);
    expect(typeof stop).toBe('function');
    stop();
  });
});
