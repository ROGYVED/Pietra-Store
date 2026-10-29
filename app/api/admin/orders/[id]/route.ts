import { NextResponse } from 'next/server';
import type { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { getAdminSession } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  status: z.enum(['PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'REFUND_PENDING']),
  note: z.string().max(500).optional(),
});

const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['CANCELLED'],
  PAID: ['PROCESSING', 'READY_FOR_PICKUP', 'REFUND_PENDING'],
  PROCESSING: ['SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED', 'REFUND_PENDING'],
  SHIPPED: ['COMPLETED', 'REFUND_PENDING'],
  READY_FOR_PICKUP: ['COMPLETED', 'REFUND_PENDING'],
  COMPLETED: ['REFUND_PENDING'],
  CANCELLED: [],
  REFUND_PENDING: [],
  REFUNDED: [],
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });

  try {
    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id }, include: { items: true } });
      if (!current) throw new Error('NOT_FOUND');
      if (!allowedTransitions[current.status].includes(parsed.data.status)) throw new Error('INVALID_TRANSITION');
      if (parsed.data.status === 'CANCELLED' && current.paymentStatus === 'APPROVED') {
        throw new Error('REFUND_REQUIRED');
      }
      if (
        ['PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED', 'REFUND_PENDING'].includes(parsed.data.status) &&
        current.paymentStatus !== 'APPROVED'
      ) {
        throw new Error('PAYMENT_REQUIRED');
      }

      const claimed = await tx.order.updateMany({
        where: { id, status: current.status, paymentStatus: current.paymentStatus },
        data: {
          status: parsed.data.status,
          ...(parsed.data.status === 'CANCELLED' ? { paymentStatus: 'CANCELLED' } : {}),
        },
      });
      if (!claimed.count) throw new Error('STATE_CHANGED');

      const updated = await tx.order.update({
        where: { id },
        data: {
          events: {
            create: {
              event: 'ADMIN_STATUS_CHANGE',
              note: `${current.status} → ${parsed.data.status}${parsed.data.note ? `: ${parsed.data.note}` : ''}`,
            },
          },
        },
        include: { items: true },
      });

      if (parsed.data.status === 'CANCELLED' && current.status === 'PENDING_PAYMENT') {
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
                note: 'Reserva liberada ao cancelar pedido pendente',
              },
            });
          }
        }
        await tx.payment.updateMany({
          where: { orderId: current.id, status: 'PENDING' },
          data: { status: 'CANCELLED', rawStatus: 'admin_cancelled' },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'ORDER_STATUS_CHANGE',
          entity: 'Order',
          entityId: id,
          metadata: { from: current.status, to: parsed.data.status, adminEmail: admin.email },
        },
      });
      return updated;
    });
    return NextResponse.json({ order });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const response = message === 'NOT_FOUND' ? { status: 404, error: 'Pedido não encontrado.' }
      : message === 'INVALID_TRANSITION' ? { status: 409, error: 'Esta mudança de status não é permitida para o estado atual do pedido.' }
        : message === 'STATE_CHANGED' ? { status: 409, error: 'O pedido foi atualizado por outro processo. Atualize e tente novamente.' }
        : message === 'REFUND_REQUIRED' ? { status: 409, error: 'Para encerrar um pedido pago, solicite o reembolso pelo provedor de pagamento.' }
          : message === 'PAYMENT_REQUIRED' ? { status: 409, error: 'O pedido só pode avançar após confirmação do pagamento.' }
            : { status: 500, error: 'Não foi possível atualizar o pedido.' };
    return NextResponse.json({ error: response.error }, { status: response.status });
  }
}
