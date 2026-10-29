'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ImagePlus, LogOut, PackageSearch, RefreshCw, Search, Save, X } from 'lucide-react';
import AdminAnalytics from './analytics';
import './admin.css';

type Variant = {
  id: string;
  size: number;
  stockQuantity: number;
  reservedQuantity: number;
  color: string | null;
  sku: string;
};

type AdminProduct = {
  id: string;
  name: string;
  priceCents: number;
  reference: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  weightGrams: number;
  widthCm: number;
  heightCm: number;
  lengthCm: number;
  category: { name: string } | null;
  images: { url: string; alt: string; isPrimary: boolean }[];
  variants: Variant[];
};

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [catalogCategory, setCatalogCategory] = useState('Todas');
  const [catalogStatus, setCatalogStatus] = useState('ALL');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [stockValues, setStockValues] = useState<Record<string, string>>({});
  const [dimensionValues, setDimensionValues] = useState<Record<string, string>>({});
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupInstructions, setPickupInstructions] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category?.name ?? 'Sem categoria'))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [products],
  );
  const visibleProducts = useMemo(() => {
    const term = catalogSearch.trim().toLocaleLowerCase('pt-BR');
    return products.filter((product) => {
      const categoryName = product.category?.name ?? 'Sem categoria';
      const matchesCategory = catalogCategory === 'Todas' || categoryName === catalogCategory;
      const matchesStatus = catalogStatus === 'ALL' || product.status === catalogStatus;
      const searchable = [
        product.name,
        product.reference ?? '',
        categoryName,
        ...product.variants.map((variant) => `${variant.sku} ${variant.size} ${variant.color ?? ''}`),
      ].join(' ').toLocaleLowerCase('pt-BR');
      return matchesCategory && matchesStatus && (!term || searchable.includes(term));
    });
  }, [catalogCategory, catalogSearch, catalogStatus, products]);
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;

  const loadProducts = useCallback(async () => {
    const response = await fetch('/api/admin/products', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível carregar os produtos.');
    const loaded = result.products as AdminProduct[];
    setProducts(loaded);
    setStockValues(Object.fromEntries(
      loaded.flatMap((product) =>
        product.variants.map((variant) => [variant.id, String(variant.stockQuantity)]),
      ),
    ));
    setDimensionValues(Object.fromEntries(loaded.flatMap((product) => [
      [`${product.id}-weightGrams`, String(product.weightGrams)],
      [`${product.id}-widthCm`, String(product.widthCm)],
      [`${product.id}-heightCm`, String(product.heightCm)],
      [`${product.id}-lengthCm`, String(product.lengthCm)],
    ])));
    const settingsResponse = await fetch('/api/admin/settings', { cache: 'no-store' });
    const settings = await settingsResponse.json();
    if (!settingsResponse.ok) throw new Error(settings.error || 'Não foi possível carregar as configurações.');
    setPickupAddress(settings.pickupAddress);
    setPickupInstructions(settings.pickupInstructions);
    setAuthenticated(true);
  }, []);

  useEffect(() => {
    loadProducts().catch(() => setAuthenticated(false));
  }, [loadProducts]);

  useEffect(() => {
    if (!selectedProductId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedProductId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedProductId]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível entrar.');
      setPassword('');
      await loadProducts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  async function saveStock(variant: Variant) {
    const quantity = Number(stockValues[variant.id]);
    if (!Number.isInteger(quantity) || quantity < 0) {
      setError('Informe uma quantidade de estoque válida.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId: variant.id,
          quantity,
          note: 'Atualização de estoque pelo painel administrativo',
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o estoque.');
      setNotice('Estoque salvo.');
      await loadProducts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o estoque.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(product: AdminProduct) {
    const status = product.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE';
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar o produto.');
      setNotice(status === 'ACTIVE' ? 'Produto publicado na loja.' : 'Produto retirado da loja.');
      await loadProducts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o produto.');
    } finally {
      setBusy(false);
    }
  }

  async function importImage(product: AdminProduct) {
    const sourceUrl = product.images[0]?.url;
    if (!sourceUrl) {
      setError('Este produto não tem uma foto de origem.');
      return;
    }
    if (new URL(sourceUrl).hostname !== 'cdn.meucatalogodigital.com') {
      setError('A foto deste produto já está hospedada fora do fornecedor.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/products/${product.id}/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível importar a foto.');
      setNotice('Foto copiada para o Supabase Storage.');
      await loadProducts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível importar a foto.');
    } finally {
      setBusy(false);
    }
  }

  async function saveStoreSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickupAddress, pickupInstructions }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar as configurações.');
      setNotice('Opções de retirada salvas.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar as configurações.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDimensions(product: AdminProduct) {
    const fields = ['weightGrams', 'widthCm', 'heightCm', 'lengthCm'] as const;
    const dimensions = Object.fromEntries(fields.map((field) => [
      field,
      Number(dimensionValues[`${product.id}-${field}`]),
    ]));
    if (Object.values(dimensions).some((value) => !Number.isInteger(value) || value < 0)) {
      setError('Informe peso e dimensões usando números inteiros não negativos.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dimensions),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar as dimensões.');
      setNotice('Peso e dimensões salvos.');
      await loadProducts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar as dimensões.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Não foi possível encerrar a sessão.');
      setAuthenticated(false);
      setProducts([]);
      setSelectedProductId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível encerrar a sessão.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="store-page">
      <header className="simple-header">
        <Link href="/" className="simple-brand">PIETRA<span>PAINEL ADMINISTRATIVO</span></Link>
        {authenticated ? (
          <button className="back-link" type="button" onClick={logout} disabled={busy}>
            <LogOut size={16} /> Sair
          </button>
        ) : (
          <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar à loja</Link>
        )}
      </header>

      <div className="store-content">
        <p className="eyebrow">GESTÃO DA LOJA</p>
        <h1 className="store-title">Gestão da <em>Pietra.</em></h1>
        {error && <p className="admin-warning" role="alert">{error}</p>}
        {notice && <p className="saved-note" role="status">{notice}</p>}

        {!authenticated ? (
          <form className="admin-form" onSubmit={login}>
            <h2>Entrar no painel</h2>
            <div className="form-grid">
              <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            </div>
            <button className="button button-dark" type="submit" disabled={busy}>Entrar</button>
          </form>
        ) : (
          <>
            <AdminAnalytics />
            <section id="catalogo" className="admin-catalog-section">
            <form className="admin-form" onSubmit={saveStoreSettings}>
              <h2>Retirada na loja</h2>
              <div className="form-grid">
                <label>Endereço de retirada<input value={pickupAddress} onChange={(event) => setPickupAddress(event.target.value)} maxLength={500} placeholder="Preencha para habilitar a retirada" /></label>
                <label>Instruções ao cliente<input value={pickupInstructions} onChange={(event) => setPickupInstructions(event.target.value)} maxLength={1000} placeholder="Horário e orientações, se aplicável" /></label>
              </div>
              <button className="button button-dark" type="submit" disabled={busy}>Salvar opções de retirada</button>
            </form>
            <div className="admin-warning">
              Produtos importados começam como rascunho e sem estoque. Cadastre as quantidades reais por tamanho antes de publicar.
            </div>
            <div className="admin-products">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">ORGANIZE SUA VITRINE</p>
                  <h2 id="estoque">Catálogo e estoque ({products.length})</h2>
                </div>
                <button className="text-link" type="button" onClick={() => loadProducts().catch((reason) => setError(reason.message))} disabled={busy}>
                  <RefreshCw size={15} /> Atualizar
                </button>
              </div>
              <div className="catalog-toolbar">
                <label className="catalog-search">
                  <Search size={17} />
                  <input
                    type="search"
                    value={catalogSearch}
                    onChange={(event) => setCatalogSearch(event.target.value)}
                    placeholder="Buscar por produto, referência, tamanho ou SKU"
                    aria-label="Buscar produtos no catálogo"
                  />
                </label>
                <label className="catalog-status-filter">
                  <span>Situação</span>
                  <select value={catalogStatus} onChange={(event) => setCatalogStatus(event.target.value)}>
                    <option value="ALL">Todas</option>
                    <option value="ACTIVE">Publicados</option>
                    <option value="DRAFT">Rascunhos</option>
                    <option value="ARCHIVED">Arquivados</option>
                  </select>
                </label>
              </div>
              <div className="catalog-category-filters" aria-label="Filtrar por categoria">
                {['Todas', ...categories].map((category) => {
                  const count = category === 'Todas'
                    ? products.length
                    : products.filter((product) => (product.category?.name ?? 'Sem categoria') === category).length;
                  return (
                    <button
                      type="button"
                      key={category}
                      className={`catalog-category-chip${catalogCategory === category ? ' selected' : ''}`}
                      onClick={() => setCatalogCategory(category)}
                      aria-pressed={catalogCategory === category}
                    >
                      {category}<span>{count}</span>
                    </button>
                  );
                })}
              </div>
              {!products.length ? (
                <p>Nenhum produto encontrado. Configure o banco e execute a importação documentada no README.</p>
              ) : visibleProducts.length ? (
                <div className="admin-catalog-grid">
                  {visibleProducts.map((product) => {
                    const categoryName = product.category?.name ?? 'Sem categoria';
                    const available = product.variants.reduce((total, variant) => total + Math.max(0, variant.stockQuantity - variant.reservedQuantity), 0);
                    return (
                      <button
                        type="button"
                        className="admin-catalog-card"
                        key={product.id}
                        onClick={() => { setSelectedProductId(product.id); setError(''); setNotice(''); }}
                        aria-label={`Abrir ${product.name} para editar`}
                      >
                        <span className="admin-catalog-image">
                          {product.images[0]?.url
                            ? <img src={product.images[0].url} alt={product.images[0].alt || product.name} loading="lazy" />
                            : <span className="admin-catalog-no-image"><PackageSearch size={27} />Sem foto</span>}
                          <span className={`admin-product-badge ${product.status.toLowerCase()}`}>
                            {product.status === 'ACTIVE' ? 'Publicado' : product.status === 'DRAFT' ? 'Rascunho' : 'Arquivado'}
                          </span>
                        </span>
                        <span className="admin-catalog-card-info">
                          <span className="admin-catalog-category">{categoryName}</span>
                          <strong>{product.name}</strong>
                          <span className="admin-catalog-card-meta">{money(product.priceCents)} · {available} {available === 1 ? 'unidade' : 'unidades'} disponíveis</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="catalog-empty">
                  <PackageSearch size={27} />
                  <strong>Nenhum produto encontrado</strong>
                  <span>Ajuste a busca ou os filtros para ver outros itens.</span>
                  <button type="button" className="text-link" onClick={() => { setCatalogSearch(''); setCatalogCategory('Todas'); setCatalogStatus('ALL'); }}>Limpar filtros</button>
                </div>
              )}
            </div>
            </section>
          </>
        )}
      </div>
      {authenticated && selectedProduct && (
        <div className="catalog-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProductId(null); }}>
          <section className="catalog-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-modal-title">
            <header className="catalog-modal-header">
              <div>
                <p className="eyebrow">{selectedProduct.category?.name ?? 'Sem categoria'} · {selectedProduct.status === 'ACTIVE' ? 'Publicado' : selectedProduct.status === 'DRAFT' ? 'Rascunho' : 'Arquivado'}</p>
                <h2 id="catalog-modal-title">{selectedProduct.name}</h2>
                <span>{money(selectedProduct.priceCents)}{selectedProduct.reference ? ` · Ref. ${selectedProduct.reference}` : ''}</span>
              </div>
              <button type="button" className="catalog-modal-close" onClick={() => setSelectedProductId(null)} aria-label="Fechar edição do produto"><X size={20} /></button>
            </header>
            <div className="catalog-modal-content">
              {error && <p className="admin-warning" role="alert">{error}</p>}
              {notice && <p className="saved-note" role="status">{notice}</p>}
              <div className="catalog-modal-product-summary">
                {selectedProduct.images[0]?.url
                  ? <img src={selectedProduct.images[0].url} alt={selectedProduct.images[0].alt || selectedProduct.name} />
                  : <div className="admin-catalog-no-image"><PackageSearch size={27} />Sem foto</div>}
                <p>Atualize o estoque real e as medidas. Um produto só aparece para clientes depois de publicado e com unidades disponíveis.</p>
              </div>
              <section className="catalog-modal-section">
                <div className="catalog-modal-section-heading"><h3>Estoque por tamanho</h3><span>Unidades disponíveis por variante</span></div>
                <div className="stock-grid">
                  {selectedProduct.variants.map((variant) => (
                    <label key={variant.id}>
                      {variant.size === 0 ? 'Único' : variant.size}
                      <input
                        type="number"
                        min={variant.reservedQuantity}
                        aria-label={`Estoque ${variant.size === 0 ? 'único' : `tamanho ${variant.size}`} de ${selectedProduct.name}`}
                        value={stockValues[variant.id] ?? variant.stockQuantity}
                        onChange={(event) => setStockValues((current) => ({ ...current, [variant.id]: event.target.value }))}
                      />
                      <small>SKU {variant.sku} · Reservado: {variant.reservedQuantity}</small>
                      <button type="button" onClick={() => saveStock(variant)} disabled={busy}>
                        <Save size={13} /> Salvar estoque
                      </button>
                    </label>
                  ))}
                </div>
              </section>
              <section className="catalog-modal-section">
                <div className="catalog-modal-section-heading"><h3>Medidas para envio</h3><span>Informe as medidas reais do pacote</span></div>
                <div className="form-grid">
                  {([
                    ['weightGrams', 'Peso (g)'],
                    ['widthCm', 'Largura (cm)'],
                    ['heightCm', 'Altura (cm)'],
                    ['lengthCm', 'Comprimento (cm)'],
                  ] as const).map(([field, label]) => (
                    <label key={field}>{label}
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={dimensionValues[`${selectedProduct.id}-${field}`] ?? 0}
                        onChange={(event) => setDimensionValues((current) => ({ ...current, [`${selectedProduct.id}-${field}`]: event.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <button className="button button-dark" type="button" onClick={() => saveDimensions(selectedProduct)} disabled={busy}>
                  <Save size={15} /> Salvar medidas
                </button>
              </section>
              <footer className="catalog-modal-actions">
                <button className="catalog-image-action" type="button" onClick={() => importImage(selectedProduct)} disabled={busy || !selectedProduct.images[0]?.url.startsWith('https://cdn.meucatalogodigital.com/')}>
                  <ImagePlus size={16} /> Copiar imagem para Supabase
                </button>
                <button className="button button-dark" type="button" onClick={() => toggleStatus(selectedProduct)} disabled={busy}>
                  {selectedProduct.status === 'ACTIVE' ? 'Retirar da loja' : 'Publicar produto'}
                </button>
              </footer>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
