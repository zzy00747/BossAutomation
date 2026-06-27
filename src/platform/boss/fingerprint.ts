import crypto from 'node:crypto';

export const DEFAULT_FP_KEY_BASE64 = 'clRwXUJBK1VKK0k0IWFbbQ==';
export const DEFAULT_FP_PLAINTEXT =
  '8048b8676fb7d3d8952276e6e98e0bde.f2dc7a63c4b0fbfa4b51a07e2710cf83.fef7e750fc3a1e6327e8a880915aee9c.ae00f848beb1aa591d71d5a80dd3bd95';

export function generateFingerprint(
  plaintext: string = DEFAULT_FP_PLAINTEXT,
  keyBase64: string = DEFAULT_FP_KEY_BASE64,
): string {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 16) {
    throw new Error(`AES-128 key must be 16 bytes, got ${key.length}`);
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

export async function extractKeyFromPage(_page: unknown): Promise<string | null> {
  // Fallback：从登录页 JS 动态提取密钥（占位实现）
  return null;
}
