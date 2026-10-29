'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import './storefront.css';
import {
  ArrowDownRight, ArrowRight, Check, ChevronDown, Heart, Menu, MessageCircle,
  Search, ShieldCheck, ShoppingBag, Truck, X
} from 'lucide-react';

type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  oldPrice?: number;
  tag?: string;
  image: string;
  tone: string;
  variants: { id: string; size: number; stockQuantity: number; reservedQuantity: number }[];
};
type CartItem = { product: Product; variantId: string; size: number; quantity: number };

type CatalogResponseProduct = {
  id: string;
  name: string;
  priceCents: number;
  color: string | null;
  category: { name: string } | null;
  images: { url: string }[];
  variants: Product['variants'];
};

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function Logo() {
  return <a href="#inicio" className="brand" aria-label="Pietra — início"><span className="brand-mark">✳</span><span className="brand-name">PIETRA</span><span className="brand-subtitle">CALÇADOS &amp; BOLSAS</span></a>;
}

export default function Home() {
  const whatsappNumber = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');
  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber.startsWith('55') ? whatsappNumber : `55${whatsappNumber}`}?text=${encodeURIComponent('Olá, Pietra! Quero conhecer os calçados.')}`
    : null;
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [cartCount, setCartCount] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedSize, setSelectedSize] = useState<number | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/products')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar a coleção.');
        return result.products as CatalogResponseProduct[];
      })
      .then((catalog) => {
        if (!active) return;
        setProducts(catalog.map((product) => ({
          id: product.id,
          name: product.name,
          category: product.category?.name ?? 'Calçados',
          price: product.priceCents / 100,
          image: product.images[0]?.url ?? '',
          tone: product.color ?? '',
          variants: product.variants,
        })));
        setCatalogError('');
      })
      .catch((error: unknown) => {
        if (active) setCatalogError(error instanceof Error ? error.message : 'Não foi possível carregar a coleção.');
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    try { const cart = JSON.parse(localStorage.getItem('pietra-cart') || '[]') as CartItem[]; setCartCount(cart.reduce((sum, item) => sum + item.quantity, 0)); } catch { setCartCount(0); }
    return () => { active = false; };
  }, []);

  const visibleProducts = useMemo(() => products.filter((product) => {
    const matchesCategory = activeCategory === 'Todos' || product.category === activeCategory;
    const matchesQuery = `${product.name} ${product.category} ${product.tone}`.toLowerCase().includes(query.toLowerCase());
    return matchesCategory && matchesQuery;
  }), [activeCategory, products, query]);

  const toggleFavorite = (id: string) => setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const addToBag = (product: Product, size: number) => {
    const variant = product.variants.find((item) => item.size === size);
    if (!variant || variant.stockQuantity - variant.reservedQuantity < 1) {
      setNotice('Este tamanho está indisponível no momento.');
      return;
    }
    let cart: CartItem[] = [];
    try { cart = JSON.parse(localStorage.getItem('pietra-cart') || '[]') as CartItem[]; } catch { cart = []; }
    const found = cart.find((item) => item.product.id === product.id && item.size === size);
    if (found) found.quantity += 1; else cart.push({ product, variantId: variant.id, size, quantity: 1 });
    localStorage.setItem('pietra-cart', JSON.stringify(cart));
    setCartCount(cart.reduce((sum, item) => sum + item.quantity, 0));
    setSelectedProduct(null); setSelectedSize(null);
    setNotice(`${product.name}, tamanho ${size}, foi adicionada à sua sacola.`);
    window.setTimeout(() => setNotice(''), 3200);
  };

  const openProduct = (product: Product) => { window.location.href = `/produto/${product.id}`; };
  const openCategory = (category: string) => {
    setActiveCategory(category);
    setQuery('');
    window.setTimeout(() => document.getElementById('colecao')?.scrollIntoView({ behavior: 'smooth' }), 0);
  };

  return (
    <main id="inicio">
      <div className="announcement"><span>Um toque de elegância para todos os seus caminhos</span><span className="announcement-right">PARCELE SUAS ESCOLHAS COM CARINHO <ArrowRight size={13} /></span></div>
      <header className="site-header">
        <div className="header-top wrap">
          <button className="icon-button mobile-toggle" aria-label="Abrir menu" onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X /> : <Menu />}</button>
          <label className="search-box"><Search size={18} strokeWidth={1.5} /><input value={query} onChange={(event) => { setQuery(event.target.value); document.getElementById('colecao')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} placeholder="O que você procura?" aria-label="Buscar produtos" /></label>
          <Logo />
          <div className="header-actions"><a className="account-link" href="#sobre">Nossa história</a><Link className="icon-button bag-button" href="/sacola" aria-label={`Abrir sacola com ${cartCount} itens`}><ShoppingBag size={21} strokeWidth={1.5} /><span className="bag-count">{cartCount}</span></Link></div>
        </div>
        <nav className={`main-nav ${mobileMenu ? 'nav-open' : ''}`} aria-label="Navegação principal">
          <a href="#inicio" onClick={() => setMobileMenu(false)}>Início</a>
          <a href="#categorias" onClick={() => setMobileMenu(false)}>Categorias <ChevronDown size={13} /></a>
          <a href="#colecao" onClick={() => { setActiveCategory('Todos'); setMobileMenu(false); }}>Coleção</a>
          <a href="#colecao" onClick={() => { setActiveCategory('Todos'); setMobileMenu(false); }}>Novidades</a>
          <a href="#sobre" onClick={() => setMobileMenu(false)}>Nossa essência</a>
          <a href="#contato" onClick={() => setMobileMenu(false)}>Contato</a>
        </nav>
      </header>

      <section className="hero wrap" aria-label="Apresentação Pietra">
        <div className="hero-copy"><p className="eyebrow">SEU ESTILO, SEUS MOMENTOS</p><h1>Beleza em<br /><em>cada escolha.</em></h1><p className="hero-description">Calçados e bolsas que acompanham você,<br className="desktop-break" /> em todas as fases da sua jornada.</p><a className="button button-dark" href="#categorias">Explore nossos nichos <ArrowRight size={16} /></a><span className="hero-note">Feito para você. Escolhido por você.</span></div>
        <div className="hero-image"><div className="hero-image-overlay" /><div className="hero-side-note">COLEÇÃO ATEMPORAL <span>— 01 / PIETRA</span></div></div>
        <div className="hero-stamp"><span>PIETRA</span><span>DESDE SEMPRE, COM VOCÊ</span><ArrowDownRight size={18} /></div>
      </section>

      <section id="categorias" className="category-section wrap section-pad">
        <div className="section-heading"><div><p className="eyebrow">COMPRE POR NICHO</p><h2>Encontre o que combina <em>com você.</em></h2></div><p className="section-intro">Escolha uma categoria e veja<br />todos os produtos disponíveis.</p></div>
        <div className="category-grid">{['Calçados', 'Bolsas'].map((category, index) => {
          const image = products.find((product) => product.category === category)?.image;
          const count = products.filter((product) => product.category === category).length;
          return <button className={`category-card category-card-${index}`} key={category} onClick={() => openCategory(category)} aria-label={`Ver ${count} produtos de ${category}`}>
            <div className={`category-image category-image-${index}`}>{image ? <img src={image} alt="" loading="lazy" /> : <span className="category-placeholder">{category === 'Bolsas' ? 'B' : 'P'}</span>}<span className="category-image-label">PIETRA · {String(index + 1).padStart(2, '0')}</span></div>
            <div className="category-info"><div><h3>{category}</h3><p>{category === 'Bolsas' ? 'Acompanhe seus momentos com estilo' : 'Conforto e estilo em cada passo'} · {count} {count === 1 ? 'modelo' : 'modelos'}</p></div><span className="round-arrow"><ArrowRight size={16} /></span></div>
          </button>;
        })}</div>
      </section>

      <section className="service-strip"><div className="wrap service-grid"><div className="service-item"><Truck size={25} strokeWidth={1.35} /><div><strong>Entrega com cuidado</strong><span>Consulte opções para sua região</span></div></div><div className="service-item"><ShieldCheck size={25} strokeWidth={1.35} /><div><strong>Compra com tranquilidade</strong><span>Atendimento próximo e humano</span></div></div><div className="service-item"><MessageCircle size={25} strokeWidth={1.35} /><div><strong>Estamos aqui por você</strong><span>Atendimento pelo WhatsApp</span></div></div></div></section>

      <section id="colecao" className="products-section wrap section-pad">
        <div className="section-heading products-heading"><div><p className="eyebrow">{activeCategory === 'Todos' ? 'ESCOLHAS DA PIETRA' : `NICHO · ${activeCategory.toUpperCase()}`}</p><h2>{activeCategory === 'Todos' ? <>Favoritos da <em>temporada.</em></> : <>{activeCategory} para <em>viver seu estilo.</em></>}</h2></div><a href="#colecao" className="text-link" onClick={() => { setActiveCategory('Todos'); setQuery(''); }}>Ver coleção completa <ArrowRight size={15} /></a></div>
        <div className="filter-row"><div className="filter-list">{['Todos', 'Calçados', 'Bolsas'].map((category) => <button key={category} className={`filter-chip ${activeCategory === category ? 'active' : ''}`} onClick={() => setActiveCategory(category)}>{category}</button>)}</div><span className="results-count">{visibleProducts.length} {visibleProducts.length === 1 ? 'produto' : 'produtos'}</span></div>
        {catalogLoading ? <p className="empty-state">Carregando coleção...</p> : catalogError ? <p className="admin-warning" role="alert">{catalogError}</p> : visibleProducts.length ? <div className="product-grid">{visibleProducts.map((product) => <article className="product-card" key={product.id}><div className="product-photo product-photo-clickable"><button className="product-image-trigger" onClick={() => openProduct(product)} aria-label={`Ver detalhes de ${product.name}`}><img src={product.image} alt={`${product.name}${product.tone ? ` na cor ${product.tone}` : ''}`} loading="lazy" /></button><button className={`favorite-button ${favorites.includes(product.id) ? 'is-favorite' : ''}`} onClick={() => toggleFavorite(product.id)} aria-label={favorites.includes(product.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}><Heart size={18} fill={favorites.includes(product.id) ? 'currentColor' : 'none'} strokeWidth={1.5} /></button><button className="quick-add" onClick={() => openProduct(product)}>Ver detalhes e solicitar <span>+</span></button></div><div className="product-details"><button className="product-title-button" onClick={() => openProduct(product)}><h3>{product.name}</h3><p>{product.tone || product.category} · Ver detalhes</p></button><div className="product-prices"><strong>{money(product.price)}</strong></div></div></article>)}</div> : <div className="empty-state"><p>{products.length ? `Ainda não há produtos publicados em ${activeCategory === 'Todos' ? 'esta busca' : activeCategory}.` : activeCategory === 'Todos' ? 'Estamos preparando as novidades da Pietra. Consulte a disponibilidade pelo WhatsApp.' : `Estamos preparando nosso catálogo de ${activeCategory}. Consulte os modelos e a disponibilidade com a Pietra.`}</p>{!products.length && whatsappNumber && activeCategory !== 'Todos' && <a className="button button-dark" href={`https://wa.me/${whatsappNumber.startsWith('55') ? whatsappNumber : `55${whatsappNumber}`}?text=${encodeURIComponent(`Olá, Pietra! Gostaria de informações sobre ${activeCategory.toLowerCase()}.`)}`} target="_blank" rel="noreferrer">Solicitar informações de {activeCategory} <MessageCircle size={16} /></a>}{!products.length && activeCategory === 'Todos' && <Link className="text-link" href="/admin">Acessar painel de administração</Link>}{!!products.length && <button className="text-link" onClick={() => { setQuery(''); setActiveCategory('Todos'); }}>Ver todos os produtos <ArrowRight size={15} /></button>}</div>}
      </section>

      <section id="sobre" className="story-section"><div className="story-image"><img src="https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=85" alt="Inspiração de moda feminina" loading="lazy" /></div><div className="story-copy"><p className="eyebrow">A ESSÊNCIA PIETRA</p><h2>Mais do que um par.<br /><em>Uma forma de ser.</em></h2><p>Acreditamos que o estilo está nos detalhes, na confiança e na liberdade de ser quem você é. Por isso, cada escolha é um convite para caminhar do seu jeito.</p><a href="#contato" className="button button-outline">Conheça a Pietra <ArrowRight size={16} /></a><span className="story-signature">Com carinho, Pietra.</span></div></section>

      <section className="newsletter-section wrap"><div><p className="eyebrow">CARTAS DA PIETRA</p><h2>Um pouco de beleza<br /><em>na sua caixa de entrada.</em></h2></div><form className="newsletter-form" onSubmit={(event) => { event.preventDefault(); setNotice('Obrigada pelo interesse! A inscrição será ativada quando conectarmos o serviço de e-mail.'); }}><label className="sr-only" htmlFor="newsletter-email">Seu e-mail</label><input id="newsletter-email" type="email" required placeholder="Seu melhor e-mail" /><button type="submit" aria-label="Cadastrar e-mail"><ArrowRight size={18} /></button><p>Novidades, inspirações e lançamentos em primeira mão.</p></form></section>

      <footer id="contato" className="site-footer"><div className="wrap footer-main"><div className="footer-brand"><Logo /><p>Calçados e bolsas femininas para acompanhar<br />a beleza dos seus caminhos.</p></div><div className="footer-column"><h3>Explore</h3><a href="#categorias">Categorias</a><a href="#colecao">Novidades</a><a href="#sobre">Nossa essência</a></div><div className="footer-column"><h3>Atendimento</h3><a href="#contato">Fale conosco</a><a href="#contato">Entrega e retirada</a><a href="#contato">Trocas e devoluções</a></div><div className="footer-contact"><h3>Vamos conversar?</h3><p>Estamos aqui para ajudar você a encontrar o par perfeito.</p>{whatsappUrl ? <a className="footer-whatsapp" href={whatsappUrl} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Conversar no WhatsApp</a> : <small>WhatsApp será habilitado após configurar o contato da loja.</small>}</div></div><div className="wrap footer-bottom"><span>© {new Date().getFullYear()} Pietra Moda Feminina. Todos os direitos reservados.</span><span>Feito com carinho, em cada detalhe.</span></div></footer>
      {selectedProduct && <div className="modal-backdrop" role="presentation" onClick={() => setSelectedProduct(null)}><section className="product-modal" role="dialog" aria-modal="true" aria-label={`Detalhes de ${selectedProduct.name}`} onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedProduct(null)} aria-label="Fechar detalhes"><X size={20} /></button><div className="modal-gallery"><button className="modal-main-image" onClick={() => setZoomOpen(true)} aria-label="Ampliar foto do produto"><img src={selectedProduct.image} alt={selectedProduct.name} /><span><Search size={15} /> Ampliar foto</span></button><p className="zoom-hint">Toque na imagem para visualizar em tamanho ampliado.</p></div><div className="modal-product-info"><p className="eyebrow">PIETRA · CALÇADOS FEMININOS</p><h2>{selectedProduct.name}</h2><p className="modal-tone">Cor: {selectedProduct.tone}</p><div className="modal-price">{selectedProduct.oldPrice && <del>{money(selectedProduct.oldPrice)}</del>}<strong>{money(selectedProduct.price)}</strong></div><p className="modal-description">Um modelo pensado para acompanhar seus momentos com estilo e personalidade. Confira as informações e escolha o tamanho ideal antes de adicionar à sacola.</p><h3>Escolha seu tamanho (BR)</h3><div className="size-grid">{Array.from({ length: 12 }, (_, index) => index + 32).map((size) => <button key={size} className={selectedSize === size ? 'size-option selected' : 'size-option'} onClick={() => setSelectedSize(size)} aria-pressed={selectedSize === size}>{size}</button>)}</div><p className="size-note">Os tamanhos 32 a 43 são exibidos para demonstração. A disponibilidade real deverá ser cadastrada por modelo.</p><button className="button button-dark modal-add" onClick={() => selectedSize ? addToBag(selectedProduct, selectedSize) : setNotice('Selecione um tamanho antes de adicionar à sacola.')}>Adicionar à sacola <ShoppingBag size={16} /></button><p className="modal-help"><MessageCircle size={15} /> Precisa de ajuda? Fale com a Pietra pelo WhatsApp.</p></div></section></div>}
      {zoomOpen && selectedProduct && <div className="zoom-backdrop" role="presentation" onClick={() => setZoomOpen(false)}><button className="zoom-close" onClick={() => setZoomOpen(false)} aria-label="Fechar imagem ampliada"><X size={25} /></button><img src={selectedProduct.image} alt={`Imagem ampliada de ${selectedProduct.name}`} onClick={(event) => event.stopPropagation()} /></div>}
      {notice && <div className="toast" role="status"><Check size={17} />{notice}<button aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {whatsappUrl && <a className="floating-whatsapp" href={whatsappUrl} target="_blank" rel="noreferrer" aria-label="Falar com a Pietra pelo WhatsApp"><MessageCircle size={23} /></a>}
    </main>
  );
}
