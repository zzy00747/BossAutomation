import fs from 'node:fs';
import path from 'node:path';
import { createChild } from '../logger.js';

const MS_PER_HOUR = 60 * 60 * 1000;

export interface CleanResult {
  deleted: number;
  freedBytes: number;
}

/**
 * 递归删除修改时间超过 maxAgeHours 的 .png 截图，避免磁盘膨胀。
 */
export async function cleanOldScreenshots(
  screenshotDir: string,
  maxAgeHours: number = 24,
  logger?: import('pino').Logger,
): Promise<CleanResult> {
  const log = logger ?? createChild('screenshot-cleanup');
  if (!fs.existsSync(screenshotDir)) {
    return { deleted: 0, freedBytes: 0 };
  }

  const now = Date.now();
  const maxAgeMs = maxAgeHours * MS_PER_HOUR;
  let deleted = 0;
  let freedBytes = 0;

  const entries = await fs.promises.readdir(screenshotDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(screenshotDir, entry.name);
    if (entry.isDirectory()) {
      const sub = await cleanOldScreenshots(fullPath, maxAgeHours, log);
      deleted += sub.deleted;
      freedBytes += sub.freedBytes;
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png')) {
      continue;
    }
    try {
      const stat = await fs.promises.stat(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        freedBytes += stat.size;
        await fs.promises.unlink(fullPath);
        deleted++;
      }
    } catch (error) {
      log.warn({ err: String(error), file: fullPath }, '删除过期截图失败');
    }
  }

  if (deleted > 0) {
    log.info({ deleted, freedBytes, dir: screenshotDir }, '已清理过期截图');
  }
  return { deleted, freedBytes };
}
