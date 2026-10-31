import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashShippingItems, isAracajuShippingAddress, lookupPostalCodeAddress, signShippingQuote } from '@/lib/shipping';

const schema = z.object({
  postalCode: z.string().regex(/^\d{8}$/),
  items: z.array(z.object({
    variantId: z.string().min(1),
    quantity: z.number().int().min(1).max(10),
  })).min(1).max(30),
});

type MelhorEnvioRate = {
  id?: number | string;
  name?: string;
  custom_price?: number | string | null;
  price?: number | string | null;
  custom_delivery_time?: number | string | null;
  delivery_time?: number | string | null;
  error?: string | null;
};

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Informe um CEP válido e os itens do pedido.' }, { status: 400 });

  const token = process.env.MELHORENVIO_TOKEN;
  const originPostalCode = process.env.MELHORENVIO_ORIGIN_POSTAL_CODE?.replace(/\D/g, '');
  const supportEmail = process.env.MELHORENVIO_SUPPORT_EMAIL;
  const quoteSecret = process.env.SHIPPING_QUOTE_SECRET;

  const variantIds = parsed.data.items.map((item) => item.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, active: true, product: { status: 'ACTIVE' } },
    include: { product: true },
  });
  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  for (const item of parsed.data.items) {
    const variant = byId.get(item.variantId);
    if (!variant) return NextResponse.json({ error: 'Um produto não está mais disponível.' }, { status: 409 });
    if (variant.stockQuantity - variant.reservedQuantity < item.quantity) {
      return NextResponse.json({ error: `Estoque insuficiente para ${variant.product.name}.` }, { status: 409 });
    }
  }

  const itemsHash = hashShippingItems(parsed.data.items.map((item) => ({
    ...item,
    unitPriceCents: byId.get(item.variantId)?.product.priceCents ?? 0,
  })), parsed.data.postalCode);

  try {
    const address = await lookupPostalCodeAddress(parsed.data.postalCode);
    if (!address) {
      return NextResponse.json({ error: 'CEP não encontrado. Confira o endereço e tente novamente.' }, { status: 400 });
    }

    if (isAracajuShippingAddress(address.city, address.state)) {
      const claims = {
        serviceId: 'PIETRA_ARACAJU_FREE',
        serviceName: 'Entrega grátis em Aracaju/SE',
        priceCents: 0,
        deliveryDays: 0,
        postalCode: parsed.data.postalCode,
        itemsHash,
        freeShipping: true,
      };
      const signedQuote = quoteSecret && quoteSecret.length >= 32
        ? { token: await signShippingQuote(claims) }
        : {};
      return NextResponse.json({ quotes: [{ ...claims, ...signedQuote }] });
    }
  } catch (error) {
    console.error('CEP location lookup failed:', error);
    return NextResponse.json({ error: 'Não foi possível confirmar a cidade deste CEP. Tente novamente.' }, { status: 502 });
  }

  if (!token || !originPostalCode || !supportEmail) {
    return NextResponse.json({ error: 'Configure o token OAuth, CEP de origem e e-mail de suporte do Melhor Envio.' }, { status: 503 });
  }
  if (!quoteSecret || quoteSecret.length < 32) {
    return NextResponse.json({ error: 'Configure SHIPPING_QUOTE_SECRET com pelo menos 32 caracteres.' }, { status: 503 });
  }
  if (originPostalCode.length !== 8) {
    return NextResponse.json({ error: 'O CEP de origem do Melhor Envio precisa conter 8 dígitos.' }, { status: 503 });
  }

  const products = [];
  for (const item of parsed.data.items) {
    const variant = byId.get(item.variantId);
    if (!variant) return NextResponse.json({ error: 'Um produto não está mais disponível.' }, { status: 409 });
    const { widthCm, heightCm, lengthCm, weightGrams } = variant.product;
    if (widthCm < 1 || heightCm < 1 || lengthCm < 1 || weightGrams < 1) {
      return NextResponse.json({ error: `Cadastre peso e dimensões de envio para ${variant.product.name}.` }, { status: 400 });
    }
    products.push({
      id: variant.id,
      width: widthCm,
      height: heightCm,
      length: lengthCm,
      weight: weightGrams / 1000,
      insurance_value: variant.product.priceCents / 100,
      quantity: item.quantity,
    });
  }

  const baseUrl = process.env.MELHORENVIO_ENV === 'production'
    ? 'https://melhorenvio.com.br'
    : 'https://sandbox.melhorenvio.com.br';
  const serviceIds = process.env.MELHORENVIO_SERVICE_IDS?.split(',').map((id) => id.trim()).filter(Boolean);

  try {
    const response = await fetch(`${baseUrl}/api/v2/me/shipment/calculate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': `Pietra Store (${supportEmail})`,
      },
      body: JSON.stringify({
        from: { postal_code: originPostalCode },
        to: { postal_code: parsed.data.postalCode },
        products,
        options: { receipt: false, own_hand: false },
        ...(serviceIds?.length ? { services: serviceIds.join(',') } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error('Melhor Envio quote failed:', response.status);
      return NextResponse.json({ error: 'O Melhor Envio não conseguiu calcular o frete. Tente novamente.' }, { status: 502 });
    }

    const rates = await response.json() as MelhorEnvioRate[];
    if (!Array.isArray(rates)) {
      return NextResponse.json({ error: 'Resposta inválida recebida do Melhor Envio.' }, { status: 502 });
    }
    const quotes = [];
    for (const rate of rates) {
      if (rate.error || rate.id === undefined || !rate.name) continue;
      const price = Number(rate.custom_price ?? rate.price);
      const deliveryDays = Number(rate.custom_delivery_time ?? rate.delivery_time);
      if (!Number.isFinite(price) || price < 0 || !Number.isInteger(deliveryDays) || deliveryDays < 0) continue;
      const priceCents = Math.round(price * 100);
      const serviceId = String(rate.id);
      const claims = {
        serviceId,
        serviceName: rate.name,
        priceCents,
        deliveryDays,
        postalCode: parsed.data.postalCode,
        itemsHash,
      };
      quotes.push({ ...claims, token: await signShippingQuote(claims) });
    }

    return NextResponse.json({ quotes });
  } catch (error) {
    console.error('Melhor Envio quote request failed:', error);
    return NextResponse.json({ error: 'Não foi possível consultar os fretes. Tente novamente.' }, { status: 502 });
  }
}
