import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const settings = await prisma.storeSettings.findUnique({
      where: { id: 'main' },
      select: { pickupAddress: true, pickupInstructions: true },
    });
    return NextResponse.json({
      pickup: settings?.pickupAddress
        ? { address: settings.pickupAddress, instructions: settings.pickupInstructions }
        : null,
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível consultar as opções de entrega.' }, { status: 503 });
  }
}
