import { describe, it, expect, vi } from 'vitest';
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

const noOpSleep = () => Promise.resolve();

describe('human actions', () => {
  it('sleep waits the requested time', async () => {
    const start = Date.now();
    await sleep(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });

  it('humanizedMouseMove dispatches multiple mousemove events', async () => {
    const page = createMockPage();
    await humanizedMouseMove(page, '.job-card', {
      steps: 5,
      stepSleep: noOpSleep,
    });

    const evaluateCalls = vi.mocked(page.evaluate).mock.calls;
    const mouseMoveCalls = evaluateCalls.filter(
      (call) =>
        call[0].toString().includes('MouseEvent') ||
        call[0].toString().includes('mousemove'),
    );
    expect(mouseMoveCalls.length).toBeGreaterThanOrEqual(5);
  });

  it('humanizedClick waits, moves and clicks', async () => {
    const page = createMockPage();
    await humanizedClick(page, '.job-card', noOpSleep as unknown as (min: number, max: number) => Promise<void>);
    expect(page.click).toHaveBeenCalledWith('.job-card');
  });

  it('humanizedScroll scrolls in steps', async () => {
    const page = createMockPage();
    vi.mocked(page.evaluate).mockResolvedValue(undefined);
    await humanizedScroll(page, {
      direction: 'down',
      distance: 500,
      steps: 5,
      sleepFn: noOpSleep as unknown as (min: number, max: number) => Promise<void>,
    });

    const scrollCalls = vi.mocked(page.evaluate).mock.calls.filter((c) =>
      c[0].toString().includes('scrollBy'),
    );
    expect(scrollCalls.length).toBe(5);
  });
});
