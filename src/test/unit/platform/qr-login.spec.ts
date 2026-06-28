import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BossQRLoginService } from '../../../platform/boss/qr-login.js';
import { MockBrowserContext, MockPage } from '../../__mocks__/mock-browser.js';

describe('BossQRLoginService', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockResponse(body: unknown, headers?: HeadersInit, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  it('getQRId returns qrId from randkey API', async () => {
    fetchSpy.mockResolvedValue(mockResponse({ code: 0, zpData: { qrId: 'qr-123' } }));
    const service = new BossQRLoginService({ page: new MockPage(), context: new MockBrowserContext() });
    const qrId = await service.getQRId();
    expect(qrId).toBe('qr-123');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/wapi/zppassport/captcha/randkey'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getDispatcherCookie builds URL with fp parameter', async () => {
    fetchSpy.mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { 'Set-Cookie': 'wt2=abc123; Path=/' },
      }),
    );
    const service = new BossQRLoginService({ page: new MockPage(), context: new MockBrowserContext() });
    const cookies = await service.getDispatcherCookie('qr-123');
    expect(cookies).toContain('wt2=abc123');
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('qrId=qr-123');
    expect(url).toContain('pk=header-login');
    expect(url).toContain('fp=');
  });

  it('getDispatcherCookie 在 Set-Cookie 为空时仍从 context 读取 HttpOnly cookie', async () => {
    // dispatcher 响应不带 Set-Cookie（手工 cookieJar 为空），但浏览器 context 已有登录态 Cookie
    fetchSpy.mockResolvedValue(new Response('', { status: 302 }));

    const context = new MockBrowserContext();
    vi.spyOn(context, 'cookies').mockResolvedValue([
      { name: 'wt2', value: 'HttpOnly-token' },
      { name: '__zp_stoken__', value: 'stoken-from-context' },
    ]);

    const service = new BossQRLoginService({ page: new MockPage(), context });
    const cookies = await service.getDispatcherCookie('qr-123');

    expect(cookies).toContain('wt2=HttpOnly-token');
    expect(cookies).toContain('__zp_stoken__=stoken-from-context');
    expect(cookies.length).toBeGreaterThan(0);
  });
});
