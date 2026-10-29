import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: 'connected' });
  } catch {
    return NextResponse.json({ ok: false, database: 'unavailable', message: 'Configure DATABASE_URL e execute as migrações.' }, { status: 503 });
  }
}
