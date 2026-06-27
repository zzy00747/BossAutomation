import fs from 'node:fs';
import path from 'node:path';
import type { IBrowserContext, IBrowserDriver, IPage } from '../../interfaces/browser.js';
import { createChild } from '../../logger.js';
import type { Logger } from 'pino';
import { BOSS_BASE_URL, LOGIN_PAGE_URL } from './urls.js';
import { LOGIN_CHECK_SELECTORS } from './selectors.js';
import { BossQRLoginService } from './qr-login.js';

export interface BossAuthServiceOptions {
  browserManager: IBrowserDriver;
  sessionPath?: string;
  logger?: Logger;
}

export class BossAuthService {
  private browserManager: IBrowserDriver;
  private sessionPath: string;
  private logger: Logger;

  constructor(options: BossAuthServiceOptions) {
    this.browserManager = options.browserManager;
    this.sessionPath = options.sessionPath ?? 'data/session/boss.json';
    this.logger = options.logger ?? createChild('auth');
  }

  async isLoggedIn(page: IPage): Promise<boolean> {
    const url = await page.url();
    if (!url.includes('zhipin.com')) {
      this.logger.info({ url }, '当前非 Boss 页面，导航到首页检查登录态');
      await page.goto(LOGIN_PAGE_URL);
    }

    const loggedIn = await page.evaluate<boolean, string[]>((selectors) => {
      const body = document.body;
      if (body && body.classList.contains('login')) {
        return false;
      }
      return selectors.some((selector) => !!document.querySelector(selector));
    }, LOGIN_CHECK_SELECTORS);

    this.logger.info({ loggedIn }, '登录态检查完成');
    return loggedIn;
  }

  async loginViaCDP(): Promise<boolean> {
    this.logger.info('通过 CDP 连接浏览器并检查登录态');
    await this.browserManager.connect();
    const page = await this.browserManager.getPage();
    const loggedIn = await this.isLoggedIn(page);

    if (loggedIn) {
      const context = await this.browserManager.getContext();
      await this.saveSession(context);
    } else {
      this.logger.warn('浏览器未登录 Boss 直聘');
    }

    return loggedIn;
  }

  async loginWithQR(): Promise<boolean> {
    this.logger.info('启动二维码登录兜底');
    await this.browserManager.connect();
    const page = await this.browserManager.getPage();
    const context = await this.browserManager.getContext();
    const service = new BossQRLoginService({
      page,
      context,
      logger: this.logger.child({ module: 'qr-login' }),
    });
    const result = await service.run();

    if (result.success && result.cookies) {
      await this.saveCookieString(result.cookies);
      return true;
    }

    this.logger.warn({ error: result.error }, '二维码登录失败');
    return false;
  }

  async saveSession(context: IBrowserContext): Promise<void> {
    const cookies = await context.cookies(BOSS_BASE_URL);
    fs.mkdirSync(path.dirname(this.sessionPath), { recursive: true });
    fs.writeFileSync(
      this.sessionPath,
      JSON.stringify({ cookies, savedAt: Date.now() }, null, 2),
    );
    this.logger.info({ sessionPath: this.sessionPath }, '会话已保存');
  }

  private async saveCookieString(cookieString: string): Promise<void> {
    fs.mkdirSync(path.dirname(this.sessionPath), { recursive: true });
    fs.writeFileSync(
      this.sessionPath,
      JSON.stringify({ cookieString, savedAt: Date.now() }, null, 2),
    );
    this.logger.info({ sessionPath: this.sessionPath }, '二维码登录会话已保存');
  }
}
