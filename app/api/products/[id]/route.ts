import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSession } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';
const updateSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  featured: z.boolean().optional(),
  weightGrams: z.number().int().nonnegative().optional(),
  widthCm: z.number().int().nonnegative().optional(),
  heightCm: z.number().int().nonnegative().optional(),
  lengthCm: z.number().int().nonnegative().optional(),
}).refine((value) => Object.keys(value).length > 0);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const product = await prisma.product.findFirst({ where: { OR: [{ id }, { slug: id }], status: 'ACTIVE' }, include: { category: true, images: { orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] }, variants: { where: { active: true }, orderBy: { size: 'asc' } } } });
    if (!product) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    return NextResponse.json({ product });
  } catch { return NextResponse.json({ error: 'Banco de dados indisponível.' }, { status: 503 }); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });

  const { id } = await context.params;
  try {
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({
        where: { id },
        include: { variants: true },
      });
      if (!current) throw new Error('NOT_FOUND');

      if (
        parsed.data.status === 'ACTIVE' &&
        !current.variants.some((variant) => variant.stockQuantity > variant.reservedQuantity)
      ) {
        throw new Error('NO_STOCK');
      }

      const updated = await tx.product.update({
        where: { id },
        data: parsed.data,
      });
      await tx.auditLog.create({
        data: {
          action: parsed.data.status || parsed.data.featured ? 'PRODUCT_STATUS_CHANGE' : 'PRODUCT_SHIPPING_DIMENSIONS_CHANGE',
          entity: 'Product',
          entityId: id,
          metadata: {
            from: current.status,
            to: parsed.data.status ?? current.status,
            adminEmail: admin.email,
            weightGrams: parsed.data.weightGrams,
            widthCm: parsed.data.widthCm,
            heightCm: parsed.data.heightCm,
            lengthCm: parsed.data.lengthCm,
          },
        },
      });
      return updated;
    });

    return NextResponse.json({ product });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'NOT_FOUND') return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    if (message === 'NO_STOCK') {
      return NextResponse.json({ error: 'Cadastre estoque disponível antes de ativar o produto.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível atualizar o produto.' }, { status: 500 });
  }
}
