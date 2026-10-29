'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2, Truck } from 'lucide-react';

type CartProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string;
  tone: string;
};
type CartItem = { product: CartProduct; variantId: string; size: number; quantity: number };
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function SacolaPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pietra-cart') || '[]') as CartItem[];
      setItems(saved.filter((item) => item.variantId && item.product?.id));
    } catch {
      setItems([]);
    }
    setReady(true);
  }, []);

  const save = (next: CartItem[]) => {
    setItems(next);
    localStorage.setItem('pietra-cart', JSON.stringify(next));
    window.dispatchEvent(new Event('pietra-cart-updated'));
  };
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  return (
    <main className="store-page">
      <header className="simple-header">
        <Link href="/" className="simple-brand">PIETRA<span>CALÇADOS FEMININOS</span></Link>
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Continuar comprando</Link>
      </header>
      <div className="store-content">
        <p className="eyebrow">SUA ESCOLHA, COM CARINHO</p>
        <h1 className="store-title">Sua <em>sacola.</em></h1>
        {ready && !items.length ? (
          <div className="cart-empty">
            <ShoppingBag size={38} />
            <h2>Sua sacola está vazia</h2>
            <p>Encontre seu próximo par favorito na coleção Pietra.</p>
            <Link href="/#colecao" className="button button-dark">Explorar coleção</Link>
          </div>
        ) : !ready ? <p>Carregando sacola...</p> : (
          <div className="cart-layout">
            <section className="cart-items">
              {items.map((item, index) => (
                <article className="cart-line" key={item.variantId}>
                  <img src={item.product.image} alt={item.product.name} />
                  <div className="cart-line-info">
                    <h2>{item.product.name}</h2>
                    <p>{item.product.tone || item.product.category} · {item.size === 0 ? 'Tamanho único' : `Tamanho ${item.size}`}</p>
                    <strong>{money(item.product.price)}</strong>
                    <div className="quantity-control">
                      <button aria-label="Diminuir quantidade" onClick={() => save(items.map((entry, itemIndex) => itemIndex === index ? { ...entry, quantity: Math.max(1, entry.quantity - 1) } : entry))}><Minus size={14} /></button>
                      <span>{item.quantity}</span>
                      <button aria-label="Aumentar quantidade" disabled={item.quantity >= 10} onClick={() => save(items.map((entry, itemIndex) => itemIndex === index ? { ...entry, quantity: Math.min(10, entry.quantity + 1) } : entry))}><Plus size={14} /></button>
                    </div>
                  </div>
                  <button className="remove-item" onClick={() => save(items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remover ${item.product.name}`}>
                    <Trash2 size={17} />
                  </button>
                </article>
              ))}
            </section>
            <aside className="cart-summary">
              <h2>Resumo do pedido</h2>
              <div><span>Subtotal estimado</span><strong>{money(subtotal)}</strong></div>
              <div><span><Truck size={15} /> Entrega</span><span>Calculada no checkout</span></div>
              <p>O valor final e a disponibilidade são confirmados no servidor antes da cobrança.</p>
              <div className="summary-total"><span>Total parcial</span><strong>{money(subtotal)}</strong></div>
              <Link href="/checkout" className="button button-dark checkout-button">Continuar para entrega e pagamento</Link>
              <p className="safe-note">O preço definitivo será consultado no catálogo atualizado da loja.</p>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
