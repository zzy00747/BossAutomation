import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BossRequestBuilder } from '../../../platform/boss/request-builder.js';
import { CookieManager } from '../../../platform/boss/cookie-manager.js';
import { MockPage, MockBrowserContext } from '../../__mocks__/mock-browser.js';

describe('BossRequestBuilder', () => {
  let page: MockPage;
  let cookieManager: CookieManager;

  beforeEach(() => {
    page = new MockPage();
    cookieManager = new CookieManager(new MockBrowserContext());
    vi.spyOn(page, 'evaluate').mockResolvedValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0',
    );
  });

  it('包含所有必要请求头字段', async () => {
    const builder = new BossRequestBuilder({ page, cookieManager });
    const headers = await builder.buildHeaders();
    expect(headers['Host']).toBe('www.zhipin.com');
    expect(headers['Origin']).toBe('https://www.zhipin.com');
    expect(headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(headers['Accept']).toBe('application/json, text/plain, */*');
    expect(headers['Accept-Language']).toBe('zh-CN,zh;q=0.9');
    expect(headers['Sec-Fetch-Dest']).toBe('empty');
    expect(headers['Sec-Fetch-Mode']).toBe('cors');
    expect(headers['Sec-Fetch-Site']).toBe('same-origin');
  });

  it('User-Agent 来自浏览器', async () => {
    const builder = new BossRequestBuilder({ page, cookieManager });
    const headers = await builder.buildHeaders();
    expect(headers['User-Agent']).toContain('Chrome/125');
  });

  it('Referer 默认取当前页面 URL', async () => {
    const builder = new BossRequestBuilder({ page, cookieManager });
    vi.spyOn(page, 'url').mockResolvedValue('https://www.zhipin.com/web/recommend');
    const headers = await builder.buildHeaders();
    expect(headers['Referer']).toBe('https://www.zhipin.com/web/recommend');
  });

  it('Referer 可被覆盖', async () => {
    const builder = new BossRequestBuilder({ page, cookieManager });
    const headers = await builder.buildHeaders({ referer: 'https://www.zhipin.com/job_detail/x.html' });
    expect(headers['Referer']).toBe('https://www.zhipin.com/job_detail/x.html');
  });

  it('Cookie 来自 cookieManager', async () => {
    const builder = new BossRequestBuilder({ page, cookieManager });
    const headers = await builder.buildHeaders();
    expect(headers['Cookie']).toBe('__zp_stoken__=mock-token');
  });

  it('Cookie 可被覆盖', async () => {
    const builder = new BossRequestBuilder({ page, cookieManager });
    const headers = await builder.buildHeaders({ cookieString: 'a=1; b=2' });
    expect(headers['Cookie']).toBe('a=1; b=2');
  });

  it('UA 被缓存，仅 evaluate 一次', async () => {
    const builder = new BossRequestBuilder({ page, cookieManager });
    const spy = vi.spyOn(page, 'evaluate');
    await builder.buildHeaders();
    await builder.buildHeaders();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('page.evaluate 失败时使用兜底 UA', async () => {
    vi.spyOn(page, 'evaluate').mockRejectedValue(new Error('page closed'));
    const builder = new BossRequestBuilder({ page, cookieManager });
    const headers = await builder.buildHeaders();
    expect(headers['User-Agent']).toContain('Chrome/125');
  });
});
