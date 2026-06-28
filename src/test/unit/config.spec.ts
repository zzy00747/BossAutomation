import { beforeEach, describe, expect, it } from 'vitest';
import { getConfig, resetConfig } from '../../config.js';

function setEnv(partial: Record<string, string>): void {
  for (const [key, value] of Object.entries(partial)) {
    process.env[key] = value;
  }
  const extraKeys = Object.keys(partial).filter(
    (key) =>
      key.startsWith('OPENAI') ||
      key.startsWith('ANTHROPIC') ||
      key.startsWith('LLM') ||
      key.startsWith('DRY_RUN') ||
      key.startsWith('MATCH'),
  );
  for (const key of extraKeys) {
    process.env[key] = partial[key];
  }
}

describe('config loading', () => {
  beforeEach(() => {
    resetConfig();
    // Clear env keys that may affect tests；显式置空防止 dotenv 从 .env 重新加载覆盖
    const keysToClear = [
      'DRY_RUN',
      'CDP_URL',
      'LLM_PROVIDER',
      'LLM_MODEL',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'MATCH_SCORE_THRESHOLD',
      'APPLY_DAILY_LIMIT',
      'SCREENSHOT_DIR',
      'DB_PATH',
    ];
    for (const key of keysToClear) {
      delete process.env[key];
    }
    process.env.OPENAI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
  });

  it('uses recommended defaults', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const cfg = getConfig();
    expect(cfg.DRY_RUN).toBe(true);
    expect(cfg.CDP_URL).toBe('http://localhost:9222');
    expect(cfg.LLM_PROVIDER).toBe('openai');
    expect(cfg.LLM_MODEL).toBe('gpt-4o-mini');
    expect(cfg.MATCH_SCORE_THRESHOLD).toBe(75);
    expect(cfg.APPLY_DAILY_LIMIT).toBe(20);
    expect(cfg.DETAIL_CONCURRENCY).toBe(3);
    expect(cfg.SCREENSHOT_DIR).toBe('data/logs/screenshots');
    expect(cfg.DB_PATH).toBe('data/jobs.sqlite');
  });

  it('reads env overrides', () => {
    setEnv({
      DRY_RUN: 'false',
      CDP_URL: 'http://localhost:9333',
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      MATCH_SCORE_THRESHOLD: '80',
      APPLY_DAILY_LIMIT: '50',
      SCREENSHOT_DIR: 'custom/screenshots',
      DB_PATH: 'custom/jobs.sqlite',
    });
    const cfg = getConfig();
    expect(cfg.DRY_RUN).toBe(false);
    expect(cfg.CDP_URL).toBe('http://localhost:9333');
    expect(cfg.LLM_PROVIDER).toBe('anthropic');
    expect(cfg.LLM_MODEL).toBe('claude-sonnet-4-6');
    expect(cfg.MATCH_SCORE_THRESHOLD).toBe(80);
    expect(cfg.APPLY_DAILY_LIMIT).toBe(50);
    expect(cfg.SCREENSHOT_DIR).toBe('custom/screenshots');
    expect(cfg.DB_PATH).toBe('custom/jobs.sqlite');
  });

  it('throws on invalid LLM_PROVIDER', () => {
    setEnv({
      LLM_PROVIDER: 'invalid',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(() => getConfig()).toThrow(/LLM_PROVIDER/);
  });

  it('throws when openai key is missing', () => {
    process.env.OPENAI_API_KEY = '';
    setEnv({ LLM_PROVIDER: 'openai' });
    expect(() => getConfig()).toThrow(/OPENAI_API_KEY/);
  });

  it('throws when anthropic key is missing', () => {
    process.env.ANTHROPIC_API_KEY = '';
    setEnv({ LLM_PROVIDER: 'anthropic' });
    expect(() => getConfig()).toThrow(/ANTHROPIC_API_KEY/);
  });
});
