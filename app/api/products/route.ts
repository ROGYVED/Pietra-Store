import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAdminSession } from '@/lib/admin-auth';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const category = searchParams.get('category');
    const products = await prisma.product.findMany({ where: { status: 'ACTIVE', ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }, { reference: { contains: q, mode: 'insensitive' as const } }] } : {}), ...(category ? { category: { slug: category } } : {}) }, include: { category: true, images: { orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] }, variants: { where: { active: true }, orderBy: { size: 'asc' } } }, orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }], take: 100 });
    return NextResponse.json({ products });
  } catch { return NextResponse.json({ error: 'Não foi possível consultar os produtos. Verifique a conexão com o banco.' }, { status: 503 }); }
}
const productSchema = z.object({ name: z.string().trim().min(2).max(160), slug: z.string().trim().min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: z.string().max(10000).default(''), shortDescription: z.string().max(500).optional(), categoryId: z.string().optional(), reference: z.string().max(80).optional(), color: z.string().max(80).optional(), material: z.string().max(160).optional(), priceCents: z.number().int().positive(), compareAtCents: z.number().int().positive().optional(), status: z.enum(['DRAFT','ACTIVE','ARCHIVED']).default('DRAFT'), featured: z.boolean().default(false), images: z.array(z.object({url:z.string().url(),alt:z.string().max(300).default(''),position:z.number().int().nonnegative().default(0),isPrimary:z.boolean().default(false)})).max(5).default([]), variants: z.array(z.object({sku:z.string().min(1).max(100),size:z.number().int().min(0).max(43),color:z.string().optional(),stockQuantity:z.number().int().nonnegative(),lowStockThreshold:z.number().int().nonnegative().default(2)})).min(1).max(24) }).refine((data) => data.status !== 'ACTIVE' || data.variants.some((variant) => variant.stockQuantity > 0), { message: 'Cadastre estoque disponível antes de ativar o produto.', path: ['variants'] });
export async function POST(request: Request) {
  if (!(await getAdminSession())) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const parsed = productSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.', details: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;
  try {
    const product = await prisma.product.create({ data: { name:data.name, slug:data.slug, description:data.description, shortDescription:data.shortDescription, categoryId:data.categoryId || null, reference:data.reference || null, color:data.color, material:data.material, priceCents:data.priceCents, compareAtCents:data.compareAtCents, status:data.status, featured:data.featured, images:{create:data.images}, variants:{create:data.variants.map(v=>({...v, inventoryMovements:v.stockQuantity?{create:{type:'RESTOCK',quantity:v.stockQuantity,note:'Estoque inicial no cadastro'}}:undefined}))} }, include:{images:true,variants:true} });
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && error.message.includes('Unique constraint') ? 'Já existe um produto com esse slug, referência ou SKU.' : 'Não foi possível cadastrar o produto.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
