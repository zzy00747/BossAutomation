import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ClassifiedRetryExecutor,
  SimpleRateLimiter,
  calculateBackoff,
} from '../../../utils/retry.js';
import { BossAPIError } from '../../../platform/boss/api.js';

const sleepFn = vi.fn().mockResolvedValue(undefined);

function createSessionManager(overrides: { check?: boolean; refresh?: boolean } = {}) {
  return {
    checkLoginState: vi.fn().mockResolvedValue(overrides.check ?? true),
    refreshSession: vi.fn().mockResolvedValue(overrides.refresh ?? true),
  };
}

describe('calculateBackoff', () => {
  it('随 attempt 指数增长', () => {
    const b1 = calculateBackoff(1);
    const b2 = calculateBackoff(2);
    const b3 = calculateBackoff(3);
    expect(b1).toBeLessThan(b2);
    expect(b2).toBeLessThan(b3);
  });

  it('baseMs 控制基准', () => {
    expect(calculateBackoff(1, 1000)).toBeGreaterThanOrEqual(900);
    expect(calculateBackoff(1, 1000)).toBeLessThanOrEqual(1100);
  });
});

describe('SimpleRateLimiter', () => {
  it('slowDown 增加惩罚', () => {
    const limiter = new SimpleRateLimiter({ stepMs: 2000 });
    expect(limiter.getPenaltyDelay()).toBe(0);
    limiter.slowDown();
    expect(limiter.getPenaltyDelay()).toBe(2000);
    limiter.slowDown();
    expect(limiter.getPenaltyDelay()).toBe(4000);
  });

  it('不超过 maxPenaltyMs', () => {
    const limiter = new SimpleRateLimiter({ stepMs: 40000, maxPenaltyMs: 60000 });
    limiter.slowDown();
    limiter.slowDown();
    expect(limiter.getPenaltyDelay()).toBe(60000);
  });

  it('reset 归零', () => {
    const limiter = new SimpleRateLimiter();
    limiter.slowDown();
    limiter.reset();
    expect(limiter.getPenaltyDelay()).toBe(0);
  });
});

describe('ClassifiedRetryExecutor', () => {
  beforeEach(() => {
    sleepFn.mockClear();
  });

  it('首次成功不重试', async () => {
    const sm = createSessionManager();
    const op = vi.fn().mockResolvedValue('ok');
    const exec = new ClassifiedRetryExecutor({ sessionManager: sm, sleepFn });

    const result = await exec.execute(op, { operationName: 'test' });

    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('401 触发刷新会话后重试成功', async () => {
    const sm = createSessionManager();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new BossAPIError('未登录', { statusCode: 401 }))
      .mockResolvedValueOnce('ok');
    const exec = new ClassifiedRetryExecutor({ sessionManager: sm, sleepFn });

    const result = await exec.execute(op, { operationName: 'auth-refresh' });

    expect(result).toBe('ok');
    expect(sm.refreshSession).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('刷新失败则抛错', async () => {
    const sm = createSessionManager({ refresh: false });
    const op = vi.fn().mockRejectedValue(new BossAPIError('未登录', { statusCode: 401 }));
    const exec = new ClassifiedRetryExecutor({ sessionManager: sm, sleepFn });

    await expect(exec.execute(op, { operationName: 'x' })).rejects.toBeDefined();
    expect(sm.refreshSession).toHaveBeenCalled();
  });

  it('429 退避并降速', async () => {
    const sm = createSessionManager();
    const limiter = new SimpleRateLimiter({ stepMs: 3000 });
    const op = vi
      .fn()
      .mockRejectedValueOnce(new BossAPIError('限流', { statusCode: 429 }))
      .mockResolvedValueOnce('ok');
    const exec = new ClassifiedRetryExecutor({
      sessionManager: sm,
      rateLimiter: limiter,
      sleepFn,
    });

    const result = await exec.execute(op, { operationName: 'rate-limit' });

    expect(result).toBe('ok');
    expect(sleepFn).toHaveBeenCalledWith(expect.any(Number));
    expect(limiter.getPenaltyDelay()).toBe(3000);
  });

  it('403 调用人工介入并继续重试', async () => {
    const sm = createSessionManager();
    const humanFn = vi.fn().mockResolvedValue(undefined);
    const op = vi
      .fn()
      .mockRejectedValueOnce(new BossAPIError('风控', { statusCode: 403 }))
      .mockResolvedValueOnce('ok');
    const exec = new ClassifiedRetryExecutor({
      sessionManager: sm,
      sleepFn,
      onHumanIntervention: humanFn,
    });

    const result = await exec.execute(op, { operationName: 'human' });

    expect(result).toBe('ok');
    expect(humanFn).toHaveBeenCalledTimes(1);
  });

  it('不可重试错误直接抛出', async () => {
    const sm = createSessionManager();
    const op = vi.fn().mockRejectedValue(new Error('unknown boom'));
    const exec = new ClassifiedRetryExecutor({ sessionManager: sm, sleepFn });

    await expect(exec.execute(op, { operationName: 'x' })).rejects.toThrow('unknown boom');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('达到 maxAttempts 仍失败则抛错', async () => {
    const sm = createSessionManager();
    const op = vi.fn().mockRejectedValue(new BossAPIError('5xx', { statusCode: 502 }));
    const exec = new ClassifiedRetryExecutor({
      sessionManager: sm,
      sleepFn,
      maxAttempts: 3,
      baseBackoffMs: 1,
    });

    await expect(exec.execute(op, { operationName: 'server' })).rejects.toBeDefined();
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('每次操作前检查登录态', async () => {
    const sm = createSessionManager();
    const op = vi.fn().mockResolvedValue('ok');
    const exec = new ClassifiedRetryExecutor({ sessionManager: sm, sleepFn });

    await exec.execute(op, { operationName: 'check' });

    expect(sm.checkLoginState).toHaveBeenCalledTimes(1);
  });

  it('默认人工介入处理器不抛错', async () => {
    const sm = createSessionManager();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new BossAPIError('风控', { statusCode: 403 }))
      .mockResolvedValueOnce('ok');
    const exec = new ClassifiedRetryExecutor({ sessionManager: sm, sleepFn });

    const result = await exec.execute(op, { operationName: 'default-human' });
    expect(result).toBe('ok');
  });
});
