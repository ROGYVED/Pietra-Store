import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { countPendingOrders, findPendingOrderBatch, cancelPendingOrder } from '@/lib/admin-orders';
import { prisma } from '@/lib/prisma';

const BATCH_SIZE = 25;

export async function POST() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const orders = await findPendingOrderBatch(tx, BATCH_SIZE);
      let cancelledCount = 0;
      for (const order of orders) {
        if (await cancelPendingOrder(tx, order, admin.email)) cancelledCount += 1;
      }
      const pendingCount = await countPendingOrders(tx);
      return { cancelledCount, pendingCount };
    }, { isolationLevel: 'Serializable' });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Bulk pending-order cancellation failed:', error);
    return NextResponse.json({ error: 'Não foi possível cancelar os pedidos pendentes. Atualize o painel e tente novamente.' }, { status: 503 });
  }
}
