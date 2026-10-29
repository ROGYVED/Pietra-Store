import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getAdminSession } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

const periods = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
} as const;

export async function GET(request: Request) {
  if (!(await getAdminSession())) {
    return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  }

  const requestedPeriod = new URL(request.url).searchParams.get('period') ?? '30d';
  if (requestedPeriod !== 'all' && !(requestedPeriod in periods)) {
    return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
  }

  const days = requestedPeriod === 'all'
    ? null
    : periods[requestedPeriod as keyof typeof periods];
  const from = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
  const trendFrom = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
  const dateFilter = from ? { createdAt: { gte: from } } : {};
  const paidWhere = { paymentStatus: 'APPROVED' as const, ...dateFilter };
  const periodOrderWhere = { ...dateFilter };

  try {
    const [
      paid,
      pending,
      ordersCount,
      soldItems,
      providerFees,
      topProducts,
      trendRows,
      draftProducts,
      activeProducts,
      lowStockVariants,
    ] = await Promise.all([
      prisma.order.aggregate({
        where: paidWhere,
        _count: { _all: true },
        _sum: { totalCents: true, subtotalCents: true, shippingCents: true },
        _avg: { totalCents: true },
      }),
      prisma.order.aggregate({
        where: { paymentStatus: 'PENDING', ...dateFilter },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      prisma.order.count({ where: periodOrderWhere }),
      prisma.orderItem.aggregate({
        where: { order: { is: paidWhere } },
        _sum: { quantity: true, lineTotalCents: true, lineCostCents: true },
        _count: { lineCostCents: true, _all: true },
      }),
      prisma.payment.aggregate({
        where: { provider: 'mercadopago', status: 'APPROVED', order: { is: paidWhere } },
        _sum: { providerFeeCents: true },
        _count: { providerFeeCents: true, _all: true },
      }),
      prisma.orderItem.groupBy({
        by: ['productName'],
        where: { order: { is: paidWhere } },
        _sum: { quantity: true, lineTotalCents: true, lineCostCents: true },
        _count: { lineCostCents: true, _all: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 8,
      }),
      prisma.$queryRaw<Array<{ day: string; revenue: bigint }>>(Prisma.sql`
        SELECT TO_CHAR(DATE_TRUNC('day', "createdAt"), 'YYYY-MM-DD') AS day,
          COALESCE(SUM("totalCents"), 0)::bigint AS revenue
        FROM "Order"
        WHERE "paymentStatus" = 'APPROVED'
          AND "createdAt" >= ${trendFrom}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY DATE_TRUNC('day', "createdAt")
      `),
      prisma.product.count({ where: { status: 'DRAFT' } }),
      prisma.product.count({ where: { status: 'ACTIVE' } }),
      prisma.productVariant.count({
        where: { active: true, stockQuantity: { gt: 0, lte: 2 }, product: { status: 'ACTIVE' } },
      }),
    ]);

    return NextResponse.json({
      period: requestedPeriod,
      summary: {
        paidOrders: paid._count._all,
        orders: ordersCount,
        paidRevenueCents: paid._sum.totalCents ?? 0,
        merchandiseRevenueCents: paid._sum.subtotalCents ?? 0,
        shippingRevenueCents: paid._sum.shippingCents ?? 0,
        averageOrderCents: Math.round(paid._avg.totalCents ?? 0),
        pendingOrders: pending._count._all,
        pendingRevenueCents: pending._sum.totalCents ?? 0,
        unitsSold: soldItems._sum.quantity ?? 0,
        productCostCents: soldItems._sum.lineCostCents,
        estimatedGrossProfitCents: soldItems._count._all === 0
          ? 0
          : soldItems._count.lineCostCents !== soldItems._count._all || soldItems._sum.lineCostCents === null
            ? null
            : (soldItems._sum.lineTotalCents ?? 0) - soldItems._sum.lineCostCents,
        providerFeeCents: providerFees._sum.providerFeeCents,
        feeCoverage: {
          knownPayments: providerFees._count.providerFeeCents,
          approvedPayments: providerFees._count._all,
        },
        netAfterProductCostAndFeesCents: soldItems._count._all === 0
          ? 0
          : soldItems._count.lineCostCents !== soldItems._count._all ||
              soldItems._sum.lineCostCents === null ||
              providerFees._count.providerFeeCents !== providerFees._count._all ||
              providerFees._sum.providerFeeCents === null
            ? null
            : (soldItems._sum.lineTotalCents ?? 0) -
              soldItems._sum.lineCostCents -
              providerFees._sum.providerFeeCents,
        costCoverage: {
          knownLines: soldItems._count.lineCostCents,
          totalLines: soldItems._count._all,
        },
      },
      topProducts: topProducts.map((item) => ({
        name: item.productName,
        units: item._sum.quantity ?? 0,
        revenueCents: item._sum.lineTotalCents ?? 0,
        costCents: item._sum.lineCostCents,
        costCoverage: { knownLines: item._count.lineCostCents, totalLines: item._count._all },
      })),
      trend: Array.from({ length: 30 }, (_, index) => {
        const date = new Date(trendFrom);
        date.setUTCHours(0, 0, 0, 0);
        date.setUTCDate(date.getUTCDate() + index);
        const day = date.toISOString().slice(0, 10);
        const row = trendRows.find((entry) => entry.day === day);
        return { day, revenueCents: Number(row?.revenue ?? 0) };
      }),
      inventory: { activeProducts, draftProducts, lowStockVariants },
      note: 'Margem bruta estimada com custos registrados nos itens; não inclui taxas do Mercado Pago, impostos, despesas operacionais ou custo de frete.',
    });
  } catch (error) {
    console.error('Admin analytics query failed:', error);
    return NextResponse.json({ error: 'Não foi possível carregar o resumo financeiro.' }, { status: 503 });
  }
}
