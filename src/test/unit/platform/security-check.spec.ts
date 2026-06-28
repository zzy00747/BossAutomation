import { describe, it, expect, vi } from 'vitest';
import { getStokenFromSecurityCheck } from '../../../platform/boss/security-check.js';
import { MockBrowserContext, MockPage } from '../../__mocks__/mock-browser.js';

describe('security-check', () => {
  it('extracts __zp_stoken__ from context cookies', async () => {
    const page = new MockPage();
    vi.spyOn(page, 'goto').mockResolvedValue(undefined);
    vi.spyOn(page, 'evaluate').mockResolvedValue('other=1');

    const context = new MockBrowserContext();
    vi.spyOn(context, 'cookies').mockResolvedValue([
      { name: '__zp_stoken__', value: 'stoken-abc' },
    ]);

    const stoken = await getStokenFromSecurityCheck(page, context, undefined, { postLoadDelayMs: 0 });
    expect(stoken).toBe('stoken-abc');
  });

  it('returns null when context cookies lack __zp_stoken__', async () => {
    const page = new MockPage();
    vi.spyOn(page, 'goto').mockResolvedValue(undefined);

    const context = new MockBrowserContext();
    vi.spyOn(context, 'cookies').mockResolvedValue([{ name: 'other', value: '1' }]);

    const stoken = await getStokenFromSecurityCheck(page, context, undefined, { postLoadDelayMs: 0 });
    expect(stoken).toBeNull();
  });
});
