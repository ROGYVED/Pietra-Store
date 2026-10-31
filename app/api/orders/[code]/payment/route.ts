import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const paymentSchema = z.object({
  transaction_amount: z.number().positive(),
  payment_method_id: z.string().min(1).max(80),
  token: z.string().min(1).optional(),
  issuer_id: z.union([z.string(), z.number()]).optional(),
  installments: z.number().int().positive().optional(),
  payment_method_option_id: z.string().min(1).optional(),
  payer: z.object({
    email: z.string().email().optional(),
    identification: z.object({
      type: z.string().min(1),
      number: z.string().min(1),
    }).optional(),
    first_name: z.string().min(1).optional(),
    last_name: z.string().min(1).optional(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
  }).passthrough(),
});

type MercadoPagoPayment = {
  id?: number | string;
  status?: string;
  transaction_amount?: number;
  currency_id?: string;
  payment_method_id?: string;
};

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const parsed = paymentSchema.safeParse(
    (await request.json().catch(() => null) as { formData?: unknown } | null)?.formData,
  );
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados de pagamento inválidos. Confira os campos e tente novamente.' }, { status: 400 });
  }

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const baseUrl = process.env.NEXT_PUBLIC_STORE_URL;
  if (!accessToken || !baseUrl) {
    return NextResponse.json({ error: 'Pagamento indisponível: configure Mercado Pago e a URL pública da loja.' }, { status: 503 });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { code },
      include: { payments: { where: { provider: 'mercadopago', status: 'PENDING' }, orderBy: { createdAt: 'desc' } } },
    });
    if (!order) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    if (order.status !== 'PENDING_PAYMENT' || order.paymentStatus !== 'PENDING') {
      return NextResponse.json({ error: 'Este pedido não está mais aguardando pagamento.' }, { status: 409 });
    }

    const payment = order.payments.find((entry) => entry.method === 'checkout_bricks');
    if (!payment) {
      return NextResponse.json({ error: 'Não foi possível preparar o pagamento deste pedido. Inicie um novo checkout.' }, { status: 409 });
    }
    if (payment.expiresAt && payment.expiresAt <= new Date()) {
      return NextResponse.json({ error: 'O prazo para pagar este pedido expirou. Inicie um novo checkout.' }, { status: 409 });
    }
    if (payment.providerPaymentId && /^\d+$/.test(payment.providerPaymentId)) {
      const existingResponse = await fetch(`https://api.mercadopago.com/v1/payments/${payment.providerPaymentId}`, {
        headers: { Authorization: 'Bearer ' + accessToken },
        signal: AbortSignal.timeout(12000),
      });
      if (existingResponse.ok) {
        return NextResponse.json({ payment: await existingResponse.json() });
      }
      console.error('Mercado Pago existing payment lookup failed:', existingResponse.status);
      return NextResponse.json({ error: 'Não foi possível recuperar a tentativa de pagamento. Atualize o checkout.' }, { status: 502 });
    }

    if (!order.customerEmail) {
      return NextResponse.json({ error: 'Informe um e-mail válido para concluir o pagamento.' }, { status: 400 });
    }
    const formData = parsed.data;
    const firstName = formData.payer.first_name ?? formData.payer.firstName ?? order.customerName.trim().split(/\s+/)[0];
    const lastName = formData.payer.last_name ?? formData.payer.lastName
      ?? order.customerName.trim().split(/\s+/).slice(1).join(' ');
    const payer = {
      email: order.customerEmail,
      first_name: firstName,
      ...(lastName ? { last_name: lastName } : {}),
      ...(formData.payer.identification ? { identification: formData.payer.identification } : {}),
    };

    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': order.idempotencyKey ?? order.id,
      },
      body: JSON.stringify({
        transaction_amount: order.totalCents / 100,
        payment_method_id: formData.payment_method_id,
        ...(formData.token ? { token: formData.token } : {}),
        ...(formData.issuer_id !== undefined ? { issuer_id: String(formData.issuer_id) } : {}),
        ...(formData.installments ? { installments: formData.installments } : {}),
        ...(formData.payment_method_option_id ? { payment_method_option_id: formData.payment_method_option_id } : {}),
        payer,
        description: `Pedido ${order.code}`,
        external_reference: order.id,
        notification_url: `${baseUrl.replace(/\/$/, '')}/api/payments/mercadopago/webhook`,
        statement_descriptor: 'PIETRA',
      }),
      signal: AbortSignal.timeout(15000),
    });

    const result = await response.json().catch(() => null) as MercadoPagoPayment & {
      error?: string;
      message?: string;
      cause?: { code?: string | number; description?: string }[];
    } | null;
    if (!response.ok || !result?.id || !result.status || result.currency_id !== 'BRL'
      || Math.round((result.transaction_amount ?? 0) * 100) !== order.totalCents) {
      console.error('Mercado Pago payment creation failed:', {
        status: response.status,
        error: result?.error,
        message: result?.message,
        causes: result?.cause?.slice(0, 5).map(({ code: causeCode, description }) => ({
          code: causeCode,
          description: description?.slice(0, 200),
        })),
      });
      return NextResponse.json({ error: 'Não foi possível processar o pagamento. Confira os dados ou tente outra forma de pagamento.' }, { status: 502 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId: String(result.id),
          method: result.payment_method_id ?? formData.payment_method_id,
          rawStatus: result.status,
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { paymentProvider: 'mercadopago', providerPaymentId: String(result.id) },
      });
    });

    return NextResponse.json({ payment: result });
  } catch (error) {
    console.error('Order payment submission failed:', error);
    return NextResponse.json({ error: 'Não foi possível processar o pagamento. Tente novamente.' }, { status: 502 });
  }
}
