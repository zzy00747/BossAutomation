import type { IBrowserContext, IPage } from '../../interfaces/browser.js';
import { createChild } from '../../logger.js';
import type { Logger } from 'pino';

export interface SecurityCheckOptions {
  logger?: Logger;
  timeout?: number;
  postLoadDelayMs?: number;
}

export function buildSecurityCheckUrl(): string {
  const params = new URLSearchParams({
    seed: 'ttttZij2JIIK+xUw73+6ZmzsaYKTbDQuIH6OR6Bm54o=',
    name: 'e331459e',
    ts: String(Date.now()),
    callbackUrl: 'https://www.zhipin.com/web/geek/jobs',
  });
  return `https://www.zhipin.com/web/common/security-check.html?${params.toString()}`;
}

export async function getStokenFromSecurityCheck(
  page: IPage,
  context: IBrowserContext,
  initialCookie?: string,
  options: SecurityCheckOptions = {},
): Promise<string | null> {
  const logger = options.logger ?? createChild('security-check');
  const postLoadDelayMs = options.postLoadDelayMs ?? 3000;

  try {
    if (initialCookie) {
      // 将初始 Cookie 设置到浏览器上下文
      const cookies = initialCookie
        .split(';')
        .map((pair) => pair.trim())
        .filter((pair) => pair.includes('='))
        .map((pair) => {
          const [name, ...rest] = pair.split('=');
          return {
            name: name.trim(),
            value: rest.join('=').trim(),
            domain: '.zhipin.com',
            path: '/',
          };
        });

      // IBrowserContext 未暴露 addCookies，通过 evaluate 设置 document.cookie 作为兜底
      if (cookies.length > 0) {
        await page.evaluate<void, string>((cookieStr) => {
          document.cookie = cookieStr;
        }, initialCookie);
      }
    }

    const url = buildSecurityCheckUrl();
    logger.info({ url }, '访问 security-check 页面');
    await page.goto(url, { waitUntil: 'networkidle' });

    // 等待 JS 设置 Cookie
    if (postLoadDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, postLoadDelayMs));
    }

    const jsCookies = await page.evaluate<string, void>(() => document.cookie);
    const contextCookies = await context.cookies('https://www.zhipin.com');

    const allCookies = [
      ...jsCookies.split('; '),
      ...contextCookies.map((c) => `${c.name}=${c.value}`),
    ];

    for (const pair of allCookies) {
      if (pair.startsWith('__zp_stoken__=')) {
        const value = pair.split('=')[1];
        logger.info('成功获取 __zp_stoken__');
        return value;
      }
    }

    logger.warn('未从 security-check 页面获取到 __zp_stoken__');
    return null;
  } catch (err) {
    logger.warn({ err }, 'security-check 获取 stoken 异常');
    return null;
  }
}
