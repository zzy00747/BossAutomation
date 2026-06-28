import type { IPage, IBrowserContext } from '../../interfaces/browser.js';
import type { SecurityCheckHandler, SecurityCheckPayload } from '../../interfaces/api.js';
import { createChild } from '../../logger.js';

export interface BrowserSecurityCheckHandlerOptions {
  page: IPage;
  context: IBrowserContext;
  logger?: import('pino').Logger;
  postLoadDelayMs?: number;
}

/**
 * 基于真实浏览器访问 security-check.html 刷新 __zp_stoken__ Cookie。
 */
export class BrowserSecurityCheckHandler implements SecurityCheckHandler {
  private page: IPage;
  private context: IBrowserContext;
  private logger: import('pino').Logger;
  private postLoadDelayMs: number;

  constructor(options: BrowserSecurityCheckHandlerOptions) {
    this.page = options.page;
    this.context = options.context;
    this.logger = options.logger ?? createChild('security-check-handler');
    this.postLoadDelayMs = options.postLoadDelayMs ?? 3000;
  }

  async refreshStoken(payload: SecurityCheckPayload): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        seed: payload.seed,
        name: payload.name,
        ts: String(payload.ts),
        callbackUrl: 'https://www.zhipin.com/web/geek/jobs',
      });
      const url = `https://www.zhipin.com/web/common/security-check.html?${params.toString()}`;
      this.logger.info({ url }, 'code 37 触发，刷新 security-check');

      await this.page.goto(url, { waitUntil: 'networkidle' });
      if (this.postLoadDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.postLoadDelayMs));
      }

      const cookies = await this.context.cookies('https://www.zhipin.com');
      const hasStoken = cookies.some((c) => c.name === '__zp_stoken__');
      this.logger.info({ hasStoken }, '__zp_stoken__ 刷新结果');
      return hasStoken;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message }, 'security-check 刷新失败');
      return false;
    }
  }
}
