import type { IPage } from '../../interfaces/browser.js';
import { BOSS_BASE_URL } from './urls.js';
import { CookieManager } from './cookie-manager.js';

export interface BuildHeadersOptions {
  /** 覆盖默认 Referer；默认取当前页面 URL。 */
  referer?: string;
  /** 自定义 Cookie 字符串；默认从 context 提取。 */
  cookieString?: string;
  /** 是否为同源 XHR 请求（默认 true）。 */
  sameOrigin?: boolean;
}

export interface BossRequestBuilderOptions {
  page: IPage;
  cookieManager: CookieManager;
}

/**
 * 构造与浏览器一致的完整请求头，绕过简单反爬。
 * 缺少 Referer / X-Requested-With / Sec-Fetch-* 易被风控 403。
 */
export class BossRequestBuilder {
  private page: IPage;
  private cookieManager: CookieManager;
  private cachedUserAgent?: string;

  constructor(options: BossRequestBuilderOptions) {
    this.page = options.page;
    this.cookieManager = options.cookieManager;
  }

  async buildHeaders(options: BuildHeadersOptions = {}): Promise<Record<string, string>> {
    const cookieString = options.cookieString ?? (await this.cookieManager.getCookieString());
    const referer = options.referer ?? (await this.page.url());
    const userAgent = await this.getUserAgent();

    return {
      Host: 'www.zhipin.com',
      'User-Agent': userAgent,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: referer || BOSS_BASE_URL,
      Origin: BOSS_BASE_URL,
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookieString,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    };
  }

  async getUserAgent(): Promise<string> {
    if (this.cachedUserAgent) return this.cachedUserAgent;
    try {
      const ua = await this.page.evaluate<string>(() => navigator.userAgent);
      this.cachedUserAgent = ua;
      return ua;
    } catch {
      return (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );
    }
  }

  /** 测试用：重置 UA 缓存。 */
  resetUserAgentCache(): void {
    this.cachedUserAgent = undefined;
  }
}
