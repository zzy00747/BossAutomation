import type { IPage } from '../interfaces/browser.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomSleep(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return sleep(ms);
}

interface Point {
  x: number;
  y: number;
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function quadraticBezierPoint(t: number, p0: Point, p1: Point, p2: Point): Point {
  const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
  const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
  return { x, y };
}

export interface HumanizedMouseMoveOptions {
  start?: Point;
  steps?: number;
  stepDelayMin?: number;
  stepDelayMax?: number;
  jitter?: number;
  stepSleep?: (ms: number) => Promise<void>;
}

export async function humanizedMouseMove(
  page: IPage,
  targetSelector: string,
  options: HumanizedMouseMoveOptions = {},
): Promise<void> {
  const rect = await page.evaluate<{ x: number; y: number; width: number; height: number }, string>(
    (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`元素未找到: ${selector}`);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    targetSelector,
  );

  const target: Point = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };

  const start: Point = options.start ?? {
    x: randomBetween(0, Math.max(1, target.x)),
    y: randomBetween(0, Math.max(1, target.y)),
  };

  const control: Point = {
    x: (start.x + target.x) / 2 + randomBetween(-50, 50),
    y: (start.y + target.y) / 2 + randomBetween(-50, 50),
  };

  const steps = Math.max(2, options.steps ?? 20);
  const jitter = options.jitter ?? 3;
  const stepDelayMin = options.stepDelayMin ?? 10;
  const stepDelayMax = options.stepDelayMax ?? 20;
  const stepSleep = options.stepSleep ?? sleep;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = quadraticBezierPoint(t, start, control, target);
    const x = Math.round(point.x + randomBetween(-jitter, jitter));
    const y = Math.round(point.y + randomBetween(-jitter, jitter));

    await page.evaluate<void, { x: number; y: number }>((pos) => {
      const event = new MouseEvent('mousemove', {
        clientX: pos.x,
        clientY: pos.y,
        bubbles: true,
      });
      document.dispatchEvent(event);
    }, { x, y });

    if (i < steps) {
      await stepSleep(Math.floor(randomBetween(stepDelayMin, stepDelayMax)));
    }
  }
}

export async function humanizedClick(
  page: IPage,
  selector: string,
  sleepFn: (min: number, max: number) => Promise<void> = randomSleep,
): Promise<void> {
  await sleepFn(200, 800);
  await humanizedMouseMove(page, selector, { stepSleep: () => Promise.resolve() });
  await page.click(selector);
}

export interface HumanizedScrollOptions {
  direction?: 'up' | 'down';
  distance?: number;
  steps?: number;
  sleepFn?: (min: number, max: number) => Promise<void>;
}

export async function humanizedScroll(
  page: IPage,
  options: HumanizedScrollOptions = {},
): Promise<void> {
  const direction = options.direction ?? 'down';
  const distance = options.distance ?? 500;
  const steps = Math.max(1, options.steps ?? 5);
  const stepDistance = direction === 'down' ? distance / steps : -distance / steps;
  const sleepFn = options.sleepFn ?? randomSleep;

  for (let i = 0; i < steps; i++) {
    await page.evaluate<void, number>((dy) => {
      window.scrollBy(0, dy);
    }, stepDistance);
    await sleepFn(300, 1000);
  }
}
