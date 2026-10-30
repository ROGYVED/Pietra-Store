'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Check, Heart, MessageCircle, Search, ShoppingBag, Truck, X } from 'lucide-react';

type Variant = {
  id: string;
  size: number;
  stockQuantity: number;
  reservedQuantity: number;
};

type Product = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  color: string | null;
  category: { name: string } | null;
  images: { url: string; alt: string }[];
  variants: Variant[];
};

type CartProduct = {
  id: string;
  name: string;
  price: number;
  image: string;
  tone: string;
  category: string;
};

type CartItem = { product: CartProduct; variantId: string; size: number; quantity: number };

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const oneSize = (size: number) => size === 0;
const whatsappNumber = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');

export default function ProductPage() {
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [size, setSize] = useState<number | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [notice, setNotice] = useState('');
  const image = product?.images[selectedImageIndex] ?? product?.images[0];
  const variants = useMemo(() => product?.variants ?? [], [product]);
  const selectedVariant = variants.find((variant) => variant.size === size);

  useEffect(() => {
    let active = true;
    fetch(`/api/products/${encodeURIComponent(params.id)}`, { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar o produto.');
        return result.product as Product;
      })
      .then((loaded) => {
        if (active) {
          setProduct(loaded);
          setSelectedImageIndex(0);
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o produto.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [params.id]);

  const add = () => {
    if (!product || !selectedVariant) {
      setNotice('Selecione uma opção disponível antes de adicionar à sacola.');
      return;
    }

    const available = selectedVariant.stockQuantity - selectedVariant.reservedQuantity;
    if (available < 1) {
      setNotice('Esta opção está indisponível no momento.');
      return;
    }

    try {
      const cart = JSON.parse(localStorage.getItem('pietra-cart') || '[]') as CartItem[];
      const found = cart.find((item) => item.variantId === selectedVariant.id);
      if (found) {
        if (found.quantity >= available) {
          setNotice('A quantidade disponível para esta opção já está na sacola.');
          return;
        }
        found.quantity += 1;
      } else {
        cart.push({
          product: {
            id: product.id,
            name: product.name,
            price: product.priceCents / 100,
            image: image?.url ?? '',
            tone: product.color ?? '',
            category: product.category?.name ?? '',
          },
          variantId: selectedVariant.id,
          size: selectedVariant.size,
          quantity: 1,
        });
      }
      localStorage.setItem('pietra-cart', JSON.stringify(cart));
      window.dispatchEvent(new Event('pietra-cart-updated'));
      setNotice(`${product.name} adicionado à sacola.`);
    } catch {
      setNotice('Não foi possível salvar sua sacola neste navegador.');
    }
  };

  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber.startsWith('55') ? whatsappNumber : `55${whatsappNumber}`}?text=${encodeURIComponent(`Olá, Pietra! Tenho interesse em ${product?.name ?? 'um produto'}${size !== null ? `, ${oneSize(size) ? 'tamanho único' : `tamanho ${size}`}` : ''}.`)}`
    : null;

  return (
    <main className="store-page">
      <header className="simple-header">
        <Link href="/" className="simple-brand">PIETRA<span>CALÇADOS &amp; BOLSAS</span></Link>
        <Link href="/sacola" className="back-link"><ShoppingBag size={17} /> Minha sacola</Link>
      </header>

      {loading ? (
        <div className="store-content"><p>Carregando produto...</p></div>
      ) : error || !product ? (
        <div className="store-content"><p className="admin-warning" role="alert">{error || 'Produto não encontrado.'}</p><Link href="/#colecao" className="button button-dark">Voltar à coleção</Link></div>
      ) : (
        <>
          <div className="detail-breadcrumb"><Link href="/">Início</Link> / <Link href="/#colecao">Coleção</Link> / {product.name}</div>
          <section className="detail-layout">
            <div className="detail-gallery">
              <button className="detail-image" onClick={() => image && setZoom(true)} aria-label="Ampliar foto do produto">
                {image && <img src={image.url} alt={image.alt || product.name} />}
                <span><Search size={16} /> Clique para ampliar</span>
              </button>
              <p className="zoom-hint">Amplie a imagem para observar os detalhes do produto.</p>
              {product.images.length > 1 && <div className="detail-thumbnails">{product.images.map((item, index) => (
                <button className={`thumbnail${selectedImageIndex === index ? ' active' : ''}`} key={item.url} onClick={() => { setSelectedImageIndex(index); setZoom(true); }} aria-label={`Ampliar ${item.alt || product.name}`}>
                  <img src={item.url} alt={item.alt || product.name} />
                </button>
              ))}</div>}
            </div>

            <div className="detail-info">
              <p className="eyebrow">PIETRA · {product.category?.name ?? 'COLEÇÃO'}</p>
              <h1>{product.name}</h1>
              {product.color && <p className="detail-tone">Cor: {product.color}</p>}
              <div className="detail-price"><strong>{money(product.priceCents)}</strong></div>
              {product.description && <p className="detail-description">{product.description}</p>}
              <div className="detail-delivery"><Truck size={18} /><span>Opções e custos de entrega calculados no checkout.</span></div>
              <h2>{variants.some((variant) => oneSize(variant.size)) ? 'Escolha a opção' : 'Escolha o tamanho (Brasil)'}</h2>
              <div className="detail-sizes">
                {variants.map((variant) => {
                  const available = variant.stockQuantity - variant.reservedQuantity;
                  return <button
                    key={variant.id}
                    className={`${size === variant.size ? 'selected' : ''}${available < 1 ? ' unavailable' : ''}`}
                    aria-pressed={size === variant.size}
                    disabled={available < 1}
                    onClick={() => setSize(variant.size)}
                    title={available < 1 ? 'Indisponível' : `${available} disponível(is)`}
                  >{oneSize(variant.size) ? 'Único' : variant.size}</button>;
                })}
              </div>
              {!variants.some((variant) => variant.stockQuantity > variant.reservedQuantity) && (
                <p className="size-note">Produto sem estoque disponível no momento.</p>
              )}
              <button className="button button-dark detail-add" onClick={add} disabled={!selectedVariant}>
                Adicionar à sacola <ShoppingBag size={17} />
              </button>
              <button className="detail-favorite" onClick={() => setFavorite(!favorite)}>
                <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />{favorite ? 'Salvo nos favoritos' : 'Adicionar aos favoritos'}
              </button>
              {whatsappUrl && <a className="detail-whatsapp" href={whatsappUrl} target="_blank" rel="noreferrer">
                <MessageCircle size={17} /> Tirar dúvidas pelo WhatsApp
              </a>}
              <section className="product-description-block">
                <h2>Descrição do produto</h2>
                <p>{product.description || 'Consulte a loja para mais informações sobre este produto.'}</p>
              </section>
            </div>
          </section>
          {notice && <div className="toast" role="status"><Check size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={16} /></button></div>}
          {zoom && image && <div className="zoom-backdrop" onClick={() => setZoom(false)} role="presentation">
            <button className="zoom-close" onClick={() => setZoom(false)} aria-label="Fechar imagem ampliada"><X size={25} /></button>
            <img src={image.url} alt={`Imagem ampliada de ${product.name}`} onClick={(event) => event.stopPropagation()} />
          </div>}
        </>
      )}
      <footer className="detail-footer"><Link href="/">← Voltar à coleção Pietra</Link></footer>
    </main>
  );
}
