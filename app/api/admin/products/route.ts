import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

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
