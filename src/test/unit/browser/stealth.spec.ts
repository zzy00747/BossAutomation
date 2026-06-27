import { describe, it, expect, vi } from 'vitest';
import { getStealthScripts, applyStealthToPage } from '../../../browser/stealth.js';
import type { IPage } from '../../../interfaces/browser.js';

function createMockPage(): IPage {
  return {
    evaluate: vi.fn().mockResolvedValue(undefined),
  } as unknown as IPage;
}

describe('stealth', () => {
  it('returns scripts covering key anti-detection points', () => {
    const scripts = getStealthScripts();
    const joined = scripts.join('\n');
    expect(joined).toContain('webdriver');
    expect(joined).toContain('plugins');
    expect(joined).toContain('chrome.runtime');
    expect(joined).toContain('Permissions.prototype.query');
    expect(joined).toContain('getImageData');
    expect(joined).toContain('WebGLRenderingContext');
  });

  it('applies all scripts to a page', async () => {
    const page = createMockPage();
    await applyStealthToPage(page);
    expect(page.evaluate).toHaveBeenCalledTimes(getStealthScripts().length);
  });
});
