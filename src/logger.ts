import fs from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import pino from 'pino';

export interface LogErrorContext {
  logger?: pino.Logger;
  url?: string;
  screenshotPath?: string;
  operationName?: string;
  extra?: Record<string, unknown>;
}

export interface LoggerOptions {
  level?: string;
  pretty?: boolean;
  /** File path or writable stream. Defaults to data/logs/app.log. */
  dest?: string | Writable;
}

export function createLogger(options: LoggerOptions = {}): pino.Logger {
  const level = options.level ?? 'info';
  const isDev = process.env.NODE_ENV !== 'production';
  const pretty = options.pretty ?? isDev;

  let destination: pino.DestinationStream;

  if (options.dest && typeof options.dest !== 'string') {
    destination = options.dest as pino.DestinationStream;
  } else {
    const destPath = typeof options.dest === 'string' ? options.dest : undefined;
    const logDir = destPath ? path.dirname(destPath) : 'data/logs';
    const logFile = destPath ?? path.join(logDir, 'app.log');
    fs.mkdirSync(logDir, { recursive: true });
    destination = pino.destination({ dest: logFile, sync: true });
  }

  if (pretty) {
    return pino(
      { level },
      pino.multistream([
        { stream: destination, level },
        {
          level,
          stream: pino.transport({
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          }),
        },
      ]),
    );
  }

  return pino({ level }, destination);
}

export const logger = createLogger();

export function createChild(moduleName: string): pino.Logger {
  return logger.child({ module: moduleName });
}

function extractErrorFields(error: unknown): {
  type: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    type: typeof error,
    message: String(error),
  };
}

export function logError(error: unknown, context?: LogErrorContext): void {
  const fields = extractErrorFields(error);
  const target = context?.logger ?? logger;
  target.error(
    {
      error: fields,
      url: context?.url,
      screenshotPath: context?.screenshotPath,
      operationName: context?.operationName,
      ...context?.extra,
    },
    `操作失败: ${fields.message}`,
  );
}
