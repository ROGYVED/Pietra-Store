import type { Prisma } from '@prisma/client';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

export async function cancelPendingOrder(
  tx: Prisma.TransactionClient,
  order: OrderWithItems,
  adminEmail: string,
) {
  const claimed = await tx.order.updateMany({
    where: {
      id: order.id,
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
    },
    data: { status: 'CANCELLED', paymentStatus: 'CANCELLED' },
  });
  if (!claimed.count) return false;

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
          note: 'Reserva liberada ao cancelar pedido pendente',
        },
      });
    }
  }

  await tx.payment.updateMany({
    where: { orderId: order.id, status: 'PENDING' },
    data: { status: 'CANCELLED', rawStatus: 'admin_cancelled' },
  });
  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      event: 'ADMIN_STATUS_CHANGE',
      note: 'PENDING_PAYMENT → CANCELLED: Cancelado pelo administrador.',
    },
  });
  await tx.auditLog.create({
    data: {
      action: 'ORDER_STATUS_CHANGE',
      entity: 'Order',
      entityId: order.id,
      metadata: { from: order.status, to: 'CANCELLED', adminEmail },
    },
  });
  return true;
}

export async function findPendingOrderBatch(tx: Prisma.TransactionClient, batchSize: number) {
  return tx.order.findMany({
    where: { status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' },
    include: { items: true },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });
}

export async function countPendingOrders(tx: Prisma.TransactionClient): Promise<number> {
  return tx.order.count({ where: { status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' } });
}
