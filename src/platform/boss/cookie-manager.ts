import type { IBrowserContext } from '../../interfaces/browser.js';
import { BOSS_BASE_URL } from './urls.js';

export interface CookieEntry {
  name: string;
  value: string;
  [k: string]: unknown;
}

/**
 * 从 CDP 浏览器 context 自动提取 Boss 直聘 Cookie。
 * __zp_stoken__ 等可能是 HttpOnly，document.cookie 读不到，
 * 必须用 context.cookies() 获取。
 */
export class CookieManager {
  constructor(private context: IBrowserContext) {}

  async getCookies(): Promise<CookieEntry[]> {
    return this.context.cookies(BOSS_BASE_URL);
  }

  async getCookieString(): Promise<string> {
    const cookies = await this.getCookies();
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  async getCookie(name: string): Promise<string | undefined> {
    const cookies = await this.getCookies();
    return cookies.find((c) => c.name === name)?.value;
  }
}

/** 测试与无浏览器场景使用的纯函数版。 */
export function buildCookieString(cookies: CookieEntry[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
