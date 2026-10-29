'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock3, XCircle } from 'lucide-react';

type OrderStatus = {
  code: string;
  status: string;
  paymentStatus: string;
  subtotalCents: number;
  shippingCents: number;
  shippingName: string | null;
  totalCents: number;
};

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function OrderPage() {
  const params = useParams<{ code: string }>();
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(params.code)}`, { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível consultar o pedido.');
        if (!active) return;
        const current = result.order as OrderStatus;
        setOrder(current);
        setError('');
        setLoading(false);
        if (current.paymentStatus === 'APPROVED') {
          localStorage.removeItem('pietra-cart');
          window.dispatchEvent(new Event('pietra-cart-updated'));
        }
        if (current.status !== 'PENDING_PAYMENT' && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o pedido.');
          setLoading(false);
        }
      }
    };
    void load();
    timer = setInterval(() => { void load(); }, 6000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [params.code]);

  const approved = order?.paymentStatus === 'APPROVED';
  const cancelled = order?.status === 'CANCELLED';

  return (
    <main className="store-page">
      <header className="simple-header">
        <Link href="/" className="simple-brand">PIETRA<span>CALÇADOS FEMININOS</span></Link>
        <Link href="/#colecao" className="back-link"><ArrowLeft size={16} /> Voltar à loja</Link>
      </header>
      <div className="store-content">
        <p className="eyebrow">ACOMPANHAMENTO</p>
        <h1 className="store-title">Seu <em>pedido.</em></h1>
        {loading ? <p>Consultando pagamento...</p> : error ? <p className="admin-warning" role="alert">{error}</p> : order ? (
          <section className="checkout-success">
            {approved ? <CheckCircle2 size={44} /> : cancelled ? <XCircle size={44} /> : <Clock3 size={44} />}
            <h2>{approved ? 'Pagamento aprovado' : cancelled ? 'Pedido encerrado' : 'Aguardando confirmação do pagamento'}</h2>
            <p>Pedido {order.code}</p>
            <div className="cart-summary">
              <div><span>Subtotal</span><strong>{money(order.subtotalCents)}</strong></div>
              <div><span>{order.shippingName ?? 'Entrega'}</span><strong>{money(order.shippingCents)}</strong></div>
              <div className="summary-total"><span>Total</span><strong>{money(order.totalCents)}</strong></div>
            </div>
            {!approved && !cancelled && <p>Esta página é atualizada automaticamente enquanto aguardamos o retorno do Mercado Pago.</p>}
            <Link href="/" className="button button-dark">Voltar à loja</Link>
          </section>
        ) : null}
      </div>
    </main>
  );
}
