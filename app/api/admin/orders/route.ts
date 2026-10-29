import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAdminSession } from '@/lib/admin-auth';
const statusSchema = z.enum([
  'PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP',
  'COMPLETED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED',
]);

export async function GET(request: Request) {
  if (!(await getAdminSession())) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize')) || 25));
  const search = params.get('search')?.trim().slice(0, 100);
  const rawStatus = params.get('status');
  const status = rawStatus && rawStatus !== 'ALL' ? statusSchema.safeParse(rawStatus) : null;
  if (rawStatus && rawStatus !== 'ALL' && !status?.success) {
    return NextResponse.json({ error: 'Filtro de status inválido.' }, { status: 400 });
  }
  const from = params.get('from');
  const to = params.get('to');
  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : null;
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : null;
  if ((from && (!fromDate || Number.isNaN(fromDate.getTime()))) || (to && (!toDate || Number.isNaN(toDate.getTime())))) {
    return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
  }
  try {
    const where = {
      ...(status?.success ? { status: status.data } : {}),
      ...(fromDate || toDate ? {
        createdAt: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {}),
        },
      } : {}),
      ...(search ? {
        OR: [
          { code: { contains: search, mode: 'insensitive' as const } },
          { customerName: { contains: search, mode: 'insensitive' as const } },
          { customerEmail: { contains: search, mode: 'insensitive' as const } },
          { customerPhone: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        include: {
          items: true,
          payments: { orderBy: { createdAt: 'desc' }, take: 1 },
          events: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.order.count({ where }),
    ]);
    return NextResponse.json({ orders, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
  } catch (error) {
    console.error('Admin orders query failed:', error);
    return NextResponse.json({ error: 'Não foi possível consultar pedidos.' }, { status: 503 });
  }
}
