import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../../platform/boss/session-manager.js';
import { MockBrowserContext, MockPage } from '../../__mocks__/mock-browser.js';

describe('SessionManager', () => {
  let page: MockPage;
  let context: MockBrowserContext;
  let authService: {
    reconnectCDP: ReturnType<typeof vi.fn>;
    loginWithQR: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    page = new MockPage();
    context = new MockBrowserContext();
    authService = {
      reconnectCDP: vi.fn().mockResolvedValue(false),
      loginWithQR: vi.fn().mockResolvedValue(false),
    };
  });

  function createManager(apiProbe?: () => Promise<boolean>): SessionManager {
    return new SessionManager({
      page,
      context,
      authService,
      apiProbe,
    });
  }

  it('returns cached result within 5 minutes', async () => {
    vi.spyOn(page, 'evaluate').mockResolvedValue(true);
    const manager = createManager();
    const first = await manager.checkLoginState();
    expect(first).toBe(true);

    vi.spyOn(page, 'evaluate').mockResolvedValue(false);
    const second = await manager.checkLoginState();
    expect(second).toBe(true); // cached
  });

  it('uses API probe when DOM check is uncertain', async () => {
    vi.spyOn(page, 'evaluate').mockResolvedValue(false);
    const apiProbe = vi.fn().mockResolvedValue(true);
    const manager = createManager(apiProbe);
    const result = await manager.checkLoginState(true);
    expect(apiProbe).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('refreshes session when not logged in', async () => {
    vi.spyOn(page, 'evaluate').mockResolvedValue(false);
    authService.reconnectCDP.mockResolvedValue(true);
    const manager = createManager(vi.fn().mockResolvedValue(false));
    const result = await manager.checkLoginState(true);
    expect(authService.reconnectCDP).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('falls back to QR login when reconnect and reload fail', async () => {
    vi.spyOn(page, 'evaluate').mockResolvedValue(false);
    authService.reconnectCDP.mockResolvedValue(false);
    authService.loginWithQR.mockResolvedValue(true);
    const manager = createManager(vi.fn().mockResolvedValue(false));
    const result = await manager.checkLoginState(true);
    expect(authService.loginWithQR).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('triggers onExpired callbacks', async () => {
    vi.spyOn(page, 'evaluate').mockResolvedValue(false);
    const callback = vi.fn();
    const manager = createManager();
    manager.onExpired(callback);
    await manager.refreshSession();
    expect(callback).toHaveBeenCalled();
  });
});
