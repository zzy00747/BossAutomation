import { describe, it, expect } from 'vitest';
import { classifyError, ClassifiedError } from '../../../platform/boss/errors.js';
import { BossAPIError } from '../../../platform/boss/api.js';

describe('classifyError', () => {
  it('401 → UNAUTHORIZED / needsAuthRefresh', () => {
    const err = new BossAPIError('未登录', { statusCode: 401, code: 3001 });
    const c = classifyError(err);
    expect(c.type).toBe('UNAUTHORIZED');
    expect(c.needsAuthRefresh).toBe(true);
    expect(c.retryable).toBe(true);
  });

  it('业务码 3001 → UNAUTHORIZED', () => {
    const err = new BossAPIError('未登录', { statusCode: 200, code: 3001 });
    const c = classifyError(err);
    expect(c.type).toBe('UNAUTHORIZED');
    expect(c.needsAuthRefresh).toBe(true);
  });

  it('403 → FORBIDDEN / needsHumanIntervention', () => {
    const err = new BossAPIError('风控', { statusCode: 403 });
    const c = classifyError(err);
    expect(c.type).toBe('FORBIDDEN');
    expect(c.needsHumanIntervention).toBe(true);
    expect(c.retryable).toBe(false);
  });

  it('429 → RATE_LIMITED / retryable', () => {
    const err = new BossAPIError('限流', { statusCode: 429 });
    const c = classifyError(err);
    expect(c.type).toBe('RATE_LIMITED');
    expect(c.retryable).toBe(true);
  });

  it('408 → TIMEOUT / retryable', () => {
    const err = new BossAPIError('超时', { statusCode: 408 });
    expect(classifyError(err).type).toBe('TIMEOUT');
  });

  it('ECONNRESET 错误 → TIMEOUT', () => {
    const err = new Error('read ECONNRESET');
    expect(classifyError(err).type).toBe('TIMEOUT');
  });

  it('5xx → SERVER_ERROR / retryable', () => {
    const err = new BossAPIError('服务端错误', { statusCode: 502 });
    const c = classifyError(err);
    expect(c.type).toBe('SERVER_ERROR');
    expect(c.retryable).toBe(true);
  });

  it('业务码非 0 → BUSINESS_ERROR', () => {
    const err = new BossAPIError('业务错误', { statusCode: 200, code: 1001 });
    const c = classifyError(err);
    expect(c.type).toBe('BUSINESS_ERROR');
    expect(c.retryable).toBe(false);
  });

  it('网络错误 → NETWORK_ERROR', () => {
    const err = new Error('fetch failed: ECONNREFUSED');
    expect(classifyError(err).type).toBe('NETWORK_ERROR');
  });

  it('未知错误 → UNKNOWN', () => {
    const err = new Error('something weird');
    const c = classifyError(err);
    expect(c.type).toBe('UNKNOWN');
    expect(c.retryable).toBe(false);
  });

  it('null 错误 → UNKNOWN', () => {
    const c = classifyError(null);
    expect(c.type).toBe('UNKNOWN');
  });
});

describe('ClassifiedError', () => {
  it('包装分类与原始错误', () => {
    const original = new Error('boom');
    const classified = classifyError(original);
    const wrapped = new ClassifiedError(classified);
    expect(wrapped.classified).toBe(classified);
    expect(wrapped.message).toContain('UNKNOWN');
  });
});
