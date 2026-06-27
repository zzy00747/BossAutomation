import type { BossErrorClassified, BossErrorType } from '../../types.js';

const BUSINESS_AUTH_CODES = new Set([3001]);

/**
 * 对任意错误分类，供 ClassifiedRetryExecutor 决定刷新/人工/退避策略。
 * 优先识别 BossAPIError（含 statusCode/code），其次识别网络/超时错误。
 */
export function classifyError(error: unknown): BossErrorClassified {
  if (!error) {
    return { type: 'UNKNOWN', retryable: false, needsAuthRefresh: false, needsHumanIntervention: false, original: error };
  }

  const apiErr = error as { statusCode?: number; code?: number; message?: string; name?: string };
  const status = apiErr.statusCode;
  const code = apiErr.code;
  const message = apiErr.message ?? '';
  const name = apiErr.name ?? '';

  if (status === 401 || (typeof code === 'number' && BUSINESS_AUTH_CODES.has(code))) {
    return make('UNAUTHORIZED', { retryable: true, needsAuthRefresh: true, original: error });
  }
  if (status === 403) {
    return make('FORBIDDEN', { retryable: false, needsHumanIntervention: true, original: error });
  }
  if (status === 429) {
    return make('RATE_LIMITED', { retryable: true, original: error });
  }
  if (status === 408 || /ECONNRESET|ETIMEDOUT|socket hang up|timeout/i.test(message + name)) {
    return make('TIMEOUT', { retryable: true, original: error });
  }
  if (typeof status === 'number' && status >= 500 && status < 600) {
    return make('SERVER_ERROR', { retryable: true, original: error });
  }
  if (typeof code === 'number' && code !== 0) {
    // 业务错误是否可重试由具体码决定；默认不重试
    const retryable = BUSINESS_AUTH_CODES.has(code);
    return make('BUSINESS_ERROR', { retryable, needsAuthRefresh: retryable, original: error });
  }
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|network/i.test(message + name)) {
    return make('NETWORK_ERROR', { retryable: true, original: error });
  }

  return make('UNKNOWN', { retryable: false, original: error });
}

function make(
  type: BossErrorType,
  base: Partial<Omit<BossErrorClassified, 'type'>> & { original: unknown },
): BossErrorClassified {
  return {
    type,
    retryable: base.retryable ?? false,
    needsAuthRefresh: base.needsAuthRefresh ?? false,
    needsHumanIntervention: base.needsHumanIntervention ?? false,
    original: base.original,
  };
}

export class ClassifiedError extends Error {
  readonly classified: BossErrorClassified;
  constructor(classified: BossErrorClassified) {
    super(`[${classified.type}] ${(classified.original as Error)?.message ?? ''}`);
    this.name = 'ClassifiedError';
    this.classified = classified;
  }
}
