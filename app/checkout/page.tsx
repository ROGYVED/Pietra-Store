'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, LoaderCircle, MessageCircle, Truck } from 'lucide-react';

type CartProduct = { id: string; name: string; price: number; image: string; tone: string; category: string };
type CartItem = { product: CartProduct; variantId: string; size: number; quantity: number };
type ShippingQuote = {
  token: string;
  serviceId: string;
  serviceName: string;
  priceCents: number;
  deliveryDays: number;
};
type PickupOption = { address: string; instructions: string | null };
type Fulfillment = 'NATIONAL_SHIPPING' | 'PICKUP';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const emptyAddress = { cep: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' };
const whatsappNumber = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');

export default function CheckoutPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [fulfillment, setFulfillment] = useState<Fulfillment>('NATIONAL_SHIPPING');
  const [quotes, setQuotes] = useState<ShippingQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState('');
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [error, setError] = useState('');
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '' });
  const [address, setAddress] = useState(emptyAddress);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submittedOrder, setSubmittedOrder] = useState('');
  const [pickup, setPickup] = useState<PickupOption | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pietra-cart') || '[]') as CartItem[];
      setItems(saved.filter((item) => item.variantId && item.product?.id));
    } catch {
      setItems([]);
    }
    setIdempotencyKey(crypto.randomUUID());
    setReady(true);
    fetch('/api/store/settings')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar as opções de retirada.');
        setPickup(result.pickup as PickupOption | null);
      })
      .catch(() => setPickup(null));
  }, []);

  const subtotalCents = useMemo(
    () => items.reduce((sum, item) => sum + Math.round(item.product.price * 100) * item.quantity, 0),
    [items],
  );
  const chosenQuote = quotes.find((quote) => quote.token === selectedQuote);
  const totalCents = subtotalCents + (fulfillment === 'NATIONAL_SHIPPING' ? chosenQuote?.priceCents ?? 0 : 0);

  const updateCustomer = (key: keyof typeof customer, value: string) =>
    setCustomer((current) => ({ ...current, [key]: value }));
  const updateAddress = (key: keyof typeof address, value: string) => {
    setAddress((current) => ({ ...current, [key]: value }));
    setQuotes([]);
    setSelectedQuote('');
  };

  async function calculateFreight() {
    setError('');
    setQuotes([]);
    setSelectedQuote('');
    const postalCode = address.cep.replace(/\D/g, '');
    if (!/^\d{8}$/.test(postalCode)) {
      setError('Informe um CEP válido com 8 dígitos.');
      return;
    }
    setQuoteBusy(true);
    try {
      const response = await fetch('/api/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postalCode,
          items: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível calcular o frete.');
      const availableQuotes = result.quotes as ShippingQuote[];
      if (!availableQuotes.length) throw new Error('Nenhuma opção de frete foi encontrada para este CEP.');
      setQuotes(availableQuotes);
      setSelectedQuote(availableQuotes[0].token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível calcular o frete.');
    } finally {
      setQuoteBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!items.length) {
      setError('Sua sacola está vazia.');
      return;
    }
    if (fulfillment === 'NATIONAL_SHIPPING' && !chosenQuote) {
      setError('Calcule e selecione o frete antes de continuar.');
      return;
    }
    if (!idempotencyKey) {
      setError('Não foi possível preparar o pedido. Atualize a página e tente novamente.');
      return;
    }

    setSubmitBusy(true);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          fulfillmentType: fulfillment,
          address: fulfillment === 'PICKUP' ? undefined : address,
          shippingQuoteToken: fulfillment === 'NATIONAL_SHIPPING' ? chosenQuote?.token : undefined,
          items: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
          idempotencyKey,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível iniciar o pagamento.');
      const checkoutUrl = result.payment?.checkoutUrl as string | undefined;
      if (!checkoutUrl) throw new Error('O pagamento foi criado sem uma URL de checkout.');
      setSubmittedOrder(result.order.code);
      window.location.assign(checkoutUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar o pagamento.');
      setSubmitBusy(false);
    }
  }

  const orderWhatsApp = submittedOrder && whatsappNumber
    ? `https://wa.me/${whatsappNumber.startsWith('55') ? whatsappNumber : `55${whatsappNumber}`}?text=${encodeURIComponent(`Olá, Pietra! Meu pedido ${submittedOrder} está aguardando confirmação.`)}`
    : null;

  return (
    <main className="store-page">
      <header className="simple-header">
        <Link href="/" className="simple-brand">PIETRA<span>CALÇADOS FEMININOS</span></Link>
        <Link href="/sacola" className="back-link"><ArrowLeft size={16} /> Voltar à sacola</Link>
      </header>
      <div className="store-content">
        <p className="eyebrow">QUASE SEU</p>
        <h1 className="store-title">Finalizar <em>pedido.</em></h1>
        {!ready ? <p>Carregando sacola...</p> : !items.length ? (
          <section className="cart-empty">
            <h2>Sua sacola está vazia</h2>
            <Link href="/#colecao" className="button button-dark">Escolher produtos</Link>
          </section>
        ) : submittedOrder ? (
          <section className="checkout-success">
            <CheckCircle2 size={44} />
            <h2>Pedido {submittedOrder} criado</h2>
            <p>Estamos redirecionando você ao Mercado Pago para escolher Pix ou cartão.</p>
            {orderWhatsApp && <a className="button button-dark" href={orderWhatsApp} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Falar com a Pietra</a>}
          </section>
        ) : (
          <form className="checkout-layout" onSubmit={submit}>
            <section className="checkout-form">
              <h2>Seus dados</h2>
              <div className="form-grid">
                <label>Nome completo<input required minLength={2} maxLength={160} value={customer.name} onChange={(event) => updateCustomer('name', event.target.value)} autoComplete="name" /></label>
                <label>E-mail<input type="email" required value={customer.email} onChange={(event) => updateCustomer('email', event.target.value)} autoComplete="email" /></label>
                <label>WhatsApp<input required minLength={8} maxLength={30} value={customer.phone} onChange={(event) => updateCustomer('phone', event.target.value)} autoComplete="tel" /></label>
              </div>

              <h2>Como deseja receber?</h2>
              <div className="choice-stack">
                <label><input type="radio" checked={fulfillment === 'NATIONAL_SHIPPING'} onChange={() => { setFulfillment('NATIONAL_SHIPPING'); setError(''); }} /> Envio nacional pelo Melhor Envio</label>
                {pickup && <label><input type="radio" checked={fulfillment === 'PICKUP'} onChange={() => { setFulfillment('PICKUP'); setQuotes([]); setSelectedQuote(''); setError(''); }} /> Retirar na loja</label>}
              </div>
              {pickup && fulfillment === 'PICKUP' && <p className="safe-note">{pickup.address}{pickup.instructions ? ` · ${pickup.instructions}` : ''}</p>}

              {fulfillment === 'NATIONAL_SHIPPING' && (
                <>
                  <h2>Endereço de entrega</h2>
                  <div className="form-grid">
                    <label>CEP<input required inputMode="numeric" maxLength={9} value={address.cep} onChange={(event) => updateAddress('cep', event.target.value)} autoComplete="postal-code" /></label>
                    <label>Endereço<input required maxLength={160} value={address.street} onChange={(event) => updateAddress('street', event.target.value)} autoComplete="street-address" /></label>
                    <label>Número<input required maxLength={20} value={address.number} onChange={(event) => updateAddress('number', event.target.value)} /></label>
                    <label>Complemento<input maxLength={120} value={address.complement} onChange={(event) => updateAddress('complement', event.target.value)} /></label>
                    <label>Bairro<input maxLength={120} value={address.neighborhood} onChange={(event) => updateAddress('neighborhood', event.target.value)} /></label>
                    <label>Cidade<input required maxLength={120} value={address.city} onChange={(event) => updateAddress('city', event.target.value)} autoComplete="address-level2" /></label>
                    <label>UF<input required minLength={2} maxLength={2} value={address.state} onChange={(event) => updateAddress('state', event.target.value.toUpperCase())} autoComplete="address-level1" /></label>
                  </div>
                  <button className="button button-outline" type="button" onClick={calculateFreight} disabled={quoteBusy}>
                    {quoteBusy ? <LoaderCircle size={16} /> : <Truck size={16} />} Calcular frete
                  </button>
                  {!!quotes.length && (
                    <div className="choice-stack">
                      {quotes.map((quote) => (
                        <label key={quote.token}>
                          <input type="radio" name="shippingQuote" checked={selectedQuote === quote.token} onChange={() => setSelectedQuote(quote.token)} />
                          {quote.serviceName} · {money(quote.priceCents)} · até {quote.deliveryDays} dias
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}

              <h2>Pagamento</h2>
              <p className="safe-note">O pagamento seguro será feito no Mercado Pago. Pix e cartão serão exibidos conforme sua conta.</p>
              {error && <p className="admin-warning" role="alert">{error}</p>}
              <button type="submit" className="button button-dark checkout-button" disabled={submitBusy}>
                {submitBusy ? <LoaderCircle size={16} /> : null} Continuar para pagamento
              </button>
            </section>

            <aside className="cart-summary">
              <h2>Seu pedido</h2>
              {items.map((item) => (
                <div className="checkout-item" key={item.variantId}>
                  <span>{item.quantity}× {item.product.name} · {item.size === 0 ? 'Único' : `nº ${item.size}`}</span>
                  <strong>{money(Math.round(item.product.price * 100) * item.quantity)}</strong>
                </div>
              ))}
              <div><span>Subtotal estimado</span><strong>{money(subtotalCents)}</strong></div>
              <div><span>Entrega</span><strong>{fulfillment === 'PICKUP' ? 'Grátis' : chosenQuote ? money(chosenQuote.priceCents) : 'Calcule o frete'}</strong></div>
              <div className="summary-total"><span>Total estimado</span><strong>{money(totalCents)}</strong></div>
              <p className="safe-note">O servidor confirma preço e estoque antes de criar a cobrança.</p>
            </aside>
          </form>
        )}
      </div>
    </main>
  );
}
