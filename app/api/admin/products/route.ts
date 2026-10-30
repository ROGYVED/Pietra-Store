import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  reference: z.string().trim().max(80).optional(),
  sku: z.string().trim().min(1).max(100),
  priceCents: z.number().int().positive(),
  size: z.number().int().min(0).max(43),
  stockQuantity: z.number().int().nonnegative(),
  color: z.string().trim().max(80).optional(),
});

export async function GET() {
  if (!(await getAdminSession())) {
    return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  }

  try {
    const products = await prisma.product.findMany({
      include: {
        category: true,
        images: { orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] },
        variants: { orderBy: { size: 'asc' } },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    return NextResponse.json({ products });
  } catch {
    return NextResponse.json({ error: 'Não foi possível consultar os produtos.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Confira os dados do produto e do estoque.' }, { status: 400 });
  }

  const data = parsed.data;
  const baseSlug = data.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'produto';

  try {
    const product = await prisma.$transaction(async (tx) => {
      let slug = baseSlug;
      if (await tx.product.findUnique({ where: { slug }, select: { id: true } })) {
        const skuSuffix = data.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        slug = `${baseSlug}-${skuSuffix || 'novo'}`;
        if (await tx.product.findUnique({ where: { slug }, select: { id: true } })) {
          throw new Error('DUPLICATE_SLUG');
        }
      }

      const created = await tx.product.create({
        data: {
          name: data.name,
          slug,
          reference: data.reference || null,
          color: data.color || null,
          priceCents: data.priceCents,
          description: '',
          status: 'DRAFT',
          variants: {
            create: {
              sku: data.sku,
              size: data.size,
              stockQuantity: data.stockQuantity,
              inventoryMovements: data.stockQuantity > 0
                ? { create: { type: 'RESTOCK', quantity: data.stockQuantity, note: 'Estoque inicial no cadastro do produto' } }
                : undefined,
            },
          },
        },
        include: { category: true, images: true, variants: true },
      });

      await tx.auditLog.create({
        data: {
          action: 'PRODUCT_CREATE',
          entity: 'Product',
          entityId: created.id,
          metadata: { adminEmail: admin.email, sku: data.sku, stockQuantity: data.stockQuantity },
        },
      });
      return created;
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'DUPLICATE_SLUG') {
      return NextResponse.json({ error: 'Já existe um produto com esse nome e SKU. Altere o SKU e tente novamente.' }, { status: 409 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Já existe um produto com essa referência ou SKU.' }, { status: 409 });
    }
    console.error('Could not create product:', error);
    return NextResponse.json({ error: 'Não foi possível cadastrar o produto.' }, { status: 500 });
  }
}
