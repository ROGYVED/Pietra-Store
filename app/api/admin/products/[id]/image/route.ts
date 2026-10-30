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
  let bytes = new Uint8Array();
  let contentType = '';
  let source: URL | null = null;
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get('image');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Selecione uma foto para enviar.' }, { status: 400 });
    }
    if (file.size > maxBytes) {
      return NextResponse.json({ error: 'Cada foto pode ter no máximo 5 MB.' }, { status: 400 });
    }
    contentType = file.type.toLowerCase();
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const parsed = await request.json().catch(() => null) as { sourceUrl?: unknown } | null;
    if (typeof parsed?.sourceUrl !== 'string') {
      return NextResponse.json({ error: 'Envie uma foto ou informe a URL da foto do fornecedor.' }, { status: 400 });
    }
    try {
      source = new URL(parsed.sourceUrl);
    } catch {
      return NextResponse.json({ error: 'URL da foto inválida.' }, { status: 400 });
    }
    if (source.protocol !== 'https:' || source.hostname !== 'cdn.meucatalogodigital.com' || source.username || source.password) {
      return NextResponse.json({ error: 'A foto precisa estar hospedada no CDN autorizado do fornecedor.' }, { status: 400 });
    }
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
    if (product.images.length >= 5) {
      return NextResponse.json({ error: 'Cada produto pode ter no máximo 5 fotos. Remova uma foto antes de adicionar outra.' }, { status: 400 });
    }

    if (source) {
      const upstream = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!upstream.ok) return NextResponse.json({ error: 'Não foi possível obter a foto no CDN do fornecedor.' }, { status: 502 });
      contentType = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
      const declaredLength = Number(upstream.headers.get('content-length') ?? 0);
      if (!allowedTypes.has(contentType) || declaredLength > maxBytes) {
        return NextResponse.json({ error: 'A foto precisa ser PNG, JPEG ou WebP e ter até 5 MB.' }, { status: 400 });
      }
      bytes = new Uint8Array(await upstream.arrayBuffer());
    }

    if (!allowedTypes.has(contentType)) {
      return NextResponse.json({ error: 'A foto precisa ser PNG, JPEG ou WebP e ter até 5 MB.' }, { status: 400 });
    }
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
      body: Uint8Array.from(bytes).buffer,
      signal: AbortSignal.timeout(15000),
    });
    if (!uploaded.ok) {
      console.error('Supabase Storage upload failed:', uploaded.status);
      return NextResponse.json({ error: 'O Supabase não aceitou a foto. Confira o bucket e as permissões.' }, { status: 502 });
    }

    const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
    try {
      const image = await prisma.$transaction(async (tx) => {
        const currentImages = await tx.productImage.findMany({
          where: { productId: id },
          select: { position: true },
        });
        if (currentImages.length >= 5) throw new Error('IMAGE_LIMIT');
        const isPrimary = source !== null || currentImages.length === 0;
        if (isPrimary) {
          await tx.productImage.updateMany({ where: { productId: id, isPrimary: true }, data: { isPrimary: false } });
        }
        const created = await tx.productImage.create({
          data: {
            productId: id,
            url: publicUrl,
            alt: product.name,
            position: currentImages.reduce((highest, image) => Math.max(highest, image.position), -1) + 1,
            isPrimary,
          },
        });
        await tx.auditLog.create({
          data: {
            action: source ? 'PRODUCT_IMAGE_IMPORT' : 'PRODUCT_IMAGE_UPLOAD',
            entity: 'Product',
            entityId: id,
            metadata: { adminEmail: admin.email, storagePath: objectPath, contentType },
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
      if (error instanceof Error && error.message === 'IMAGE_LIMIT') {
        return NextResponse.json({ error: 'Cada produto pode ter no máximo 5 fotos. Remova uma foto antes de adicionar outra.' }, { status: 400 });
      }
      console.error('Could not save product image:', error);
      return NextResponse.json({ error: 'A foto foi enviada, mas não foi possível vinculá-la ao produto.' }, { status: 500 });
    }
  } catch (error) {
    console.error('Product image import failed:', error);
    return NextResponse.json({ error: 'Não foi possível importar a foto. Tente novamente.' }, { status: 502 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  const { id } = await context.params;
  const parsed = await request.json().catch(() => null) as { imageId?: unknown } | null;
  if (typeof parsed?.imageId !== 'string' || !parsed.imageId) {
    return NextResponse.json({ error: 'Foto inválida.' }, { status: 400 });
  }
  const imageId = parsed.imageId;

  try {
    const image = await prisma.$transaction(async (tx) => {
      const current = await tx.productImage.findFirst({ where: { id: imageId, productId: id } });
      if (!current) throw new Error('NOT_FOUND');
      await tx.productImage.delete({ where: { id: current.id } });
      const remaining = await tx.productImage.findMany({
        where: { productId: id },
        orderBy: { position: 'asc' },
        select: { id: true, isPrimary: true },
      });
      if (remaining.length && !remaining.some((item) => item.isPrimary)) {
        await tx.productImage.update({ where: { id: remaining[0].id }, data: { isPrimary: true } });
      }
      await tx.auditLog.create({
        data: {
          action: 'PRODUCT_IMAGE_DELETE',
          entity: 'Product',
          entityId: id,
          metadata: { adminEmail: admin.email, imageId: current.id },
        },
      });
      return current;
    });

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    let storageCleanupFailed = false;
    if (supabaseUrl && serviceKey && bucket) {
      const publicPrefix = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(bucket)}/`;
      if (image.url.startsWith(publicPrefix)) {
        const objectPath = image.url.slice(publicPrefix.length);
        if (objectPath.startsWith(`products/${id}/`)) {
          const storageUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`;
          try {
            const cleanup = await fetch(storageUrl, {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${serviceKey}`,
                apikey: serviceKey,
              },
              signal: AbortSignal.timeout(10000),
            });
            storageCleanupFailed = !cleanup.ok;
            if (storageCleanupFailed) console.error('Supabase Storage image cleanup failed:', cleanup.status);
          } catch (error) {
            storageCleanupFailed = true;
            console.error('Supabase Storage image cleanup failed:', error);
          }
        }
      }
    }
    return NextResponse.json({ deleted: true, storageCleanupFailed });
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Foto não encontrada.' }, { status: 404 });
    }
    console.error('Could not delete product image:', error);
    return NextResponse.json({ error: 'Não foi possível excluir a foto.' }, { status: 500 });
  }
}
