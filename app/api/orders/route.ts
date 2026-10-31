import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createMercadoPagoPreference } from '@/lib/mercado-pago';
import { hashShippingItems, isAracajuShippingAddress, lookupPostalCodeAddress, verifyShippingQuote } from '@/lib/shipping';

const schema = z.object({
  customer: z.object({
    name: z.string().trim().min(2).max(160),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().trim().min(8).max(30),
  }),
  fulfillmentType: z.enum(['LOCAL_DELIVERY', 'NATIONAL_SHIPPING', 'PICKUP']),
  address: z.object({
    cep: z.string().optional(),
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  }).optional(),
  shippingQuoteToken: z.string().min(1).optional(),
  items: z.array(z.object({
    variantId: z.string().min(1),
    quantity: z.number().int().min(1).max(10),
  })).min(1).max(30),
  idempotencyKey: z.string().min(12).max(100).optional(),
});

function releaseOrderReservation(orderId: string, note: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.status === 'CANCELLED' || order.paymentStatus === 'APPROVED') return;

    for (const item of order.items) {
      if (!item.variantId) continue;
      const released = await tx.productVariant.updateMany({
        where: { id: item.variantId, reservedQuantity: { gte: item.quantity } },
        data: { reservedQuantity: { decrement: item.quantity } },
      });
      if (released.count) {
        await tx.inventoryMovement.create({
          data: { variantId: item.variantId, type: 'RELEASE', quantity: item.quantity, referenceId: order.id, note },
        });
      }
    }

    await tx.payment.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'CANCELLED', rawStatus: 'checkout_creation_failed' },
    });
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        paymentStatus: 'CANCELLED',
        events: { create: { event: 'PAYMENT_CREATION_FAILED', note } },
      },
    });
  });
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Confira os dados do pedido.', details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const baseUrl = process.env.NEXT_PUBLIC_STORE_URL;
  if (!accessToken || !baseUrl) {
    return NextResponse.json({ error: 'Checkout indisponível: configure Mercado Pago e a URL pública da loja.' }, { status: 503 });
  }

  if (data.fulfillmentType === 'LOCAL_DELIVERY') {
    return NextResponse.json({ error: 'Entrega local ainda precisa de regras de taxa e área atendida.' }, { status: 400 });
  }
  if (data.fulfillmentType !== 'PICKUP' && (
    !data.address?.cep || !data.address?.city || !data.address?.state || !data.address?.street || !data.address?.number
  )) {
    return NextResponse.json({ error: 'Informe o endereço completo para entrega.' }, { status: 400 });
  }
  const storeSettings = data.fulfillmentType === 'PICKUP'
    ? await prisma.storeSettings.findUnique({ where: { id: 'main' } })
    : null;
  if (data.fulfillmentType === 'PICKUP' && !storeSettings?.pickupAddress) {
    return NextResponse.json({ error: 'A retirada ainda não está configurada pela loja.' }, { status: 400 });
  }

  let shippingCents = 0;
  let shippingName: string | null = null;
  let shippingQuoteItems: { variantId: string; quantity: number; unitPriceCents: number }[] = [];
  let signedItemsHash: string | null = null;
  if (data.fulfillmentType === 'NATIONAL_SHIPPING') {
    if (!data.address?.cep) {
      return NextResponse.json({ error: 'Informe um CEP válido para calcular o frete.' }, { status: 400 });
    }
    const postalCode = data.address.cep.replace(/\D/g, '');
    if (!/^\d{8}$/.test(postalCode)) {
      return NextResponse.json({ error: 'Informe um CEP válido com 8 dígitos.' }, { status: 400 });
    }

    if (!data.shippingQuoteToken) {
      try {
        const postalAddress = await lookupPostalCodeAddress(postalCode);
        if (!postalAddress) {
          return NextResponse.json({ error: 'CEP não encontrado. Confira o endereço e tente novamente.' }, { status: 400 });
        }
        if (!isAracajuShippingAddress(postalAddress.city, postalAddress.state)) {
          return NextResponse.json({ error: 'Calcule e selecione uma opção de frete antes de continuar.' }, { status: 400 });
        }
        shippingName = 'Entrega grátis em Aracaju/SE';
      } catch (error) {
        console.error('Could not validate free shipping postal code:', error);
        return NextResponse.json({ error: 'Não foi possível confirmar o CEP. Tente novamente.' }, { status: 502 });
      }
    } else {
      try {
        const quote = await verifyShippingQuote(data.shippingQuoteToken);
        const variants = await prisma.productVariant.findMany({
          where: { id: { in: data.items.map((item) => item.variantId) } },
          select: { id: true, product: { select: { priceCents: true } } },
        });
        const prices = new Map(variants.map((variant) => [variant.id, variant.product.priceCents]));
        shippingQuoteItems = data.items.map((item) => ({
          ...item,
          unitPriceCents: prices.get(item.variantId) ?? -1,
        }));
        if (
          quote.postalCode !== postalCode ||
          quote.itemsHash !== hashShippingItems(shippingQuoteItems, postalCode) ||
          shippingQuoteItems.some((item) => item.unitPriceCents < 0) ||
          (quote.freeShipping && (
            quote.serviceId !== 'PIETRA_ARACAJU_FREE' ||
            quote.priceCents !== 0 ||
            !isAracajuShippingAddress(data.address.city, data.address.state)
          ))
        ) {
          return NextResponse.json({ error: 'O frete não corresponde ao CEP ou aos itens atuais. Calcule-o novamente.' }, { status: 409 });
        }
        shippingCents = quote.priceCents;
        shippingName = quote.serviceName;
        signedItemsHash = quote.itemsHash;
      } catch (error) {
        return NextResponse.json({
          error: error instanceof Error ? 'Cotação de frete inválida ou expirada. Calcule-a novamente.' : 'Cotação de frete inválida.',
        }, { status: 400 });
      }
    }
  }

  const key = data.idempotencyKey || randomBytes(16).toString('hex');
  let orderId: string | null = null;
  try {
    const existing = await prisma.order.findUnique({
      where: { idempotencyKey: key },
      include: { items: true, payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (existing) {
      const checkoutUrl = existing.payments[0]?.checkoutUrl;
      if (checkoutUrl && existing.status === 'PENDING_PAYMENT') {
        return NextResponse.json({ order: existing, payment: { checkoutUrl }, reused: true });
      }
      return NextResponse.json({ error: 'Esta tentativa de pedido já foi processada. Atualize a sacola e tente novamente.' }, { status: 409 });
    }

    const order = await prisma.$transaction(async (tx) => {
      const lines: Array<{
        variantId: string;
        productId: string;
        productName: string;
        productImage: string | null;
        sku: string;
        size: number;
        color: string | null;
        unitPriceCents: number;
        quantity: number;
        lineTotalCents: number;
        lineCostCents: number | null;
      }> = [];
      let subtotalCents = 0;

      for (const item of data.items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          include: { product: { include: { images: { where: { isPrimary: true }, take: 1 } } } },
        });
        if (!variant || !variant.active || variant.product.status !== 'ACTIVE') throw new Error('PRODUCT_UNAVAILABLE');
        const available = variant.stockQuantity - variant.reservedQuantity;
        if (available < item.quantity) throw new Error(`STOCK:${variant.product.name}:tamanho ${variant.size}`);
        const unitPriceCents = variant.product.priceCents;
        const lineTotalCents = unitPriceCents * item.quantity;
        subtotalCents += lineTotalCents;
        lines.push({
          variantId: variant.id,
          productId: variant.productId,
          productName: variant.product.name,
          productImage: variant.product.images[0]?.url ?? null,
          sku: variant.sku,
          size: variant.size,
          color: variant.color,
          unitPriceCents,
          quantity: item.quantity,
          lineTotalCents,
          lineCostCents: variant.product.costCents === null
            ? null
            : variant.product.costCents * item.quantity,
        });
      }

      if (signedItemsHash && data.address?.cep) {
        const currentHash = hashShippingItems(lines, data.address.cep.replace(/\D/g, ''));
        if (currentHash !== signedItemsHash) throw new Error('SHIPPING_QUOTE_MISMATCH');
      }

      for (const line of lines) {
        const result = await tx.$executeRaw`
          UPDATE "ProductVariant"
          SET "reservedQuantity" = "reservedQuantity" + ${line.quantity}, "updatedAt" = NOW()
          WHERE "id" = ${line.variantId}
            AND "active" = true
            AND ("stockQuantity" - "reservedQuantity") >= ${line.quantity}
        `;
        if (result !== 1) throw new Error(`STOCK:${line.productName}:tamanho ${line.size}`);
      }

      const code = `PT-${Date.now().toString(36).toUpperCase()}-${randomBytes(8).toString('hex').toUpperCase()}`;
      const created = await tx.order.create({
        data: {
          code,
          idempotencyKey: key,
          customerName: data.customer.name,
          customerEmail: data.customer.email || null,
          customerPhone: data.customer.phone,
          shippingAddress: data.fulfillmentType === 'PICKUP'
            ? {
                pickupAddress: storeSettings?.pickupAddress,
                pickupInstructions: storeSettings?.pickupInstructions,
              }
            : data.address,
          fulfillmentType: data.fulfillmentType,
          shippingName,
          shippingCents,
          subtotalCents,
          totalCents: subtotalCents + shippingCents,
          items: { create: lines },
          events: { create: { event: 'ORDER_CREATED', note: 'Pedido criado; aguardando pagamento pelo Mercado Pago.' } },
        },
        include: { items: true },
      });
      for (const line of lines) {
        await tx.inventoryMovement.create({
          data: { variantId: line.variantId, type: 'RESERVATION', quantity: line.quantity, referenceId: created.id, note: 'Reserva ao iniciar pagamento' },
        });
      }
      return created;
    }, { isolationLevel: 'Serializable' });
    orderId = order.id;

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const preference = await createMercadoPagoPreference({
      orderId: order.id,
      orderCode: order.code,
      email: order.customerEmail,
      items: order.items.map((item) => ({
        id: item.variantId ?? item.sku ?? item.id,
        title: `${item.productName}${item.size ? ` - tamanho ${item.size}` : ''}`,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
      shippingCents: order.shippingCents,
      shippingName: order.shippingName,
      expiresAt,
    }, baseUrl, accessToken, key);

    const sandbox = accessToken.startsWith('TEST-');
    const checkoutUrl = sandbox ? preference.sandboxCheckoutUrl ?? preference.checkoutUrl : preference.checkoutUrl;
    const savedOrder = await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: 'mercadopago',
          providerPaymentId: preference.providerPaymentId,
          method: 'checkout_pro',
          status: 'PENDING',
          amountCents: order.totalCents,
          checkoutUrl,
          expiresAt,
          rawStatus: 'preference_created',
        },
      });
      return tx.order.update({
        where: { id: order.id },
        data: { paymentProvider: 'mercadopago', providerPaymentId: preference.providerPaymentId },
        include: { items: true },
      });
    });

    return NextResponse.json({
      order: savedOrder,
      payment: { status: 'PENDING', checkoutUrl, expiresAt },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (orderId) {
      try {
        await releaseOrderReservation(orderId, 'Reserva liberada porque não foi possível iniciar o pagamento.');
      } catch (releaseError) {
        console.error('Could not release reservation after payment setup failure:', releaseError);
      }
    }
    if (message === 'PRODUCT_UNAVAILABLE') return NextResponse.json({ error: 'Um produto não está mais disponível.' }, { status: 409 });
    if (message.startsWith('STOCK:')) return NextResponse.json({ error: `Estoque insuficiente para ${message.slice(6)}.` }, { status: 409 });
    if (message === 'SHIPPING_QUOTE_MISMATCH') return NextResponse.json({ error: 'O preço do produto mudou. Calcule o frete novamente.' }, { status: 409 });
    if (message.includes('Unique constraint')) {
      const existing = await prisma.order.findUnique({ where: { idempotencyKey: key }, include: { items: true } });
      if (existing) return NextResponse.json({ error: 'Esta tentativa de pedido já foi processada. Atualize a sacola e tente novamente.' }, { status: 409 });
    }
    console.error('Order creation failed:', error);
    return NextResponse.json({ error: 'Não foi possível registrar o pedido ou iniciar o pagamento. Tente novamente.' }, { status: 502 });
  }
}
