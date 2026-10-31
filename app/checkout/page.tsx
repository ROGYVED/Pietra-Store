'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, LoaderCircle, MessageCircle, Truck } from 'lucide-react';
import MercadoPagoPayment from './mercado-pago-payment';

type CartProduct = { id: string; name: string; price: number; image: string; tone: string; category: string };
type CartItem = { product: CartProduct; variantId: string; size: number; quantity: number };
type ShippingQuote = {
  token?: string;
  serviceId: string;
  serviceName: string;
  priceCents: number;
  deliveryDays: number;
  freeShipping?: boolean;
};
const quoteKey = (quote: ShippingQuote) => quote.token ?? quote.serviceId;
type PickupOption = { address: string; instructions: string | null };
type Fulfillment = 'NATIONAL_SHIPPING' | 'PICKUP';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const emptyAddress = { cep: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' };
const whatsappNumber = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');
const mercadoPagoPublicKey = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY;

export default function CheckoutPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [fulfillment, setFulfillment] = useState<Fulfillment>('NATIONAL_SHIPPING');
  const [quotes, setQuotes] = useState<ShippingQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState('');
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [freightStatus, setFreightStatus] = useState('');
  const [addressLookupStatus, setAddressLookupStatus] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [error, setError] = useState('');
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '' });
  const [address, setAddress] = useState(emptyAddress);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submittedOrder, setSubmittedOrder] = useState('');
  const [submittedTotalCents, setSubmittedTotalCents] = useState<number | null>(null);
  const [paymentStatus, setPaymentStatus] = useState('');
  const [pickup, setPickup] = useState<PickupOption | null>(null);
  const quoteRequestId = useRef(0);

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
  const chosenQuote = quotes.find((quote) => quoteKey(quote) === selectedQuote);
  const totalCents = subtotalCents + (fulfillment === 'NATIONAL_SHIPPING' ? chosenQuote?.priceCents ?? 0 : 0);

  const updateCustomer = (key: keyof typeof customer, value: string) =>
    setCustomer((current) => ({ ...current, [key]: value }));
  const updateAddress = (key: keyof typeof address, value: string) => {
    if (key === 'cep') {
      const digits = value.replace(/\D/g, '').slice(0, 8);
      const formattedCep = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
      quoteRequestId.current += 1;
      setQuotes([]);
      setSelectedQuote('');
      setQuoteBusy(false);
      setFreightStatus('');
      setError('');
      setAddress((current) => ({
        ...current,
        cep: formattedCep,
        street: '',
        neighborhood: '',
        city: '',
        state: '',
      }));
      return;
    }
    setAddress((current) => ({ ...current, [key]: value }));
  };

  const calculateFreight = useCallback(async (cep = address.cep) => {
    const requestId = ++quoteRequestId.current;
    setError('');
    setQuotes([]);
    setSelectedQuote('');
    const postalCode = cep.replace(/\D/g, '');
    if (!/^\d{8}$/.test(postalCode)) {
      setFreightStatus('');
      return;
    }
    setFreightStatus('Calculando as opções de frete...');
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
      if (requestId !== quoteRequestId.current) return;
      if (!response.ok) throw new Error(result.error || 'Não foi possível calcular o frete.');
      const availableQuotes = result.quotes as ShippingQuote[];
      if (!availableQuotes.length) throw new Error('Nenhuma opção de frete foi encontrada para este CEP.');
      setQuotes(availableQuotes);
      setSelectedQuote(quoteKey(availableQuotes[0]));
      setFreightStatus(availableQuotes[0].freeShipping
        ? 'Entrega grátis disponível para este CEP em Aracaju/SE.'
        : 'Frete calculado. Selecione a opção desejada.');
    } catch (reason) {
      if (requestId === quoteRequestId.current) {
        setFreightStatus('');
        setError(reason instanceof Error ? reason.message : 'Não foi possível calcular o frete.');
      }
    } finally {
      if (requestId === quoteRequestId.current) setQuoteBusy(false);
    }
  }, [address.cep, items]);

  const postalCode = address.cep.replace(/\D/g, '');

  useEffect(() => {
    if (postalCode.length !== 8 || fulfillment !== 'NATIONAL_SHIPPING') {
      setAddressLookupStatus('');
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setAddressLookupStatus('Buscando endereço pelo CEP...');
      try {
        const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Não foi possível consultar o CEP.');
        const result = await response.json() as {
          logradouro?: string;
          bairro?: string;
          localidade?: string;
          uf?: string;
          erro?: boolean;
        };
        if (result.erro) {
          setAddressLookupStatus('CEP não encontrado. Confira o número e preencha o endereço manualmente.');
          return;
        }
        setAddress((current) => current.cep.replace(/\D/g, '') === postalCode
          ? {
              ...current,
              street: result.logradouro || current.street,
              neighborhood: result.bairro || current.neighborhood,
              city: result.localidade || current.city,
              state: result.uf || current.state,
            }
          : current);
        setAddressLookupStatus('Endereço localizado. Confira o número e o complemento.');
      } catch {
        if (controller.signal.aborted) return;
        setAddressLookupStatus('Não foi possível localizar o endereço automaticamente. Preencha os campos manualmente.');
      }
    }, 350);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [fulfillment, postalCode]);

  useEffect(() => {
    if (!ready || fulfillment !== 'NATIONAL_SHIPPING' || postalCode.length !== 8 || !items.length) return;
    const timeout = setTimeout(() => { void calculateFreight(address.cep); }, 500);
    return () => clearTimeout(timeout);
  }, [address.cep, calculateFreight, fulfillment, items.length, postalCode.length, ready]);

  useEffect(() => {
    if (!submittedOrder) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const loadStatus = async () => {
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(submittedOrder)}`, { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível consultar o pagamento.');
        if (!active) return;
        const status = result.order.paymentStatus as string;
        setPaymentStatus(status);
        if (status === 'APPROVED') {
          localStorage.removeItem('pietra-cart');
          window.dispatchEvent(new Event('pietra-cart-updated'));
        }
        if (['APPROVED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(status) && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      } catch {
        if (active) setPaymentStatus('PENDING');
      }
    };
    void loadStatus();
    timer = setInterval(() => { void loadStatus(); }, 6000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [submittedOrder]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!mercadoPagoPublicKey) {
      setError('Pagamento indisponível: configure a Public Key do Mercado Pago na Vercel.');
      return;
    }
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
      setSubmittedOrder(result.order.code);
      setSubmittedTotalCents(result.order.totalCents);
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
        ) : submittedOrder && submittedTotalCents !== null ? (
          <section className="checkout-layout">
            <section className="checkout-form">
              <h2>Pedido {submittedOrder}</h2>
              {paymentStatus === 'APPROVED' ? (
                <p className="shipping-status" role="status"><CheckCircle2 size={18} /> Pagamento aprovado! Seu pedido está confirmado.</p>
              ) : ['CANCELLED', 'EXPIRED', 'REJECTED'].includes(paymentStatus) ? (
                <>
                  <p className="admin-warning" role="alert">Este pagamento não foi aprovado e o pedido foi encerrado. Volte à sacola para iniciar uma nova tentativa.</p>
                  <Link href="/sacola" className="button button-dark">Voltar à sacola</Link>
                </>
              ) : (
                <>
                  <p className="safe-note">Escolha a forma de pagamento abaixo. O pagamento acontece aqui mesmo, na loja Pietra.</p>
                  <MercadoPagoPayment
                    orderCode={submittedOrder}
                    amountCents={submittedTotalCents}
                    email={customer.email}
                    onPaymentResult={setPaymentStatus}
                  />
                </>
              )}
              {orderWhatsApp && <a className="button button-outline" href={orderWhatsApp} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Falar com a Pietra</a>}
            </section>
            <aside className="cart-summary">
              <h2>Seu pedido</h2>
              {items.map((item) => (
                <div className="checkout-item" key={item.variantId}>
                  <span>{item.quantity}× {item.product.name} · {item.size === 0 ? 'Único' : `nº ${item.size}`}</span>
                  <strong>{money(Math.round(item.product.price * 100) * item.quantity)}</strong>
                </div>
              ))}
              <div><span>Total confirmado</span><strong>{money(submittedTotalCents)}</strong></div>
            </aside>
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
                {pickup && <label><input type="radio" checked={fulfillment === 'PICKUP'} onChange={() => { quoteRequestId.current += 1; setFulfillment('PICKUP'); setQuotes([]); setSelectedQuote(''); setQuoteBusy(false); setFreightStatus(''); setError(''); }} /> Retirar na loja</label>}
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
                  {addressLookupStatus && <p className="shipping-status" role="status">{addressLookupStatus}</p>}
                  {freightStatus && <p className="shipping-status" role="status">{freightStatus}</p>}
                  {postalCode.length === 8 && (
                    <button className="button button-outline shipping-recalculate" type="button" onClick={() => void calculateFreight()} disabled={quoteBusy}>
                      {quoteBusy ? <LoaderCircle size={16} /> : <Truck size={16} />} Recalcular frete
                    </button>
                  )}
                  {!!quotes.length && (
                    <div className="choice-stack">
                      {quotes.map((quote) => (
                        <label key={quoteKey(quote)}>
                          <input type="radio" name="shippingQuote" checked={selectedQuote === quoteKey(quote)} onChange={() => setSelectedQuote(quoteKey(quote))} />
                          {quote.serviceName} · {money(quote.priceCents)}{quote.deliveryDays > 0 ? ` · até ${quote.deliveryDays} dias` : ''}
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}

              <h2>Pagamento</h2>
              <p className="safe-note">O pagamento será processado com segurança pelo Mercado Pago, sem sair da loja Pietra.</p>
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
              <div><span>Entrega</span><strong>{fulfillment === 'PICKUP' || chosenQuote?.freeShipping ? 'Grátis' : chosenQuote ? money(chosenQuote.priceCents) : 'Calcule o frete'}</strong></div>
              <div className="summary-total"><span>Total estimado</span><strong>{money(totalCents)}</strong></div>
              <p className="safe-note">O servidor confirma preço e estoque antes de criar a cobrança.</p>
            </aside>
          </form>
        )}
      </div>
    </main>
  );
}
