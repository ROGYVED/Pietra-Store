import { createHmac, timingSafeEqual } from 'node:crypto';

type PreferenceItem = {
  id: string;
  title: string;
  quantity: number;
  unitPriceCents: number;
};

type CheckoutPreferenceInput = {
  orderId: string;
  orderCode: string;
  email: string | null;
  items: PreferenceItem[];
  shippingCents: number;
  shippingName: string | null;
  expiresAt: Date;
};

export async function createMercadoPagoPreference(
  input: CheckoutPreferenceInput,
  baseUrl: string,
  accessToken: string,
  idempotencyKey: string,
) {
  const returnUrl = `${baseUrl.replace(/\/$/, '')}/pedido/${encodeURIComponent(input.orderCode)}`;
  const items = input.items.map((item) => ({
    id: item.id,
    title: item.title,
    quantity: item.quantity,
    unit_price: item.unitPriceCents / 100,
    currency_id: 'BRL',
  }));
  if (input.shippingCents > 0) {
    items.push({
      id: 'shipping',
      title: `Frete${input.shippingName ? ` - ${input.shippingName}` : ''}`,
      quantity: 1,
      unit_price: input.shippingCents / 100,
      currency_id: 'BRL',
    });
  }

  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      items,
      payer: input.email ? { email: input.email } : undefined,
      external_reference: input.orderId,
      notification_url: `${baseUrl.replace(/\/$/, '')}/api/payments/mercadopago/webhook`,
      back_urls: {
        success: returnUrl,
        pending: returnUrl,
        failure: returnUrl,
      },
      auto_return: 'approved',
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: input.expiresAt.toISOString(),
      statement_descriptor: 'PIETRA',
    }),
    signal: AbortSignal.timeout(15000),
  });

  const result = await response.json().catch(() => null) as {
    id?: string;
    init_point?: string;
    sandbox_init_point?: string;
  } | null;
  if (!response.ok || !result?.id || !result.init_point) {
    console.error('Mercado Pago preference creation failed:', response.status);
    throw new Error('Não foi possível iniciar o pagamento no Mercado Pago.');
  }
  return {
    providerPaymentId: result.id,
    checkoutUrl: result.init_point,
    sandboxCheckoutUrl: result.sandbox_init_point ?? null,
  };
}

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
