import type { IBrowserContext, IPage } from '../interfaces/browser.js';

export interface PagePoolOptions {
  maxPages?: number;
}

export class PagePool {
  private activePages: IPage[] = [];
  private maxPages: number;

  constructor(
    private context: IBrowserContext,
    options: PagePoolOptions = {},
  ) {
    this.maxPages = options.maxPages ?? 3;
  }

  async acquire(): Promise<IPage> {
    if (this.activePages.length >= this.maxPages) {
      const oldest = this.activePages.shift();
      if (oldest) {
        await oldest.close().catch(() => {});
      }
    }

    const page = await this.context.newPage();
    this.activePages.push(page);
    return page;
  }

  async release(page: IPage): Promise<void> {
    const index = this.activePages.indexOf(page);
    if (index >= 0) {
      this.activePages.splice(index, 1);
    }
    await page.close().catch(() => {});
  }

  async releaseAll(): Promise<void> {
    const pages = this.activePages;
    this.activePages = [];
    await Promise.all(pages.map((page) => page.close().catch(() => {})));
  }

  size(): number {
    return this.activePages.length;
  }
}
