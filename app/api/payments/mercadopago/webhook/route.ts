import { NextResponse } from 'next/server';
import { isValidMercadoPagoSignature } from '@/lib/mercado-pago';
import { prisma } from '@/lib/prisma';

type MercadoPagoPayment = {
  id: number | string;
  status: string;
  status_detail?: string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
  payment_method_id?: string;
  fee_details?: { amount?: number }[];
};

export async function POST(request: Request) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!secret || !accessToken) {
    return NextResponse.json({ error: 'Webhook do Mercado Pago não configurado.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const body = await request.json().catch(() => null) as {
    type?: string;
    action?: string;
    data?: { id?: string | number };
  } | null;
  const eventType = body?.type ?? body?.action?.split('.')[0];
  if (eventType !== 'payment') return NextResponse.json({ received: true });

  const paymentId = String(url.searchParams.get('data.id') ?? body?.data?.id ?? '');
  if (!/^\d+$/.test(paymentId)) return NextResponse.json({ error: 'Identificador de pagamento inválido.' }, { status: 400 });
  if (!isValidMercadoPagoSignature(
    request.headers.get('x-signature'),
    request.headers.get('x-request-id'),
    paymentId,
    secret,
  )) {
    return NextResponse.json({ error: 'Assinatura do webhook inválida.' }, { status: 401 });
  }

  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      console.error('Mercado Pago payment lookup failed:', response.status);
      return NextResponse.json({ error: 'Não foi possível consultar o pagamento.' }, { status: 502 });
    }

    const payment = await response.json() as MercadoPagoPayment;
    if (
      !payment.external_reference ||
      payment.currency_id !== 'BRL' ||
      !Number.isFinite(payment.transaction_amount)
    ) {
      return NextResponse.json({ error: 'Dados de pagamento incompletos.' }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: payment.external_reference },
      include: { items: true, payments: { where: { provider: 'mercadopago' } } },
    });
    if (!order) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    if (Math.round((payment.transaction_amount ?? 0) * 100) !== order.totalCents) {
      return NextResponse.json({ error: 'Valor do pagamento não corresponde ao pedido.' }, { status: 409 });
    }

    const mappedStatus = payment.status === 'approved' ? 'APPROVED'
      : payment.status === 'rejected' ? 'REJECTED'
        : payment.status === 'cancelled' ? 'CANCELLED'
          : payment.status === 'refunded' ? 'REFUNDED'
            : payment.status === 'expired' ? 'EXPIRED'
              : 'PENDING';

    await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id: order.id }, include: { items: true } });
      if (!current) throw new Error('ORDER_NOT_FOUND');
      if (current.paymentStatus === 'REFUNDED') return;
      if (current.paymentStatus === 'APPROVED' && mappedStatus !== 'REFUNDED') return;

      if (mappedStatus === 'REFUNDED') {
        await tx.payment.updateMany({
          where: { orderId: current.id, provider: 'mercadopago', status: { in: ['PENDING', 'APPROVED'] } },
          data: { providerPaymentId: String(payment.id), status: 'REFUNDED', rawStatus: payment.status },
        });
        await tx.order.update({
          where: { id: current.id },
          data: {
            providerPaymentId: String(payment.id),
            paymentStatus: 'REFUNDED',
            status: 'REFUNDED',
            events: { create: { event: 'PAYMENT_REFUNDED', note: 'Reembolso confirmado pelo Mercado Pago.' } },
          },
        });
        return;
      }

      if (current.status === 'CANCELLED') {
        if (mappedStatus === 'APPROVED') {
          await tx.payment.updateMany({
            where: { orderId: current.id, provider: 'mercadopago', status: 'PENDING' },
            data: {
              providerPaymentId: String(payment.id),
              status: 'APPROVED',
              method: payment.payment_method_id ?? 'checkout_pro',
              ...(Array.isArray(payment.fee_details)
                ? {
                    providerFeeCents: Math.round(
                      payment.fee_details.reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0) * 100,
                    ),
                  }
                : {}),
              rawStatus: payment.status,
            },
          });
          await tx.order.update({
            where: { id: current.id },
            data: {
              providerPaymentId: String(payment.id),
              paymentStatus: 'APPROVED',
              status: 'REFUND_PENDING',
              events: { create: { event: 'PAYMENT_APPROVED_AFTER_CANCELLATION', note: 'Pagamento aprovado após cancelamento; verificar reembolso manual.' } },
            },
          });
        }
        return;
      }

      if (current.status !== 'PENDING_PAYMENT' || current.paymentStatus !== 'PENDING') return;

      if (mappedStatus === 'APPROVED') {
        const claimed = await tx.order.updateMany({
          where: { id: current.id, status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' },
          data: { status: 'PAID', paymentStatus: 'APPROVED' },
        });
        if (!claimed.count) return;

        for (const item of current.items) {
          if (!item.variantId) throw new Error('ORDER_VARIANT_MISSING');
          const updated = await tx.productVariant.updateMany({
            where: {
              id: item.variantId,
              stockQuantity: { gte: item.quantity },
              reservedQuantity: { gte: item.quantity },
            },
            data: {
              stockQuantity: { decrement: item.quantity },
              reservedQuantity: { decrement: item.quantity },
            },
          });
          if (updated.count !== 1) throw new Error('RESERVED_STOCK_INCONSISTENT');
          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              type: 'SALE',
              quantity: -item.quantity,
              referenceId: current.id,
              note: `Pagamento aprovado pelo Mercado Pago (${paymentId})`,
            },
          });
        }
      } else if (['REJECTED', 'CANCELLED', 'EXPIRED'].includes(mappedStatus)) {
        const claimed = await tx.order.updateMany({
          where: { id: current.id, status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' },
          data: { status: 'CANCELLED', paymentStatus: mappedStatus },
        });
        if (!claimed.count) return;

        for (const item of current.items) {
          if (!item.variantId) continue;
          const released = await tx.productVariant.updateMany({
            where: { id: item.variantId, reservedQuantity: { gte: item.quantity } },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
          if (released.count) {
            await tx.inventoryMovement.create({
              data: {
                variantId: item.variantId,
                type: 'RELEASE',
                quantity: item.quantity,
                referenceId: current.id,
                note: `Reserva liberada após pagamento ${mappedStatus.toLowerCase()}`,
              },
            });
          }
        }
      }

      const savedPayment = await tx.payment.updateMany({
        where: {
          orderId: current.id,
          provider: 'mercadopago',
          status: 'PENDING',
        },
        data: {
          providerPaymentId: String(payment.id),
          status: mappedStatus,
          method: payment.payment_method_id ?? 'checkout_pro',
          ...(mappedStatus === 'APPROVED' && Array.isArray(payment.fee_details)
            ? {
                providerFeeCents: Math.round(
                  payment.fee_details.reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0) * 100,
                ),
              }
            : {}),
          rawStatus: payment.status_detail ? `${payment.status}:${payment.status_detail}` : payment.status,
        },
      });
      if (!savedPayment.count) throw new Error('PAYMENT_RECORD_MISSING');
      await tx.order.update({
        where: { id: current.id },
        data: {
          providerPaymentId: String(payment.id),
          events: {
            create: {
              event: `PAYMENT_${mappedStatus}`,
              note: `Atualização confirmada pelo Mercado Pago: ${payment.status}.`,
            },
          },
        },
      });
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Mercado Pago webhook processing failed:', error);
    return NextResponse.json({ error: 'Não foi possível processar o evento de pagamento.' }, { status: 500 });
  }
}
