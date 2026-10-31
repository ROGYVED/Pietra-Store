'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, FileDown, RefreshCw, Search, TrendingUp } from 'lucide-react';

type Period = '7d' | '30d' | '90d' | 'all';
type Summary = {
  paidOrders: number;
  orders: number;
  paidRevenueCents: number;
  merchandiseRevenueCents: number;
  shippingRevenueCents: number;
  averageOrderCents: number;
  pendingOrders: number;
  pendingRevenueCents: number;
  unitsSold: number;
  productCostCents: number | null;
  estimatedGrossProfitCents: number | null;
  providerFeeCents: number | null;
  netAfterProductCostAndFeesCents: number | null;
  costCoverage: { knownLines: number; totalLines: number };
  feeCoverage: { knownPayments: number; approvedPayments: number };
};
type Analytics = {
  summary: Summary;
  topProducts: { name: string; units: number; revenueCents: number; costCents: number | null }[];
  trend: { day: string; revenueCents: number }[];
  inventory: { activeProducts: number; draftProducts: number; lowStockVariants: number };
  note: string;
};
type OrderItem = {
  id: string;
  productName: string;
  productImage: string | null;
  sku: string | null;
  size: number;
  color: string | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
};
type Order = {
  id: string;
  code: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  status: string;
  paymentStatus: string;
  fulfillmentType: string;
  shippingName: string | null;
  shippingCents: number;
  subtotalCents: number;
  totalCents: number;
  createdAt: string;
  items: OrderItem[];
  payments: { provider: string; method: string; status: string; providerPaymentId: string | null; providerFeeCents: number | null }[];
};
type View = 'overview' | 'sales';

