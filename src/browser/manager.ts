import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { IBrowserContext, IBrowserDriver, IPage } from '../interfaces/browser.js';
import { createChild } from '../logger.js';
import type { Logger } from 'pino';

export interface BrowserManagerOptions {
  cdpUrl?: string;
  ports?: number[];
  chromePath?: string;
  headless?: boolean;
  userDataDir?: string;
  launchTimeout?: number;
  restartIntervalMs?: number;
  logger?: Logger;
}

async function isEndpointReachable(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function getDefaultChromePath(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32':
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    case 'darwin':
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    case 'linux':
    default:
      return 'google-chrome';
  }
}

export class BrowserManager implements IBrowserDriver {
  private logger: Logger;
  private options: Required<Pick<BrowserManagerOptions, 'ports' | 'launchTimeout' | 'restartIntervalMs'>> &
    BrowserManagerOptions;
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private systemProcess?: ChildProcess;
  private connectedAt = 0;

  constructor(options: BrowserManagerOptions = {}) {
    this.options = {
      ports: options.ports ?? [9222, 9229, 19222],
      launchTimeout: options.launchTimeout ?? 30_000,
      restartIntervalMs: options.restartIntervalMs ?? 60 * 60 * 1000,
      ...options,
    };
    this.logger = options.logger ?? createChild('browser');
  }

  async connect(): Promise<void> {
    if (this.browser?.isConnected()) {
      this.logger.debug('浏览器已连接，跳过 connect');
      return;
    }

    // 1. 尝试显式 CDP_URL
    if (this.options.cdpUrl) {
      this.logger.info({ cdpUrl: this.options.cdpUrl }, '尝试连接指定 CDP');
      if (await this.tryConnectCDP(this.options.cdpUrl)) return;
    }

    // 2. 探测常见端口
    for (const port of this.options.ports) {
      const url = `http://localhost:${port}`;
      this.logger.info({ port }, '探测 CDP 端口');
      if (await isEndpointReachable(`${url}/json/version`, 2000)) {
        if (await this.tryConnectCDP(url)) return;
      }
    }

    // 3. 自动启动系统 Chrome
    const port = 9222;
    try {
      await this.launchSystemChrome(port);
      if (await this.tryConnectCDP(`http://localhost:${port}`)) return;
    } catch (err) {
      this.logger.warn({ err }, '启动系统 Chrome 失败');
    }

    // 4. Fallback 到裸 Chromium
    this.logger.warn('回退到 Playwright 裸 Chromium');
    await this.launchBareChromium();
  }

  async disconnect(): Promise<void> {
    this.logger.info('断开浏览器连接');
    try {
      await this.page?.close().catch(() => {});
      await this.context?.close().catch(() => {});
      await this.browser?.close().catch(() => {});
    } finally {
      this.page = undefined;
      this.context = undefined;
      this.browser = undefined;
      if (this.systemProcess && !this.systemProcess.killed) {
        this.systemProcess.kill('SIGTERM');
      }
      this.systemProcess = undefined;
    }
  }

  async getContext(): Promise<IBrowserContext> {
    await this.ensureFreshConnection();
    if (!this.context) throw new Error('浏览器未连接');
    return this.context as unknown as IBrowserContext;
  }

  async getPage(): Promise<IPage> {
    await this.ensureFreshConnection();
    if (!this.page) throw new Error('浏览器页面未就绪');
    return this.page as unknown as IPage;
  }

  private async ensureFreshConnection(): Promise<void> {
    const shouldRestart =
      this.connectedAt > 0 &&
      Date.now() - this.connectedAt > this.options.restartIntervalMs;
    if (shouldRestart || !this.browser?.isConnected()) {
      this.logger.info('浏览器连接超时或已断开，重新连接');
      await this.disconnect();
      await this.connect();
    }
  }

  private async tryConnectCDP(endpointURL: string): Promise<boolean> {
    try {
      this.browser = await chromium.connectOverCDP({ endpointURL });
      this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
      this.connectedAt = Date.now();
      this.logger.info({ endpointURL }, 'CDP 连接成功');
      return true;
    } catch (err) {
      this.logger.warn({ err, endpointURL }, 'CDP 连接失败');
      return false;
    }
  }

  private async launchSystemChrome(port: number): Promise<void> {
    const chromePath = this.options.chromePath ?? getDefaultChromePath(process.platform);
    const userDataDir = this.options.userDataDir ?? 'data/chrome-profile';
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--disable-infobars',
    ];

    this.logger.info({ chromePath, port }, '启动系统 Chrome');
    this.systemProcess = spawn(chromePath, args, {
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    });

    const deadline = Date.now() + this.options.launchTimeout;
    while (Date.now() < deadline) {
      if (await isEndpointReachable(`http://localhost:${port}/json/version`, 1000)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`等待 Chrome CDP 端口 ${port} 超时`);
  }

  private async launchBareChromium(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.options.headless ?? false,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1366, height: 768 },
    });
    this.page = await this.context.newPage();
    this.connectedAt = Date.now();
    this.logger.info('裸 Chromium 启动成功');
  }
}
