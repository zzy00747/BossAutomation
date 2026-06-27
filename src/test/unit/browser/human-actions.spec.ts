import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IPage } from '../../../interfaces/browser.js';
import {
  sleep,
  humanizedMouseMove,
  humanizedClick,
  humanizedScroll,
} from '../../../browser/human-actions.js';

function createMockPage(): IPage {
  return {
    goto: vi.fn(),
    route: vi.fn(),
    unroute: vi.fn(),
    evaluate: vi.fn().mockResolvedValue({ x: 100, y: 200, width: 50, height: 50 }),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
    url: vi.fn().mockResolvedValue(''),
    close: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(''),
    on: vi.fn(),
    off: vi.fn(),
    locator: vi.fn(),
  } as unknown as IPage;
}

describe('human actions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sleep waits the requested time', async () => {
    const start = Date.now();
    const promise = sleep(50);
    vi.advanceTimersByTime(50);
    await promise;
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });

  it('humanizedMouseMove dispatches multiple mousemove events', async () => {
    const page = createMockPage();
    const promise = humanizedMouseMove(page, '.job-card', { steps: 5 });
    vi.advanceTimersByTime(200);
    await promise;

    const evaluateCalls = vi.mocked(page.evaluate).mock.calls;
    const mouseMoveCalls = evaluateCalls.filter(
      (call) => call[0].toString().includes('MouseEvent') || call[0].toString().includes('mousemove'),
    );
    expect(mouseMoveCalls.length).toBeGreaterThanOrEqual(5);
  });

  it('humanizedClick waits, moves and clicks', async () => {
    const page = createMockPage();
    const promise = humanizedClick(page, '.job-card');
    vi.advanceTimersByTime(2000);
    await promise;

    expect(page.click).toHaveBeenCalledWith('.job-card');
  });

  it('humanizedScroll scrolls in steps', async () => {
    const page = createMockPage();
    vi.mocked(page.evaluate).mockResolvedValue(undefined);
    const promise = humanizedScroll(page, { direction: 'down', distance: 500, steps: 5 });
    vi.advanceTimersByTime(5000);
    await promise;

    const scrollCalls = vi.mocked(page.evaluate).mock.calls.filter((c) =>
      c[0].toString().includes('scrollBy'),
    );
    expect(scrollCalls.length).toBe(5);
  });
});
