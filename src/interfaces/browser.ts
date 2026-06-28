import type { PageState } from '../types.js';

export interface ILocator {
  click(options?: Record<string, unknown>): Promise<void>;
  fill(value: string, options?: Record<string, unknown>): Promise<void>;
  textContent(): Promise<string | null>;
  count(): Promise<number>;
}

export interface IPage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  route(
    url: string | RegExp,
    handler: (route: unknown, request: unknown) => void | Promise<void>,
  ): Promise<void>;
  unroute(
    url: string | RegExp,
    handler?: (route: unknown, request: unknown) => void | Promise<void>,
  ): Promise<void>;
  evaluate<T = unknown, Arg = unknown>(
    pageFunction: string | ((arg: Arg) => T),
    arg?: Arg,
  ): Promise<T>;
  click(selector: string, options?: Record<string, unknown>): Promise<void>;
  fill(selector: string, value: string, options?: Record<string, unknown>): Promise<void>;
  screenshot(options?: Record<string, unknown>): Promise<Buffer | string>;
  url(): Promise<string>;
  close(): Promise<void>;
  content(): Promise<string>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  locator(selector: string): ILocator;
}

export interface IBrowserContext {
  cookies(urls?: string | string[]): Promise<Array<{ name: string; value: string; [k: string]: unknown }>>;
  newPage(): Promise<IPage>;
  pages(): Promise<IPage[]>;
  close(): Promise<void>;
}

export interface IBrowserDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getContext(): Promise<IBrowserContext>;
  getPage(): Promise<IPage>;
}

export interface IStateExtractor {
  extractPageState(page: IPage): Promise<PageState>;
}
