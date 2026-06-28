import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanOldScreenshots } from '../../../utils/screenshot-cleanup.js';
import { createLogger } from '../../../logger.js';

const silentLogger = createLogger({ level: 'silent', pretty: false });

const DAY = 24 * 60 * 60 * 1000;

describe('cleanOldScreenshots', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-cleanup-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function touchFile(filePath: string, mtimeOffsetMs: number): void {
    fs.writeFileSync(filePath, 'png-bytes'.repeat(10));
    const target = new Date(Date.now() + mtimeOffsetMs);
    fs.utimesSync(filePath, target, target);
  }

  it('删除超过 maxAgeHours 的 .png', async () => {
    const oldFile = path.join(tmpDir, 'old.png');
    const freshFile = path.join(tmpDir, 'fresh.png');
    touchFile(oldFile, -2 * DAY);
    touchFile(freshFile, 0);

    const result = await cleanOldScreenshots(tmpDir, 24, silentLogger);

    expect(result.deleted).toBe(1);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);
  });

  it('保留非 .png 文件', async () => {
    const oldTxt = path.join(tmpDir, 'old.txt');
    touchFile(oldTxt, -10 * DAY);

    const result = await cleanOldScreenshots(tmpDir, 24, silentLogger);

    expect(result.deleted).toBe(0);
    expect(fs.existsSync(oldTxt)).toBe(true);
  });

  it('目录不存在时返回 0', async () => {
    const result = await cleanOldScreenshots(path.join(tmpDir, 'nope'), 24, silentLogger);
    expect(result).toEqual({ deleted: 0, freedBytes: 0 });
  });

  it('递归处理子目录', async () => {
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);
    const oldPng = path.join(subDir, 'old.png');
    const freshPng = path.join(subDir, 'fresh.png');
    touchFile(oldPng, -3 * DAY);
    touchFile(freshPng, 0);

    const result = await cleanOldScreenshots(tmpDir, 24, silentLogger);

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(oldPng)).toBe(false);
    expect(fs.existsSync(freshPng)).toBe(true);
  });

  it('空目录返回 0', async () => {
    const result = await cleanOldScreenshots(tmpDir, 24, silentLogger);
    expect(result).toEqual({ deleted: 0, freedBytes: 0 });
  });

  it('maxAgeHours=0 视为立即过期，删除所有 .png', async () => {
    const a = path.join(tmpDir, 'a.png');
    const b = path.join(tmpDir, 'b.png');
    touchFile(a, -1);
    touchFile(b, -1);
    const result = await cleanOldScreenshots(tmpDir, 0, silentLogger);
    expect(result.deleted).toBe(2);
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(false);
  });
});
