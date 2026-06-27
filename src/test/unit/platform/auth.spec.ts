import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BossAuthService } from '../../../platform/boss/auth.js';
import { MockBrowserDriver, MockPage } from '../../__mocks__/mock-browser.js';

describe('BossAuthService', () => {
  let driver: MockBrowserDriver;
  let auth: BossAuthService;
  const originalEnv = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test';
    driver = new MockBrowserDriver();
    auth = new BossAuthService({ browserManager: driver, sessionPath: 'data/session/boss-test.json' });
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalEnv;
  });

  it('detects logged-in state from page evaluation', async () => {
    const page = new MockPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue(true);
    const result = await auth.isLoggedIn(page);
    expect(result).toBe(true);
  });

  it('detects not-logged-in state from page evaluation', async () => {
    const page = new MockPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue(false);
    const result = await auth.isLoggedIn(page);
    expect(result).toBe(false);
  });

  it('navigates to login page when not on zhipin.com', async () => {
    const page = new MockPage();
    page.goto = vi.fn().mockResolvedValue(null);
    vi.spyOn(page, 'url').mockResolvedValue('https://example.com');
    vi.spyOn(page, 'evaluate').mockResolvedValue(true);
    await auth.isLoggedIn(page);
    expect(page.goto).toHaveBeenCalledWith('https://www.zhipin.com/');
  });

  it('loginViaCDP connects and saves session when logged in', async () => {
    await driver.connect();
    const page = await driver.getPage();
    vi.spyOn(page, 'evaluate').mockResolvedValue(true);

    const result = await auth.loginViaCDP();
    expect(result).toBe(true);
    expect(driver.connected).toBe(true);
  });
});
