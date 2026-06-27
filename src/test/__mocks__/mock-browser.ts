import type {
  IBrowserContext,
  IBrowserDriver,
  ILocator,
  IPage,
} from '../../interfaces/browser.js';

export class MockLocator implements ILocator {
  constructor(_selector: string) {}

  async click(): Promise<void> {}
  async fill(_value: string): Promise<void> {}
  async textContent(): Promise<string | null> {
    return '';
  }
  async count(): Promise<number> {
    return 0;
  }
}

export class MockPage implements IPage {
  private _url = 'https://www.zhipin.com/';
  private eventHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  public evaluateResults: unknown[] = [];

  async goto(url: string): Promise<unknown> {
    this._url = url;
    return null;
  }

  async route(): Promise<void> {}
  async unroute(): Promise<void> {}

  async evaluate<T = unknown, Arg = unknown>(
    pageFunction: (arg: Arg) => T,
    arg?: Arg,
  ): Promise<T> {
    const result = pageFunction(arg as Arg);
    this.evaluateResults.push(result);
    return result;
  }

  async click(): Promise<void> {}
  async fill(): Promise<void> {}

  async screenshot(): Promise<Buffer> {
    return Buffer.from('screenshot');
  }

  async url(): Promise<string> {
    return this._url;
  }

  async close(): Promise<void> {}

  async content(): Promise<string> {
    return '<html></html>';
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    (this.eventHandlers[event] ??= []).push(listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.eventHandlers[event] = (this.eventHandlers[event] ?? []).filter(
      (l) => l !== listener,
    );
  }

  locator(selector: string): ILocator {
    return new MockLocator(selector);
  }

  emit(event: string, ...args: unknown[]): void {
    (this.eventHandlers[event] ?? []).forEach((l) => l(...args));
  }
}

export class MockBrowserContext implements IBrowserContext {
  private pages_: IPage[] = [new MockPage()];

  async cookies(): Promise<Array<{ name: string; value: string }>> {
    return [{ name: '__zp_stoken__', value: 'mock-token' }];
  }

  async newPage(): Promise<IPage> {
    const page = new MockPage();
    this.pages_.push(page);
    return page;
  }

  async pages(): Promise<IPage[]> {
    return this.pages_;
  }

  async close(): Promise<void> {
    this.pages_ = [];
  }
}

export class MockBrowserDriver implements IBrowserDriver {
  private context = new MockBrowserContext();
  public connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getContext(): Promise<IBrowserContext> {
    return this.context;
  }

  async getPage(): Promise<IPage> {
    const pages = await this.context.pages();
    return pages[0] ?? new MockPage();
  }
}
