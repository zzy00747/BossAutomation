import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkVerification, pauseForHumanVerification } from '../../../browser/verification.js';
import type { IPage } from '../../../interfaces/browser.js';

function createFakePage(overrides?: Partial<IPage>): IPage {
  return {
    evaluate: vi.fn().mockResolvedValue(false),
    content: vi.fn().mockResolvedValue('<html><body>job list</body></html>'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
    ...overrides,
  } as unknown as IPage;
}

describe('verification', () => {
  const originalEnv = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalEnv;
    }
  });

  it('returns null when no verification elements exist', async () => {
    const page = createFakePage();
    const result = await checkVerification(page);
    expect(result).toBeNull();
  });

  it('detects verification by selector and screenshots', async () => {
    const page = createFakePage({
      evaluate: vi.fn().mockResolvedValue(true),
    });
    const result = await checkVerification(page);
    expect(result?.needsVerification).toBe(true);
    expect(result?.screenshotPath).toContain('verification_');
    expect(page.screenshot).toHaveBeenCalled();
  });

  it('detects verification by text content', async () => {
    const page = createFakePage({
      content: vi.fn().mockResolvedValue('<div>安全验证</div>'),
    });
    const result = await checkVerification(page);
    expect(result?.needsVerification).toBe(true);
  });

  it('pauseForHumanVerification uses custom prompt when provided', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    await pauseForHumanVerification('please verify', { prompt });
    expect(prompt).toHaveBeenCalledWith('please verify');
  });
});
