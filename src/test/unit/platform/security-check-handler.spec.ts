import { describe, it, expect, vi } from 'vitest';
import { BrowserSecurityCheckHandler } from '../../../platform/boss/security-check-handler.js';
import { MockBrowserContext, MockPage } from '../../__mocks__/mock-browser.js';
import type { SecurityCheckPayload } from '../../../interfaces/api.js';

const payload: SecurityCheckPayload = {
  seed: 'ttttZij2JIIK+xUw73+6ZmzsaYKTbDQuIH6OR6Bm54o=',
  name: 'e331459e',
  ts: 1782631991720,
};

describe('BrowserSecurityCheckHandler', () => {
  it('访问 security-check 页面后拿到 __zp_stoken__ 返回 true', async () => {
    const page = new MockPage();
    const gotoSpy = vi.spyOn(page, 'goto').mockResolvedValue(null);
    const context = new MockBrowserContext();
    vi.spyOn(context, 'cookies').mockResolvedValue([
      { name: '__zp_stoken__', value: 'refreshed-token' },
    ]);

    const handler = new BrowserSecurityCheckHandler({
      page,
      context,
      postLoadDelayMs: 0,
    });
    const ok = await handler.refreshStoken(payload);

    expect(ok).toBe(true);
    expect(gotoSpy).toHaveBeenCalledTimes(1);
    const visitedUrl = gotoSpy.mock.calls[0][0] as string;
    expect(visitedUrl).toContain('/web/common/security-check.html');
    expect(visitedUrl).toContain(`seed=${encodeURIComponent(payload.seed)}`);
    expect(visitedUrl).toContain(`name=${payload.name}`);
    expect(visitedUrl).toContain(`ts=${payload.ts}`);
  });

  it('context cookies 缺少 __zp_stoken__ 时返回 false', async () => {
    const page = new MockPage();
    vi.spyOn(page, 'goto').mockResolvedValue(null);
    const context = new MockBrowserContext();
    vi.spyOn(context, 'cookies').mockResolvedValue([{ name: 'other', value: '1' }]);

    const handler = new BrowserSecurityCheckHandler({
      page,
      context,
      postLoadDelayMs: 0,
    });
    const ok = await handler.refreshStoken(payload);
    expect(ok).toBe(false);
  });

  it('page.goto 抛错时捕获异常并返回 false', async () => {
    const page = new MockPage();
    vi.spyOn(page, 'goto').mockRejectedValue(new Error('navigation aborted'));
    const context = new MockBrowserContext();

    const handler = new BrowserSecurityCheckHandler({
      page,
      context,
      postLoadDelayMs: 0,
    });
    const ok = await handler.refreshStoken(payload);
    expect(ok).toBe(false);
  });
});
