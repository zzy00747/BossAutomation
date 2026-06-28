import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserManager } from '../../../browser/manager.js';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn } from 'node:child_process';

vi.mock('playwright', () => {
  const mockPage = {
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
  const mockContext = {
    pages: vi.fn().mockReturnValue([mockPage]),
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(mockPage),
  } as unknown as BrowserContext;
  const mockBrowser = {
    isConnected: vi.fn().mockReturnValue(true),
    contexts: vi.fn().mockReturnValue([mockContext]),
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Browser;

  return {
    chromium: {
      connectOverCDP: vi.fn().mockResolvedValue(mockBrowser),
      launch: vi.fn().mockResolvedValue(mockBrowser),
    },
  };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    killed: false,
    kill: vi.fn(),
  }),
}));

describe('BrowserManager', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('connects via explicit CDP_URL', async () => {
    const manager = new BrowserManager({ cdpUrl: 'http://localhost:9222' });
    await manager.connect();
    expect(vi.mocked(chromium.connectOverCDP)).toHaveBeenCalledWith({
      endpointURL: 'http://localhost:9222',
    });
  });

  it('probes ports when no explicit CDP_URL is set', async () => {
    fetchSpy.mockResolvedValue({ ok: true });
    const manager = new BrowserManager({ ports: [9222] });
    await manager.connect();
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:9222/json/version',
      expect.any(Object),
    );
    expect(vi.mocked(chromium.connectOverCDP)).toHaveBeenCalledWith({
      endpointURL: 'http://localhost:9222',
    });
  });

  it('falls back to bare Chromium when system Chrome launch fails', async () => {
    fetchSpy.mockRejectedValue(new Error('not reachable'));
    const manager = new BrowserManager({ ports: [], launchTimeout: 100 });
    await manager.connect();
    expect(vi.mocked(chromium.launch)).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'],
      }),
    );
  });

  it('returns a page', async () => {
    const manager = new BrowserManager({ cdpUrl: 'http://localhost:9222' });
    await manager.connect();
    const page = await manager.getPage();
    expect(page).toBeDefined();
  });

  it('disconnects and kills system process', async () => {
    const kill = vi.fn();
    vi.mocked(spawn).mockReturnValueOnce({
      killed: false,
      kill,
    } as unknown as ReturnType<typeof spawn>);

    fetchSpy.mockRejectedValue(new Error('not reachable'));
    const manager = new BrowserManager({ ports: [], launchTimeout: 100 });
    await manager.connect();
    await manager.disconnect();
    expect(kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('restartIntervalMs 超时后重新连接', async () => {
    fetchSpy.mockResolvedValue({ ok: true });
    const manager = new BrowserManager({
      cdpUrl: 'http://localhost:9222',
      restartIntervalMs: 1,
    });
    await manager.connect();
    const firstConnectedAt = manager['connectedAt'];

    // 等待超过 restartIntervalMs，触发重连
    await new Promise((r) => setTimeout(r, 5));
    await manager.getPage();

    expect(manager['connectedAt']).toBeGreaterThan(firstConnectedAt);
    expect(vi.mocked(chromium.connectOverCDP)).toHaveBeenCalledTimes(2);
  });

  it('未超时不重连', async () => {
    fetchSpy.mockResolvedValue({ ok: true });
    const manager = new BrowserManager({
      cdpUrl: 'http://localhost:9222',
      restartIntervalMs: 60 * 60 * 1000,
    });
    await manager.connect();
    const firstConnectedAt = manager['connectedAt'];

    await manager.getPage();

    expect(manager['connectedAt']).toBe(firstConnectedAt);
    expect(vi.mocked(chromium.connectOverCDP)).toHaveBeenCalledTimes(1);
  });
});
