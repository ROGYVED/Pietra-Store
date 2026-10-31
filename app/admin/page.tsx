'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, ImagePlus, LogOut, PackageSearch, Plus, RefreshCw, Search, Save, Trash2, X } from 'lucide-react';
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
  images: { id: string; url: string; alt: string; isPrimary: boolean }[];
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
  const [showNewProductForm, setShowNewProductForm] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductReference, setNewProductReference] = useState('');
  const [newProductSku, setNewProductSku] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductSize, setNewProductSize] = useState('0');
  const [newProductStock, setNewProductStock] = useState('0');
  const [newProductColor, setNewProductColor] = useState('');
  const [newProductImages, setNewProductImages] = useState<{ file: File; url: string }[]>([]);
  const [zoomedImage, setZoomedImage] = useState<{ url: string; alt: string } | null>(null);

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
    return () => newProductImages.forEach((image) => URL.revokeObjectURL(image.url));
  }, [newProductImages]);

  useEffect(() => {
    if (!selectedProductId && !zoomedImage) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (zoomedImage) setZoomedImage(null);
        else setSelectedProductId(null);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedProductId, zoomedImage]);

  function chooseNewProductImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length > 5) {
      setError('Selecione no máximo 5 fotos para o produto.');
      return;
    }
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setError('As fotos precisam ser PNG, JPEG ou WebP e ter até 5 MB cada.');
      return;
    }
    setError('');
    setNewProductImages(files.map((file) => ({ file, url: URL.createObjectURL(file) })));
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = Number(newProductPrice.replace(',', '.'));
    const size = Number(newProductSize);
    const stockQuantity = Number(newProductStock);
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(size) || size < 0 || size > 43 ||
      !Number.isInteger(stockQuantity) || stockQuantity < 0) {
      setError('Confira o preço, o tamanho e a quantidade inicial do estoque.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    let createdProductId: string | null = null;
    let uploadedImages = 0;
    try {
      const response = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProductName,
          reference: newProductReference || undefined,
          sku: newProductSku,
          priceCents: Math.round(price * 100),
          size,
          stockQuantity,
          color: newProductColor || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível cadastrar o produto.');
      createdProductId = result.product.id as string;

      for (const { file } of newProductImages) {
        const formData = new FormData();
        formData.append('image', file, file.name);
        const imageResponse = await fetch(`/api/admin/products/${createdProductId}/image`, {
          method: 'POST',
          body: formData,
        });
        const imageResult = await imageResponse.json();
        if (!imageResponse.ok) throw new Error(imageResult.error || 'Não foi possível enviar uma das fotos.');
        uploadedImages += 1;
      }

      setNotice(`Produto cadastrado${uploadedImages ? ` com ${uploadedImages} foto(s)` : ''}. Ele ficará como rascunho até ser publicado.`);
      setShowNewProductForm(false);
      setNewProductName('');
      setNewProductReference('');
      setNewProductSku('');
      setNewProductPrice('');
      setNewProductSize('0');
      setNewProductStock('0');
      setNewProductColor('');
      setNewProductImages([]);
      await loadProducts();
      setSelectedProductId(createdProductId);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível cadastrar o produto.';
      if (createdProductId) {
        setNotice(`Produto cadastrado${uploadedImages ? ` com ${uploadedImages} foto(s)` : ''}.`);
        setError(`O produto foi criado, mas uma foto não pôde ser enviada: ${message} Você poderá tentar novamente na edição do produto.`);
        setShowNewProductForm(false);
        setNewProductImages([]);
        setNewProductName('');
        setNewProductReference('');
        setNewProductSku('');
        setNewProductPrice('');
        setNewProductSize('0');
        setNewProductStock('0');
        setNewProductColor('');
        try {
          await loadProducts();
          setSelectedProductId(createdProductId);
        } catch (loadError) {
          setError(loadError instanceof Error ? loadError.message : message);
        }
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function uploadProductImages(product: AdminProduct, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) return;
    if (product.images.length + files.length > 5) {
      setError(`Este produto pode ter até 5 fotos. Ainda é possível adicionar ${5 - product.images.length}.`);
      return;
    }
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setError('As fotos precisam ser PNG, JPEG ou WebP e ter até 5 MB cada.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    let uploaded = 0;
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('image', file, file.name);
        const response = await fetch(`/api/admin/products/${product.id}/image`, { method: 'POST', body: formData });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível enviar as fotos.');
        uploaded += 1;
      }
      setNotice(`${uploaded} foto(s) adicionada(s) ao produto.`);
      await loadProducts();
    } catch (reason) {
      setError(`${uploaded ? `${uploaded} foto(s) adicionada(s). ` : ''}${reason instanceof Error ? reason.message : 'Não foi possível enviar as fotos.'}`);
      try {
        await loadProducts();
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Não foi possível atualizar as fotos.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteProductImage(product: AdminProduct, imageId: string) {
    if (!window.confirm('Deseja excluir esta foto do produto?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/products/${product.id}/image`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível excluir a foto.');
      setNotice(result.storageCleanupFailed
        ? 'Foto removida do produto. O arquivo não pôde ser removido do armazenamento.'
        : 'Foto removida do produto.');
      await loadProducts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir a foto.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteProduct(product: AdminProduct) {
    if (!window.confirm(`Excluir o produto "${product.name}"? Esta ação não pode ser desfeita. Os pedidos e o histórico de estoque serão preservados.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/products/${product.id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível excluir o produto.');
      setSelectedProductId(null);
      setNotice('Produto excluído. Os pedidos e o histórico de estoque foram preservados.');
      await loadProducts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o produto.');
    } finally {
      setBusy(false);
    }
  }

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

  async function bulkProductStatus(status: 'ACTIVE' | 'DRAFT') {
    const publish = status === 'ACTIVE';
    const confirmed = window.confirm(publish
      ? 'Publicar todos os produtos com estoque disponível? Produtos arquivados e sem estoque serão ignorados.'
      : 'Retirar todos os produtos publicados da loja? Eles continuarão cadastrados no painel e no histórico.');
    if (!confirmed) return;

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/products/bulk-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await response.json() as { affectedCount?: number; eligibleCount?: number; error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar o catálogo.');
      await loadProducts();
      if (publish) {
        setNotice(`${result.affectedCount ?? 0} produto(s) novo(s) publicado(s). ${result.eligibleCount ?? 0} produto(s) têm estoque disponível; produtos arquivados ou sem estoque foram ignorados.`);
      } else {
        setNotice(`${result.affectedCount ?? 0} produto(s) retirado(s) da loja. Os cadastros e históricos foram preservados.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o catálogo.');
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
                <div className="catalog-heading-actions">
                  <button className="text-link" type="button" onClick={() => loadProducts().catch((reason) => setError(reason.message))} disabled={busy}>
                    <RefreshCw size={15} /> Atualizar
                  </button>
                  <button className="button button-dark" type="button" onClick={() => { setShowNewProductForm(!showNewProductForm); setError(''); setNotice(''); }} disabled={busy}>
                    <Plus size={16} /> Adicionar produto
                  </button>
                </div>
              </div>
              <div className="catalog-bulk-actions">
                <button type="button" className="catalog-bulk-publish" onClick={() => void bulkProductStatus('ACTIVE')} disabled={busy || !products.length}>
                  <Eye size={15} /> {busy ? 'Atualizando...' : 'Publicar todos com estoque'}
                </button>
                <button type="button" className="catalog-bulk-unpublish" onClick={() => void bulkProductStatus('DRAFT')} disabled={busy}>
                  <EyeOff size={15} /> {busy ? 'Atualizando...' : 'Retirar todos da loja'}
                </button>
              </div>
              {showNewProductForm && (
                <form className="admin-form admin-new-product-form" onSubmit={createProduct}>
                  <h3>Adicionar mercadoria ao estoque</h3>
                  <div className="form-grid">
                    <label>Nome do produto<input required minLength={2} maxLength={160} value={newProductName} onChange={(event) => setNewProductName(event.target.value)} /></label>
                    <label>Referência (opcional)<input maxLength={80} value={newProductReference} onChange={(event) => setNewProductReference(event.target.value)} /></label>
                    <label>SKU / código da variante<input required maxLength={100} value={newProductSku} onChange={(event) => setNewProductSku(event.target.value)} /></label>
                    <label>Preço (R$)<input type="number" min="0.01" step="0.01" required value={newProductPrice} onChange={(event) => setNewProductPrice(event.target.value)} /></label>
                    <label>Tamanho (0 para tamanho único)<input type="number" min="0" max="43" step="1" required value={newProductSize} onChange={(event) => setNewProductSize(event.target.value)} /></label>
                    <label>Quantidade inicial no estoque<input type="number" min="0" step="1" required value={newProductStock} onChange={(event) => setNewProductStock(event.target.value)} /></label>
                    <label>Cor (opcional)<input maxLength={80} value={newProductColor} onChange={(event) => setNewProductColor(event.target.value)} /></label>
                    <label className="admin-photo-input">Fotos do produto (até 5)
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseNewProductImages} />
                      <small>PNG, JPEG ou WebP; até 5 MB por foto.</small>
                    </label>
                  </div>
                  {!!newProductImages.length && (
                    <div className="admin-photo-previews">
                      {newProductImages.map(({ file, url }, index) => (
                        <button className="admin-photo-preview" key={`${file.name}-${file.lastModified}-${index}`} type="button" onClick={() => setZoomedImage({ url, alt: file.name })} title="Ampliar foto">
                          <img src={url} alt={file.name} />
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="admin-form-hint">O produto será criado como rascunho. Depois, revise o estoque e as medidas e publique quando estiver pronto.</p>
                  <div className="catalog-create-actions">
                    <button className="text-link" type="button" onClick={() => { setShowNewProductForm(false); setNewProductImages([]); }} disabled={busy}>Cancelar</button>
                    <button className="button button-dark" type="submit" disabled={busy}>{busy ? 'Cadastrando...' : 'Cadastrar mercadoria'}</button>
                  </div>
                </form>
              )}
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
                  ? <button className="admin-photo-summary" type="button" onClick={() => setZoomedImage({ url: selectedProduct.images[0].url, alt: selectedProduct.images[0].alt || selectedProduct.name })} aria-label="Ampliar foto do produto">
                    <img src={selectedProduct.images[0].url} alt={selectedProduct.images[0].alt || selectedProduct.name} />
                  </button>
                  : <div className="admin-catalog-no-image"><PackageSearch size={27} />Sem foto</div>}
                <p>Atualize o estoque real e as medidas. Um produto só aparece para clientes depois de publicado e com unidades disponíveis.</p>
              </div>
              <section className="catalog-modal-section">
                <div className="catalog-modal-section-heading"><h3>Fotos do produto</h3><span>{selectedProduct.images.length} de 5 fotos</span></div>
                {selectedProduct.images.length > 0 && (
                  <div className="admin-product-photos">
                    {selectedProduct.images.map((image, index) => (
                      <div className="admin-product-photo" key={image.id}>
                        <button className="admin-photo-preview" type="button" onClick={() => setZoomedImage({ url: image.url, alt: image.alt || `${selectedProduct.name}, foto ${index + 1}` })} aria-label={`Ampliar foto ${index + 1}`}>
                          <img src={image.url} alt={image.alt || `${selectedProduct.name}, foto ${index + 1}`} />
                          {image.isPrimary && <span>Principal</span>}
                        </button>
                        <button className="admin-photo-delete" type="button" onClick={() => deleteProductImage(selectedProduct, image.id)} disabled={busy}>
                          <Trash2 size={13} /> Excluir foto
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className={`catalog-image-action admin-add-photo${busy || selectedProduct.images.length >= 5 ? ' disabled' : ''}`}>
                  <ImagePlus size={16} /> Adicionar fotos
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || selectedProduct.images.length >= 5} onChange={(event) => uploadProductImages(selectedProduct, event)} />
                </label>
                <p className="admin-form-hint">PNG, JPEG ou WebP; até 5 MB por foto. Clique em uma foto para ampliá-la.</p>
              </section>
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
                <button className="catalog-delete-product" type="button" onClick={() => deleteProduct(selectedProduct)} disabled={busy}>
                  <Trash2 size={15} /> Excluir produto
                </button>
                <button className="button button-dark" type="button" onClick={() => toggleStatus(selectedProduct)} disabled={busy}>
                  {selectedProduct.status === 'ACTIVE' ? 'Retirar da loja' : 'Publicar produto'}
                </button>
              </footer>
            </div>
          </section>
        </div>
      )}
      {zoomedImage && (
        <div className="admin-image-zoom" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setZoomedImage(null); }}>
          <button type="button" onClick={() => setZoomedImage(null)} aria-label="Fechar foto ampliada"><X size={24} /></button>
          <img src={zoomedImage.url} alt={zoomedImage.alt} />
        </div>
      )}
    </main>
  );
}
