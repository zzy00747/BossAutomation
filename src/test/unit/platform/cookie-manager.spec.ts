import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CookieManager, buildCookieString } from '../../../platform/boss/cookie-manager.js';
import { MockBrowserContext } from '../../__mocks__/mock-browser.js';

describe('CookieManager', () => {
  let context: MockBrowserContext;

  beforeEach(() => {
    context = new MockBrowserContext();
  });

  it('getCookies 调用 context.cookies', async () => {
    const manager = new CookieManager(context);
    const cookies = await manager.getCookies();
    expect(cookies).toEqual([{ name: '__zp_stoken__', value: 'mock-token' }]);
  });

  it('getCookieString 拼接 name=value; ', async () => {
    const manager = new CookieManager(context);
    const str = await manager.getCookieString();
    expect(str).toBe('__zp_stoken__=mock-token');
  });

  it('getCookie 按名查找', async () => {
    const manager = new CookieManager(context);
    expect(await manager.getCookie('__zp_stoken__')).toBe('mock-token');
    expect(await manager.getCookie('not-exist')).toBeUndefined();
  });

  it('多 cookie 用分号空格连接', async () => {
    vi.spyOn(context, 'cookies').mockResolvedValue([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]);
    const manager = new CookieManager(context);
    expect(await manager.getCookieString()).toBe('a=1; b=2');
  });
});

describe('buildCookieString', () => {
  it('空数组返回空字符串', () => {
    expect(buildCookieString([])).toBe('');
  });

  it('拼接多 cookie', () => {
    expect(
      buildCookieString([
        { name: 'x', value: '1' },
        { name: 'y', value: '2' },
      ]),
    ).toBe('x=1; y=2');
  });
});
