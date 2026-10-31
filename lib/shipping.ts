import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export type ShippingQuoteClaims = {
  serviceId: string;
  serviceName: string;
  priceCents: number;
  deliveryDays: number;
  postalCode: string;
  itemsHash: string;
  freeShipping?: boolean;
};

export type ShippingQuoteItem = {
  variantId: string;
  quantity: number;
  unitPriceCents: number;
};

export function isAracajuShippingAddress(city: string | null | undefined, state: string | null | undefined) {
  const normalizedCity = (city ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleUpperCase('pt-BR');
  return normalizedCity === 'ARACAJU' && state?.trim().toUpperCase() === 'SE';
}

export async function lookupPostalCodeAddress(postalCode: string) {
  const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`ViaCEP returned ${response.status}`);
  const address = await response.json() as { localidade?: string; uf?: string; erro?: boolean | string };
  if (address.erro) return null;
  return { city: address.localidade ?? '', state: address.uf ?? '' };
}

function quoteSecret() {
  const value = process.env.SHIPPING_QUOTE_SECRET;
  if (!value || value.length < 32) {
    throw new Error('Configure SHIPPING_QUOTE_SECRET com pelo menos 32 caracteres.');
  }
  return new TextEncoder().encode(value);
}

export function hashShippingItems(items: ShippingQuoteItem[], postalCode: string) {
  const canonical = [...items]
    .sort((a, b) => a.variantId.localeCompare(b.variantId))
    .map((item) => `${item.variantId}:${item.quantity}:${item.unitPriceCents}`)
    .join('|');
  return createHash('sha256').update(`${postalCode}:${canonical}`).digest('hex');
}

export async function signShippingQuote(claims: ShippingQuoteClaims) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(quoteSecret());
}

export async function verifyShippingQuote(token: string) {
  const { payload } = await jwtVerify(token, quoteSecret());
  if (
    typeof payload.serviceId !== 'string' ||
    typeof payload.serviceName !== 'string' ||
    typeof payload.priceCents !== 'number' ||
    typeof payload.deliveryDays !== 'number' ||
    typeof payload.postalCode !== 'string' ||
    typeof payload.itemsHash !== 'string' ||
    (payload.freeShipping !== undefined && typeof payload.freeShipping !== 'boolean')
  ) {
    throw new Error('Cotação de frete inválida.');
  }
  return {
    serviceId: payload.serviceId,
    serviceName: payload.serviceName,
    priceCents: payload.priceCents,
    deliveryDays: payload.deliveryDays,
    postalCode: payload.postalCode,
    itemsHash: payload.itemsHash,
    freeShipping: payload.freeShipping === true,
  };
}
