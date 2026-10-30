import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  const { id } = await context.params;
  try {
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id }, select: { id: true, name: true } });
      if (!product) throw new Error('NOT_FOUND');

      await tx.product.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          action: 'PRODUCT_DELETE',
          entity: 'Product',
          entityId: id,
          metadata: { name: product.name, adminEmail: admin.email },
        },
      });
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    }
    console.error('Could not delete product:', error);
    return NextResponse.json({ error: 'Não foi possível excluir o produto.' }, { status: 500 });
  }
}
