import { describe, it, expect } from 'vitest';
import {
  generateFingerprint,
  DEFAULT_FP_KEY_BASE64,
  DEFAULT_FP_PLAINTEXT,
} from '../../../platform/boss/fingerprint.js';
import crypto from 'node:crypto';

describe('fingerprint', () => {
  it('generates a base64 string with iv + ciphertext', () => {
    const fp = generateFingerprint();
    expect(fp).toBeTruthy();
    const raw = Buffer.from(fp, 'base64');
    expect(raw.length).toBeGreaterThan(16);
  });

  it('can be decrypted back to plaintext', () => {
    const fp = generateFingerprint(DEFAULT_FP_PLAINTEXT, DEFAULT_FP_KEY_BASE64);
    const raw = Buffer.from(fp, 'base64');
    const iv = raw.subarray(0, 16);
    const ciphertext = raw.subarray(16);
    const key = Buffer.from(DEFAULT_FP_KEY_BASE64, 'base64');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    expect(plaintext).toBe(DEFAULT_FP_PLAINTEXT);
  });

  it('throws when key length is invalid', () => {
    expect(() => generateFingerprint('test', 'aGVsbG8=')).toThrow(/16 bytes/);
  });
});
