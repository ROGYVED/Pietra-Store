import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSession } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  status: z.enum(['ACTIVE', 'DRAFT']),
});

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Ação de catálogo inválida.' }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (parsed.data.status === 'DRAFT') {
        const updated = await tx.product.updateMany({
          where: { status: 'ACTIVE' },
          data: { status: 'DRAFT' },
        });
        await tx.auditLog.create({
          data: {
            action: 'PRODUCT_BULK_UNPUBLISH',
            entity: 'Product',
            metadata: { affectedCount: updated.count, adminEmail: admin.email },
          },
        });
        return { affectedCount: updated.count, eligibleCount: updated.count };
      }

      const candidates = await tx.product.findMany({
        where: { status: { in: ['DRAFT', 'ACTIVE'] } },
        select: {
          id: true,
          variants: {
            where: { active: true },
            select: { stockQuantity: true, reservedQuantity: true },
          },
        },
      });
      const eligibleIds = candidates
        .filter((product) => product.variants.some(
          (variant) => variant.stockQuantity > variant.reservedQuantity,
        ))
        .map((product) => product.id);

      const updated = eligibleIds.length
        ? await tx.product.updateMany({
            where: { id: { in: eligibleIds }, status: 'DRAFT' },
            data: { status: 'ACTIVE' },
          })
        : { count: 0 };
      await tx.auditLog.create({
        data: {
          action: 'PRODUCT_BULK_PUBLISH',
          entity: 'Product',
          metadata: {
            affectedCount: updated.count,
            eligibleCount: eligibleIds.length,
            adminEmail: admin.email,
          },
        },
      });
      return { affectedCount: updated.count, eligibleCount: eligibleIds.length };
    }, { isolationLevel: 'Serializable' });

    return NextResponse.json({ ...result, status: parsed.data.status });
  } catch (error) {
    console.error('Bulk product status update failed:', error);
    return NextResponse.json({ error: 'Não foi possível atualizar o catálogo em lote.' }, { status: 503 });
  }
}
