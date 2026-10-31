import { createHmac, timingSafeEqual } from 'node:crypto';

export function isValidMercadoPagoSignature(
  signature: string | null,
  requestId: string | null,
  paymentId: string,
  secret: string,
) {
  if (!signature || !requestId) return false;
  const fields = Object.fromEntries(
    signature.split(',').map((part) => {
      const [key, value] = part.trim().split('=');
      return [key, value];
    }),
  );
  if (!fields.ts || !fields.v1 || !/^\d+$/.test(fields.ts)) return false;
  const manifest = `id:${paymentId.toLowerCase()};request-id:${requestId};ts:${fields.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(fields.v1, 'hex');
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
