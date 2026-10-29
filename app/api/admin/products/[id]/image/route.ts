import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxBytes = 5 * 1024 * 1024;
const extensionByType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function isValidImage(bytes: Uint8Array, contentType: string) {
  if (contentType === 'image/png') {
    return bytes.length >= 8 && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  }
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return contentType === 'image/webp' &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  const { id } = await context.params;
  const parsed = await request.json().catch(() => null) as { sourceUrl?: unknown } | null;
  if (typeof parsed?.sourceUrl !== 'string') {
    return NextResponse.json({ error: 'Informe a URL da foto do fornecedor.' }, { status: 400 });
  }

  let source: URL;
  try {
    source = new URL(parsed.sourceUrl);
  } catch {
    return NextResponse.json({ error: 'URL da foto inválida.' }, { status: 400 });
  }
  if (source.protocol !== 'https:' || source.hostname !== 'cdn.meucatalogodigital.com' || source.username || source.password) {
    return NextResponse.json({ error: 'A foto precisa estar hospedada no CDN autorizado do fornecedor.' }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!supabaseUrl || !serviceKey || !bucket) {
    return NextResponse.json({ error: 'Configure o Supabase Storage no ambiente do servidor.' }, { status: 503 });
  }

  try {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { images: { orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] } },
    });
    if (!product) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });

    const upstream = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) return NextResponse.json({ error: 'Não foi possível obter a foto no CDN do fornecedor.' }, { status: 502 });

    const contentType = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    const declaredLength = Number(upstream.headers.get('content-length') ?? 0);
    if (!allowedTypes.has(contentType) || declaredLength > maxBytes) {
      return NextResponse.json({ error: 'A foto precisa ser PNG, JPEG ou WebP e ter até 5 MB.' }, { status: 400 });
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length > maxBytes || !isValidImage(bytes, contentType)) {
      return NextResponse.json({ error: 'O arquivo recebido não é uma imagem válida ou excede 5 MB.' }, { status: 400 });
    }

    const objectPath = `products/${id}/${randomUUID()}.${extensionByType[contentType]}`;
    const storageUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`;
    const uploaded = await fetch(storageUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body: bytes,
      signal: AbortSignal.timeout(15000),
    });
    if (!uploaded.ok) {
      console.error('Supabase Storage upload failed:', uploaded.status);
      return NextResponse.json({ error: 'O Supabase não aceitou a foto. Confira o bucket e as permissões.' }, { status: 502 });
    }

    const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
    try {
      const position = product.images.reduce((highest, image) => Math.max(highest, image.position), -1) + 1;
      const image = await prisma.$transaction(async (tx) => {
        await tx.productImage.updateMany({ where: { productId: id, isPrimary: true }, data: { isPrimary: false } });
        const created = await tx.productImage.create({
          data: { productId: id, url: publicUrl, alt: product.name, position, isPrimary: true },
        });
        await tx.auditLog.create({
          data: {
            action: 'PRODUCT_IMAGE_IMPORT',
            entity: 'Product',
            entityId: id,
            metadata: { adminEmail: admin.email, storagePath: objectPath },
          },
        });
        return created;
      });
      return NextResponse.json({ image }, { status: 201 });
    } catch (error) {
      const cleanup = await fetch(storageUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        signal: AbortSignal.timeout(10000),
      });
      if (!cleanup.ok) console.error('Supabase Storage cleanup failed:', cleanup.status);
      console.error('Could not save product image:', error);
      return NextResponse.json({ error: 'A foto foi enviada, mas não foi possível vinculá-la ao produto.' }, { status: 500 });
    }
  } catch (error) {
    console.error('Product image import failed:', error);
    return NextResponse.json({ error: 'Não foi possível importar a foto. Tente novamente.' }, { status: 502 });
  }
}
