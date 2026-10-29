import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization') ?? '';
  if (!secret || !authorization.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 401 });

  const now = new Date();
  const expired = await prisma.order.findMany({
    where: {
      status: 'PENDING_PAYMENT',
      payments: { some: { status: 'PENDING', expiresAt: { lte: now } } },
    },
    select: { id: true },
    take: 100,
  });
  let cancelled = 0;

  for (const candidate of expired) {
    try {
      const didExpire = await prisma.$transaction(async (tx) => {
        const orderClaim = await tx.order.updateMany({
          where: { id: candidate.id, status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' },
          data: { status: 'CANCELLED', paymentStatus: 'EXPIRED' },
        });
        if (!orderClaim.count) return false;

        const payment = await tx.payment.updateMany({
          where: { orderId: candidate.id, status: 'PENDING', expiresAt: { lte: now } },
          data: { status: 'EXPIRED', rawStatus: 'checkout_expired' },
        });
        if (!payment.count) throw new Error('PAYMENT_NOT_EXPIRED');

        const order = await tx.order.findUnique({ where: { id: candidate.id }, include: { items: true } });
        if (!order) throw new Error('ORDER_NOT_FOUND');

        for (const item of order.items) {
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
                referenceId: order.id,
                note: 'Reserva liberada após expiração do checkout',
              },
            });
          }
        }

        await tx.order.update({
          where: { id: order.id },
          data: {
            events: { create: { event: 'PAYMENT_EXPIRED', note: 'Reserva liberada após expiração do checkout.' } },
          },
        });
        return true;
      });
      if (didExpire) cancelled += 1;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'PAYMENT_NOT_EXPIRED') {
        console.error(`Could not expire order ${candidate.id}:`, error);
      }
    }
  }

  return NextResponse.json({ expiredOrders: cancelled });
}
