import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, logError } from '../../logger.js';

class StringWritable extends Writable {
  private chunks: string[] = [];

  _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  output(): string {
    return this.chunks.join('');
  }

  lines(): unknown[] {
    return this.output()
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }
}

describe('logger', () => {
  let stream: StringWritable;

  beforeEach(() => {
    stream = new StringWritable();
  });

  afterEach(() => {
    stream.destroy();
  });

  it('logs info message with msg field', () => {
    const logger = createLogger({ level: 'info', pretty: false, dest: stream });
    logger.info('hello agent');
    const [line] = stream.lines();
    expect(line).toMatchObject({ msg: 'hello agent', level: 30 });
  });

  it('creates child logger with module name', () => {
    const logger = createLogger({ level: 'info', pretty: false, dest: stream });
    const child = logger.child({ module: 'test' });
    child.info('child message');
    const [line] = stream.lines();
    expect(line).toMatchObject({ module: 'test', msg: 'child message' });
  });

  it('logError includes error type and context fields', () => {
    const logger = createLogger({ level: 'info', pretty: false, dest: stream });

    logError(new TypeError('something broke'), {
      logger,
      url: 'https://www.zhipin.com/job/123.html',
      screenshotPath: 'data/logs/screenshots/error.png',
      operationName: 'apply',
    });

    const [line] = stream.lines();
    expect(line).toMatchObject({
      url: 'https://www.zhipin.com/job/123.html',
      screenshotPath: 'data/logs/screenshots/error.png',
      operationName: 'apply',
    });
    expect(line).toHaveProperty('error.type', 'TypeError');
    expect(line).toHaveProperty('error.message', 'something broke');
  });

  it('handles non-Error values in logError', () => {
    const logger = createLogger({ level: 'info', pretty: false, dest: stream });

    logError('plain string error', { logger });
    const [line] = stream.lines();
    expect(line).toHaveProperty('error.type', 'string');
    expect(line).toHaveProperty('error.message', 'plain string error');
  });
});
