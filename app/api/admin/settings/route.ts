import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSession } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  pickupAddress: z.string().trim().max(500).optional().or(z.literal('')),
  pickupInstructions: z.string().trim().max(1000).optional().or(z.literal('')),
});

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  try {
    const settings = await prisma.storeSettings.findUnique({ where: { id: 'main' } });
    return NextResponse.json({
      pickupAddress: settings?.pickupAddress ?? '',
      pickupInstructions: settings?.pickupInstructions ?? '',
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível consultar as configurações.' }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Confira o endereço e as instruções de retirada.' }, { status: 400 });

  try {
    const settings = await prisma.$transaction(async (tx) => {
      const updated = await tx.storeSettings.upsert({
        where: { id: 'main' },
        update: {
          pickupAddress: parsed.data.pickupAddress?.trim() || null,
          pickupInstructions: parsed.data.pickupInstructions?.trim() || null,
        },
        create: {
          id: 'main',
          pickupAddress: parsed.data.pickupAddress?.trim() || null,
          pickupInstructions: parsed.data.pickupInstructions?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'STORE_SETTINGS_CHANGE',
          entity: 'StoreSettings',
          entityId: updated.id,
          metadata: { adminEmail: admin.email },
        },
      });
      return updated;
    });
    return NextResponse.json({
      pickupAddress: settings.pickupAddress ?? '',
      pickupInstructions: settings.pickupInstructions ?? '',
    });
  } catch (error) {
    console.error('Could not update store settings:', error);
    return NextResponse.json({ error: 'Não foi possível salvar as configurações.' }, { status: 500 });
  }
}
