import { NextResponse } from 'next/server';
import { timingSafeEqual, scryptSync } from 'node:crypto';
import { createAdminSession } from '@/lib/admin-auth';

function matches(input: string, expected: string) {
  const a = scryptSync(input, 'pietra-admin-login-v1', 32);
  const b = scryptSync(expected, 'pietra-admin-login-v1', 32);
  return timingSafeEqual(a, b);
}
export async function POST(request: Request) {
  const expectedEmail = process.env.ADMIN_EMAIL;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedEmail || !expectedPassword) return NextResponse.json({ error: 'Configure ADMIN_EMAIL e ADMIN_PASSWORD no ambiente.' }, { status: 503 });
  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  if (!body?.email || !body.password || body.email.toLowerCase() !== expectedEmail.toLowerCase() || !matches(body.password, expectedPassword)) {
    return NextResponse.json({ error: 'E-mail ou senha inválidos.' }, { status: 401 });
  }
  try { await createAdminSession(expectedEmail); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ error: 'Sessão não configurada. Confira ADMIN_SESSION_SECRET.' }, { status: 503 }); }
}
