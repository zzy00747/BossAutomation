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

  it('extracts __zp_stoken__ from JS cookies', async () => {
    const page = new MockPage();
    vi.spyOn(page, 'goto').mockResolvedValue(undefined);
    vi.spyOn(page, 'evaluate').mockResolvedValue('__zp_stoken__=stoken-js; other=1');

    const context = new MockBrowserContext();
    vi.spyOn(context, 'cookies').mockResolvedValue([]);

    const stoken = await getStokenFromSecurityCheck(page, context, undefined, { postLoadDelayMs: 0 });
    expect(stoken).toBe('stoken-js');
  });
});