const money = (value: number) =>
  (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const statusNames: Record<string, string> = {
  PENDING_PAYMENT: 'Aguardando pagamento',
  PAID: 'Pago',
  PROCESSING: 'Em preparação',
  SHIPPED: 'Enviado',
  READY_FOR_PICKUP: 'Pronto para retirada',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  REFUND_PENDING: 'Reembolso solicitado',
  REFUNDED: 'Reembolsado',
};
const paymentNames: Record<string, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado',
  REFUNDED: 'Reembolsado',
};
const periodNames: Record<Period, string> = {
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  all: 'Todo o período',
};

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toCsvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default function AdminAnalytics() {
  const [view, setView] = useState<View>('overview');
  const [period, setPeriod] = useState<Period>('30d');
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancellationBusy, setCancellationBusy] = useState(false);
  const [cancellationNotice, setCancellationNotice] = useState('');

  const loadAnalytics = useCallback(async () => {
    const response = await fetch(`/api/admin/analytics?period=${period}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível carregar o financeiro.');
    setAnalytics(result as Analytics);
  }, [period]);

  const loadOrders = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: '25', status });
    if (search) params.set('search', search);
    if (period !== 'all') {
      const days = Number(period.slice(0, -1));
      const from = new Date();
      from.setDate(from.getDate() - days);
      params.set('from', localDate(from));
    }
    const response = await fetch(`/api/admin/orders?${params}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível carregar as vendas.');
    setOrders(result.orders as Order[]);
    setPages(Math.max(1, result.pagination.pages));
  }, [page, period, search, status]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadAnalytics(), loadOrders()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os dados.');
    } finally {
      setLoading(false);
    }
  }, [loadAnalytics, loadOrders]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const maxDailyRevenue = useMemo(
    () => Math.max(1, ...(analytics?.trend.map((item) => item.revenueCents) ?? [])),
    [analytics],
  );

  function exportSales() {
    const rows = [
      ['Pedido', 'Data', 'Cliente', 'Telefone', 'E-mail', 'Status do pedido', 'Pagamento', 'Itens', 'Subtotal', 'Frete', 'Total'],
      ...orders.map((order) => [
        order.code,
        new Date(order.createdAt).toLocaleString('pt-BR'),
        order.customerName,
        order.customerPhone,
        order.customerEmail ?? '',
        statusNames[order.status] ?? order.status,
        paymentNames[order.paymentStatus] ?? order.paymentStatus,
        order.items.map((item) => `${item.quantity}x ${item.productName}`).join('; '),
        (order.subtotalCents / 100).toFixed(2),
        (order.shippingCents / 100).toFixed(2),
        (order.totalCents / 100).toFixed(2),
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(toCsvCell).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pietra-vendas-pagina-${page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function cancelOrder(order: Order) {
    if (!window.confirm(`Cancelar o pedido ${order.code}? A reserva de estoque será liberada, mas o registro do pedido será preservado.`)) return;
    setCancellationBusy(true);
    setError('');
    setCancellationNotice('');
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED', note: 'Cancelado pelo painel administrativo.' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível cancelar o pedido.');
      await refresh();
      setCancellationNotice(`Pedido ${order.code} cancelado. A reserva de estoque foi liberada.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível cancelar o pedido.');
    } finally {
      setCancellationBusy(false);
    }
  }

  async function cancelAllPendingOrders() {
    if (!window.confirm('Cancelar todos os pedidos que aguardam pagamento, inclusive os fora do período e da página atuais? O histórico será preservado e as reservas de estoque liberadas.')) return;
    setCancellationBusy(true);
    setError('');
    setCancellationNotice('');
    let cancelledTotal = 0;
    let pendingCount = 0;
    try {
      for (let batch = 0; batch < 20; batch += 1) {
        const response = await fetch('/api/admin/orders/cancel-pending', { method: 'POST' });
        const result = await response.json() as { cancelledCount?: number; pendingCount?: number; error?: string };
        if (!response.ok) throw new Error(result.error || 'Não foi possível cancelar os pedidos pendentes.');
        cancelledTotal += result.cancelledCount ?? 0;
        pendingCount = result.pendingCount ?? 0;
        if (pendingCount === 0) break;
        if (!result.cancelledCount) throw new Error('Os pedidos pendentes mudaram durante a operação. Atualize a lista e tente novamente.');
      }
      await refresh();
      setCancellationNotice(pendingCount > 0
        ? `${cancelledTotal} pedidos cancelados. Ainda restam ${pendingCount} pendentes; clique novamente para continuar.`
        : `${cancelledTotal} pedidos pendentes cancelados. O histórico foi preservado e as reservas foram liberadas.`);
    } catch (reason) {
      await refresh();
      setError(reason instanceof Error ? reason.message : 'Não foi possível cancelar os pedidos pendentes.');
    } finally {
      setCancellationBusy(false);
    }
  }

  const summary = analytics?.summary;

  return (
    <section className="admin-analytics" aria-label="Vendas e financeiro">
      <div className="analytics-heading">
        <div>
          <p className="eyebrow">VISÃO DO NEGÓCIO</p>
          <h2>Vendas &amp; financeiro</h2>
        </div>
        <div className="analytics-actions">
          <label className="period-select">
            <span>Período</span>
            <select value={period} onChange={(event) => { setPeriod(event.target.value as Period); setPage(1); }}>
              {Object.entries(periodNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <button type="button" className="analytics-icon-button" onClick={() => void refresh()} disabled={loading} aria-label="Atualizar dados">
            <RefreshCw size={17} />
          </button>
        </div>
      </div>

      <nav className="analytics-tabs" aria-label="Seções do painel">
        <button type="button" className={view === 'overview' ? 'selected' : ''} onClick={() => setView('overview')}>Resumo</button>
        <button type="button" className={view === 'sales' ? 'selected' : ''} onClick={() => setView('sales')}>Vendas por pedido</button>
      </nav>

      {error && <p className="admin-warning" role="alert">{error}</p>}
      {loading && !analytics ? <p className="analytics-loading">Carregando os dados da loja...</p> : null}
      {analytics && view === 'overview' && summary && (
        <>
          <div className="finance-cards">
            <article className="finance-card finance-card-featured">
              <span>Vendas pagas</span>
              <strong>{money(summary.paidRevenueCents)}</strong>
              <small>{summary.paidOrders} pedidos confirmados · {periodNames[period].toLowerCase()}</small>
            </article>
            <article className="finance-card">
              <span>Ticket médio</span>
              <strong>{money(summary.averageOrderCents)}</strong>
              <small>Somente pedidos com pagamento aprovado</small>
            </article>
            <article className="finance-card">
              <span>Em pagamentos pendentes</span>
              <strong>{money(summary.pendingRevenueCents)}</strong>
              <small>{summary.pendingOrders} pedidos aguardando confirmação</small>
            </article>
            <article className="finance-card">
              <span>Resultado bruto estimado</span>
              <strong>{summary.estimatedGrossProfitCents === null ? '—' : money(summary.estimatedGrossProfitCents)}</strong>
              <small>{summary.costCoverage.knownLines}/{summary.costCoverage.totalLines} itens com custo registrado</small>
            </article>
            <article className="finance-card">
              <span>Taxas Mercado Pago</span>
              <strong>{summary.providerFeeCents === null ? '—' : money(summary.providerFeeCents)}</strong>
              <small>{summary.feeCoverage.knownPayments}/{summary.feeCoverage.approvedPayments} pagamentos com taxa registrada</small>
            </article>
            <article className="finance-card">
              <span>Após custo e taxas</span>
              <strong>{summary.netAfterProductCostAndFeesCents === null ? '—' : money(summary.netAfterProductCostAndFeesCents)}</strong>
              <small>Não inclui impostos nem outras despesas</small>
            </article>
          </div>

          <div className="analytics-secondary">
            <div className="analytics-panel revenue-panel">
              <div className="panel-title-row"><div><h3>Faturamento diário</h3><p>Pedidos pagos · últimos 30 dias</p></div><TrendingUp size={19} /></div>
              {analytics.trend.length ? (
                <div className="revenue-chart" role="img" aria-label="Gráfico de faturamento diário dos últimos 30 dias">
                  {analytics.trend.map((entry) => (
                    <div className="revenue-bar-column" key={entry.day} title={`${new Date(`${entry.day}T12:00:00`).toLocaleDateString('pt-BR')}: ${money(entry.revenueCents)}`}>
                      <div className="revenue-bar" style={{ height: `${Math.max(4, entry.revenueCents / maxDailyRevenue * 100)}%` }} />
                    </div>
                  ))}
                </div>
              ) : <p className="analytics-empty">As vendas confirmadas aparecerão aqui.</p>}
              <div className="chart-caption"><span>30 dias atrás</span><strong>{money(summary.merchandiseRevenueCents)} em produtos</strong><span>Hoje</span></div>
            </div>

            <div className="analytics-panel">
              <div className="panel-title-row"><div><h3>Mais vendidos</h3><p>Unidades em pedidos pagos</p></div></div>
              {analytics.topProducts.length ? (
                <ol className="top-products-list">
                  {analytics.topProducts.map((item, index) => (
                    <li key={`${item.name}-${index}`}>
                      <span className="rank-number">{String(index + 1).padStart(2, '0')}</span>
                      <span className="top-product-name">{item.name}<small>{item.units} {item.units === 1 ? 'unidade' : 'unidades'}</small></span>
                      <strong>{money(item.revenueCents)}</strong>
                    </li>
                  ))}
                </ol>
              ) : <p className="analytics-empty">Nenhum produto vendido nesse período.</p>}
            </div>
          </div>

          <div className="analytics-footnote">
            <span>Catálogo: {analytics.inventory.activeProducts} publicados · {analytics.inventory.draftProducts} rascunhos · {analytics.inventory.lowStockVariants} variantes com estoque baixo.</span>
            <span>{analytics.note}</span>
          </div>
          <button className="analytics-link" type="button" onClick={() => setView('sales')}>Consultar cada venda <span>→</span></button>
        </>
      )}

      {analytics && view === 'sales' && (
        <div className="analytics-panel sales-panel">
          <div className="sales-toolbar">
            <div><h3>Pedidos e vendas</h3><p>Acompanhe cliente, itens, pagamento e entrega por pedido.</p></div>
            <div className="sales-toolbar-actions">
              {status === 'PENDING_PAYMENT' && (
                <button type="button" className="cancel-pending-button" onClick={() => void cancelAllPendingOrders()} disabled={cancellationBusy || loading}>
                  <Ban size={15} /> {cancellationBusy ? 'Cancelando...' : 'Cancelar todos os pendentes'}
                </button>
              )}
              <button type="button" className="export-button" onClick={exportSales} disabled={!orders.length}><FileDown size={16} /> Exportar página CSV</button>
            </div>
          </div>
          {cancellationNotice && <p className="cancellation-notice" role="status">{cancellationNotice}</p>}
          <div className="sales-filters">
            <label className="sales-search"><Search size={16} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar por pedido, cliente ou telefone" /></label>
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Filtrar por status">
              <option value="ALL">Todos os status</option>
              {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {orders.length ? (
            <div className="sales-table-wrap">
              <table className="sales-table">
                <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Pagamento</th><th>Status</th><th>Total</th></tr></thead>
                <tbody>{orders.map((order) => (
                  <tr key={order.id}>
                    <td colSpan={6}>
                      <details className="sale-detail">
                        <summary>
                          <span className="sale-code">{order.code}</span>
                          <span>{order.customerName}</span>
                          <span>{new Date(order.createdAt).toLocaleDateString('pt-BR')}</span>
                          <span><i className={`status-dot ${order.paymentStatus.toLowerCase()}`} />{paymentNames[order.paymentStatus] ?? order.paymentStatus}</span>
                          <span>{statusNames[order.status] ?? order.status}</span>
                          <strong>{money(order.totalCents)}</strong>
                        </summary>
                        <div className="sale-expanded">
                          <div className="sale-customer">
                            <strong>Dados do cliente</strong>
                            <span>{order.customerName} · {order.customerPhone}</span>
                            {order.customerEmail && <span>{order.customerEmail}</span>}
                            <span>{order.fulfillmentType === 'PICKUP' ? 'Retirada na loja' : `${order.shippingName ?? 'Entrega'} · ${money(order.shippingCents)}`}</span>
                            {order.payments[0] && <span>Pagamento: {order.payments[0].provider} · {order.payments[0].method} · {paymentNames[order.payments[0].status] ?? order.payments[0].status}</span>}
                            {order.paymentStatus === 'APPROVED' && <span>Taxa Mercado Pago: {order.payments[0]?.providerFeeCents == null ? 'aguardando retorno do provedor' : money(order.payments[0].providerFeeCents)}</span>}
                          </div>
                          <div className="sale-items">
                            {order.items.map((item) => (
                              <div className="sale-item" key={item.id}>
                                <span>{item.quantity}× {item.productName}{item.size ? ` · tam. ${item.size}` : ' · tamanho único'}{item.color ? ` · ${item.color}` : ''}</span>
                                <strong>{money(item.lineTotalCents)}</strong>
                              </div>
                            ))}
                          </div>
                          <div className="sale-totals"><span>Produtos {money(order.subtotalCents)}</span><span>Frete {money(order.shippingCents)}</span><strong>Total {money(order.totalCents)}</strong></div>
                          {order.status === 'PENDING_PAYMENT' && order.paymentStatus === 'PENDING' && (
                            <button
                              className="cancel-order-button"
                              type="button"
                              onClick={() => void cancelOrder(order)}
                              disabled={cancellationBusy}
                            >
                              <Ban size={14} /> Cancelar este pedido
                            </button>
                          )}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="analytics-empty">{loading ? 'Carregando pedidos...' : 'Nenhum pedido encontrado com esses filtros.'}</p>}
          <div className="sales-pagination">
            <span>{pages > 0 ? `Página ${page} de ${pages}` : 'Sem pedidos'}</span>
            <div><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>Anterior</button><button type="button" onClick={() => setPage((current) => Math.min(pages, current + 1))} disabled={page >= pages || loading}>Próxima</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
