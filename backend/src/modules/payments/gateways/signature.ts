import crypto from 'node:crypto';

export const hmacSha256Hex = (secret: string, data: string | Buffer): string =>
  crypto.createHmac('sha256', secret).update(data).digest('hex');

/** Constant-time comparison that also rejects length mismatches without leaking timing. */
export function timingSafeEqualStr(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function verifyHmacSignature(secret: string, data: string | Buffer, signature: string | undefined): boolean {
  if (!secret || !signature) return false;
  return timingSafeEqualStr(hmacSha256Hex(secret, data), signature);
}
