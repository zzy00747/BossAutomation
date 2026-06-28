import fs from 'node:fs';
import path from 'node:path';
import type { IBrowserContext, IPage } from '../../interfaces/browser.js';
import { createChild } from '../../logger.js';
import type { Logger } from 'pino';
import { generateFingerprint } from './fingerprint.js';
import { getQRApis, getSecurityCheckUrl } from './urls.js';
import { getStokenFromSecurityCheck } from './security-check.js';

export interface BossQRLoginServiceOptions {
  page: IPage;
  context: IBrowserContext;
  logger?: Logger;
  qrDir?: string;
}

export interface QRLoginResult {
  success: boolean;
  qrId?: string;
  qrImagePath?: string;
  cookies?: string;
  stoken?: string;
  error?: string;
}

export class BossQRLoginService {
  private page: IPage;
  private context: IBrowserContext;
  private logger: Logger;
  private qrDir: string;
  private cookieJar = new Map<string, string>();

  constructor(options: BossQRLoginServiceOptions) {
    this.page = options.page;
    this.context = options.context;
    this.logger = options.logger ?? createChild('qr-login');
    this.qrDir = options.qrDir ?? 'data/session';
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    headers.set(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    );
    headers.set('Referer', 'https://www.zhipin.com/web/user/?ka=header-login');
    headers.set('Origin', 'https://www.zhipin.com');

    const cookieStr = Array.from(this.cookieJar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieStr) {
      headers.set('Cookie', cookieStr);
    }

    const response = await fetch(url, { ...init, headers });

    // 维护 Cookie Jar
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const pair = raw.split(';')[0];
      const [name, ...rest] = pair.split('=');
      if (name) {
        this.cookieJar.set(name.trim(), rest.join('=').trim());
      }
    }

    return response;
  }

  async getQRId(): Promise<string> {
    const urls = getQRApis();
    const response = await this.request(urls.randkey, { method: 'POST' });
    const data = (await response.json()) as { code: number; message?: string; zpData?: { qrId?: string } };
    if (data.code !== 0 || !data.zpData?.qrId) {
      throw new Error(`获取 qrId 失败: ${data.message ?? '未知错误'}`);
    }
    this.logger.info({ qrId: data.zpData.qrId }, '获取 qrId');
    return data.zpData.qrId;
  }

  async getQRCode(qrId: string): Promise<string> {
    const urls = getQRApis();
    const response = await this.request(`${urls.qrcode}?content=${qrId}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(this.qrDir, { recursive: true });
    const filepath = path.join(this.qrDir, `qrcode_${qrId}.png`);
    fs.writeFileSync(filepath, buffer);
    this.logger.info({ filepath }, '二维码已保存');
    return filepath;
  }

  async waitForScan(qrId: string, timeoutMs = 60_000): Promise<boolean> {
    const urls = getQRApis();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await this.request(`${urls.scan}?uuid=${qrId}`, {
        method: 'GET',
      });
      if (response.status === 200) {
        this.logger.info('扫码成功');
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return false;
  }

  async waitForConfirmation(qrId: string, timeoutMs = 60_000): Promise<boolean> {
    const urls = getQRApis();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await this.request(`${urls.scanLogin}?qrId=${qrId}&status=1`, {
        method: 'GET',
      });
      if (response.status === 200) {
        this.logger.info('用户已确认登录');
        return true;
      }
      if (response.status === 408) {
        this.logger.warn('登录确认超时');
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  async getDispatcherCookie(qrId: string): Promise<string> {
    const urls = getQRApis();
    const fp = generateFingerprint();
    const url = `${urls.dispatcher}?qrId=${qrId}&pk=header-login&fp=${encodeURIComponent(fp)}`;
    const response = await this.request(url, { method: 'GET' });
    this.logger.info({ status: response.status }, 'dispatcher 响应');

    // 优先从浏览器 context 读取真实 Cookie（含 HttpOnly），而不是依赖手工维护的 cookieJar
    const contextCookies = await this.context.cookies('https://www.zhipin.com');
    const cookiePairs: string[] = [];
    for (const c of contextCookies) {
      cookiePairs.push(`${c.name}=${c.value}`);
      this.cookieJar.set(c.name, c.value);
    }

    const jarCookies = Array.from(this.cookieJar.entries())
      .filter(([k]) => !contextCookies.some((c) => c.name === k))
      .map(([k, v]) => `${k}=${v}`);

    return [...cookiePairs, ...jarCookies].join('; ');
  }

  async run(): Promise<QRLoginResult> {
    try {
      const qrId = await this.getQRId();
      const qrImagePath = await this.getQRCode(qrId);

      this.logger.warn('请使用 Boss 直聘 APP 扫描二维码');
      const scanned = await this.waitForScan(qrId);
      if (!scanned) {
        return { success: false, qrId, qrImagePath, error: '扫码超时' };
      }

      const confirmed = await this.waitForConfirmation(qrId);
      if (!confirmed) {
        return { success: false, qrId, qrImagePath, error: '登录确认超时' };
      }

      const cookieStr = await this.getDispatcherCookie(qrId);
      const stoken = await getStokenFromSecurityCheck(
        this.page,
        this.context,
        cookieStr,
        { logger: this.logger },
      );

      return {
        success: true,
        qrId,
        qrImagePath,
        cookies: cookieStr,
        stoken: stoken ?? undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, '二维码登录失败');
      return { success: false, error: message };
    }
  }
}

export { getSecurityCheckUrl };
