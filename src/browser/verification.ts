import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { IPage } from '../interfaces/browser.js';
import type { VerificationResult } from '../types.js';
import { getConfig } from '../config.js';
import { createChild } from '../logger.js';
import type { Logger } from 'pino';

const VERIFY_SELECTORS = [
  '.verify-wrap',
  '.captcha',
  '.slider-verify',
  '[class*="verify"]',
  '[class*="captcha"]',
];

const VERIFY_KEYWORDS = ['安全验证', '滑动验证', '请完成验证'];

export interface VerificationOptions {
  screenshotDir?: string;
  logger?: Logger;
  prompt?: (message: string) => Promise<void>;
}

export async function checkVerification(
  page: IPage,
  options: VerificationOptions = {},
): Promise<VerificationResult | null> {
  const logger = options.logger ?? createChild('verification');

  try {
    const selectorHit = await page.evaluate<boolean, string[]>((selectors) => {
      return selectors.some((selector) => !!document.querySelector(selector));
    }, VERIFY_SELECTORS);

    const content = await page.content();
    const textHit = VERIFY_KEYWORDS.some((keyword) => content.includes(keyword));

    if (!selectorHit && !textHit) {
      return null;
    }

    const config = getConfig();
    const screenshotDir = options.screenshotDir ?? config.SCREENSHOT_DIR;
    fs.mkdirSync(screenshotDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(screenshotDir, `verification_${timestamp}.png`);
    await page.screenshot({ path: screenshotPath });

    const message = `检测到验证页面，已截图: ${screenshotPath}。请人工完成验证。`;
    logger.warn({ screenshotPath }, message);

    return { needsVerification: true, screenshotPath, message };
  } catch (err) {
    logger.warn({ err }, '验证码检测异常');
    return null;
  }
}

export async function pauseForHumanVerification(
  message: string,
  options: VerificationOptions = {},
): Promise<void> {
  const logger = options.logger ?? createChild('verification');
  const prompt = options.prompt;

  if (prompt) {
    await prompt(message);
    return;
  }

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    await new Promise<void>((resolve) => {
      rl.question(`${message}\n完成后按回车继续: `, () => {
        rl.close();
        resolve();
      });
    });
    return;
  }

  logger.warn(`${message} 非交互环境，等待 5 秒后自动继续...`);
  await new Promise<void>((resolve) => setTimeout(resolve, 5000));
}
