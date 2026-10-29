import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  try {
    const order = await prisma.order.findUnique({
      where: { code },
      select: {
        code: true,
        status: true,
        paymentStatus: true,
        subtotalCents: true,
        shippingCents: true,
        shippingName: true,
        totalCents: true,
        createdAt: true,
      },
    });
    if (!order) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    return NextResponse.json({ order });
  } catch {
    return NextResponse.json({ error: 'Não foi possível consultar o pedido.' }, { status: 503 });
  }
}
