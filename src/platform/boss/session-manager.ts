import type { IBrowserContext, IPage } from '../../interfaces/browser.js';
import { createChild } from '../../logger.js';
import type { Logger } from 'pino';
import { BOSS_BASE_URL, LOGIN_PAGE_URL, RECOMMEND_JOBS_URL } from './urls.js';
import { LOGIN_CHECK_SELECTORS } from './selectors.js';

export interface AuthServiceLike {
  reconnectCDP(): Promise<boolean>;
  loginWithQR(): Promise<boolean>;
}

export interface SessionManagerOptions {
  page: IPage;
  context: IBrowserContext;
  authService: AuthServiceLike;
  logger?: Logger;
  apiProbe?: () => Promise<boolean>;
}

export class SessionManager {
  private page: IPage;
  private context: IBrowserContext;
  private authService: AuthServiceLike;
  private logger: Logger;
  private apiProbe?: () => Promise<boolean>;
  private state = { isLoggedIn: false, lastCheckedAt: 0 };
  private onExpiredCallbacks: Array<() => void> = [];

  constructor(options: SessionManagerOptions) {
    this.page = options.page;
    this.context = options.context;
    this.authService = options.authService;
    this.logger = options.logger ?? createChild('session');
    this.apiProbe = options.apiProbe;
  }

  async checkLoginState(force = false): Promise<boolean> {
    const cacheValid =
      !force &&
      this.state.lastCheckedAt > 0 &&
      Date.now() - this.state.lastCheckedAt < 5 * 60 * 1000;

    if (cacheValid) {
      this.logger.debug('使用缓存的登录态检查结果');
      return this.state.isLoggedIn;
    }

    let isLoggedIn = await this.checkLoginByDOM();
    if (!isLoggedIn) {
      isLoggedIn = await this.checkLoginByAPI();
    }

    this.state.isLoggedIn = isLoggedIn;
    this.state.lastCheckedAt = Date.now();

    if (!isLoggedIn) {
      this.logger.warn('登录态已失效，尝试自动刷新');
      isLoggedIn = await this.refreshSession();
      this.state.isLoggedIn = isLoggedIn;
      this.state.lastCheckedAt = Date.now();
    }

    return isLoggedIn;
  }

  private async checkLoginByDOM(): Promise<boolean> {
    try {
      const url = await this.page.url();
      if (!url.includes('zhipin.com')) {
        await this.page.goto(LOGIN_PAGE_URL);
      }

      return await this.page.evaluate<boolean, string[]>((selectors) => {
        const body = document.body;
        if (body && body.classList.contains('login')) {
          return false;
        }
        return selectors.some((selector) => !!document.querySelector(selector));
      }, LOGIN_CHECK_SELECTORS);
    } catch (err) {
      this.logger.warn({ err }, 'DOM 登录态检查失败');
      return false;
    }
  }

  private async checkLoginByAPI(): Promise<boolean> {
    if (this.apiProbe) {
      return this.apiProbe();
    }

    try {
      const cookies = await this.context.cookies(BOSS_BASE_URL);
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const url = `${RECOMMEND_JOBS_URL}?page=1&pageSize=1&_=${Date.now()}`;
      const response = await fetch(url, {
        headers: {
          Cookie: cookieStr,
          Referer: BOSS_BASE_URL,
        },
      });

      if (!response.ok) return false;
      const data = (await response.json()) as { code?: number };
      return data.code === 0;
    } catch (err) {
      this.logger.warn({ err }, 'API 登录态探针失败');
      return false;
    }
  }

  async refreshSession(): Promise<boolean> {
    this.logger.info('尝试 CDP 重连刷新登录态');
    if (await this.authService.reconnectCDP()) {
      return true;
    }

    this.logger.info('尝试刷新当前页面');
    await this.page.goto(LOGIN_PAGE_URL, { waitUntil: 'networkidle' });
    if (await this.checkLoginByDOM()) {
      return true;
    }

    this.logger.warn('触发登录过期回调');
    for (const cb of this.onExpiredCallbacks) {
      cb();
    }

    return this.authService.loginWithQR();
  }

  onExpired(callback: () => void): void {
    this.onExpiredCallbacks.push(callback);
  }
}
