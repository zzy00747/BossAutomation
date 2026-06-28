import fs from 'node:fs';
import path from 'node:path';
import { createChild } from '../logger.js';

const logger = createChild('JobIntent');

const DEFAULT_INTENT_PATH = path.resolve(
  process.cwd(),
  'config',
  'job-intent.txt',
);

export interface JobIntentSource {
  filePath?: string;
  envValue?: string;
}

function readIntentFile(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, 'utf8').trim();
    return content || undefined;
  } catch (error) {
    logger.warn({ filePath, error: String(error) }, '读取岗位意图文件失败');
    return undefined;
  }
}

export function loadJobIntent(source: JobIntentSource = {}): string {
  const envValue = source.envValue ?? process.env.JOB_INTENT;
  if (envValue && envValue.trim()) {
    return envValue.trim();
  }

  const filePath = source.filePath ?? DEFAULT_INTENT_PATH;
  const fileContent = readIntentFile(filePath);
  if (fileContent) {
    return fileContent;
  }

  if (envValue !== undefined || source.envValue !== undefined) {
    logger.warn('环境变量 JOB_INTENT 为空且未找到意图文件，使用空意图');
  } else {
    logger.warn({ filePath }, '未找到岗位意图文件，使用空意图');
  }
  return '';
}
