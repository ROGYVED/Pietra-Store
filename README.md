# PIETRA — loja virtual

Loja Next.js com catálogo e estoque em PostgreSQL/Prisma, painel administrativo, cotação de frete via Melhor Envio e checkout via Mercado Pago. O catálogo de demonstração foi substituído por produtos cadastrados no banco; nenhuma credencial real foi fornecida, portanto as integrações ainda precisam de configuração e homologação antes de receber pedidos.

## Requisitos

- Node.js 20 ou superior
- npm
- PostgreSQL 14 ou superior

## Preparação local

```bash
npm install
Copy-Item .env.example .env.local
```

Edite `.env.local` com `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `ADMIN_SESSION_SECRET`. Gere segredos fortes; não use os valores de exemplo e não envie nem versione `.env.local`.

Gere o cliente Prisma, aplique as migrações e importe o catálogo:

```bash
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Abra http://localhost:3000. O primeiro acesso administrativo fica em `/admin`. `GET /api/health` informa se o banco está acessível. Para criar uma nova migração de desenvolvimento, use `npm run db:migrate`.

## Catálogo do fornecedor

`prisma/supplier-catalog.json` contém 64 anúncios capturados do catálogo público informado pela Pietra, com nome, imagem, categoria, preço “a partir de” e link de origem. O seed importa calçados e bolsas como rascunhos, com estoque zero. O preço sugerido é duas vezes o valor de origem (acréscimo de 100%); como o fornecedor confirma preços, tamanhos e disponibilidade pelo atendimento, confirme custo e condições antes de publicar.

No painel, use **Adicionar produto** para cadastrar mercadorias com SKU, preço, tamanho, estoque inicial e até cinco fotos PNG, JPEG ou WebP (5 MB por foto). Tamanho `0` representa produto de tamanho único. As fotos podem ser ampliadas e removidas na edição do produto; imagens do fornecedor também podem ser copiadas para o Supabase Storage. Produtos novos começam como rascunho. Antes de publicar, revise o estoque e informe o peso e as dimensões do pacote. A exclusão de um produto preserva pedidos e movimentos de estoque anteriores. O seed pode ser executado novamente: preserva estoque/status já administrados, mas atualiza o custo e o preço derivados do snapshot do fornecedor.

## Configuração das integrações

Preencha no ambiente do servidor, nunca no frontend:

- `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET`: token privado e segredo de webhook da aplicação Mercado Pago. Configure `/api/payments/mercadopago/webhook` como notificação de pagamentos.
- `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY`: Public Key da mesma aplicação e do mesmo ambiente do Access Token. É usada pelo Payment Brick no navegador; não é segredo.
- `MELHORENVIO_TOKEN`, `MELHORENVIO_ENV`, `MELHORENVIO_ORIGIN_POSTAL_CODE`, `MELHORENVIO_SERVICE_IDS` e `MELHORENVIO_SUPPORT_EMAIL`: token OAuth da conta Pietra, ambiente (`sandbox` para testes ou `production`), CEP de origem cadastrado, IDs de serviços autorizados (opcional; vazio usa os serviços liberados na conta) e e-mail de suporte informado no User-Agent exigido pela API. O token deve ser emitido/autorizado na conta do Melhor Envio e renovado conforme as regras do provedor; rotação automática não está implementada.
- `SHIPPING_QUOTE_SECRET`: segredo aleatório de 32 caracteres ou mais usado para assinar cotações temporárias.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_STORAGE_BUCKET`: armazenamento de imagens. O bucket deve estar configurado conforme o modo de acesso às imagens públicas da loja.
- `NEXT_PUBLIC_STORE_URL`: URL pública usada nos retornos e notificações do Mercado Pago.
- `CRON_SECRET`: segredo para proteger a rotina de expiração de checkout.
- `NEXT_PUBLIC_WHATSAPP_NUMBER`: contato comercial público da Pietra.

Configure variáveis equivalentes na hospedagem. A chave `SUPABASE_SERVICE_ROLE_KEY`, o Access Token do Mercado Pago e as credenciais de entrega são privadas e jamais devem usar prefixo `NEXT_PUBLIC_`. Apenas a Public Key do Mercado Pago pode ter esse prefixo.

### Ativação do Payment Brick

O Payment Brick mantém os campos de pagamento dentro do checkout da Pietra. O Brick coleta os dados de pagamento, e o servidor cria a cobrança diretamente na API do Mercado Pago; o Access Token nunca vai ao navegador. A confirmação definitiva continua sendo feita pelo webhook assinado.

1. No painel de desenvolvedores do Mercado Pago, obtenha a Public Key e o Access Token de teste da mesma aplicação. Não compartilhe o Access Token.
2. Na Vercel, configure `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` com a Public Key de teste e `MERCADOPAGO_ACCESS_TOKEN` com o Access Token de teste. Configure-os no mesmo ambiente Vercel usado para o teste e mantenha `NEXT_PUBLIC_STORE_URL` apontando para a URL pública da loja.
3. Configure a notificação de pagamentos para `https://SEU_DOMINIO/api/payments/mercadopago/webhook` e copie o segredo de assinatura dessa aplicação para `MERCADOPAGO_WEBHOOK_SECRET`. O endpoint deve estar acessível por HTTPS.
4. Faça um novo deploy para que a Public Key `NEXT_PUBLIC_` seja incluída no frontend.
5. Teste com as contas de teste do Mercado Pago: cartão, Pix, pagamentos pendentes/recusados, confirmação do webhook, reenvio de notificações e liberação de estoque após expiração.
6. Após homologar, substitua no ambiente de produção a Public Key, o Access Token e o segredo do webhook pelos valores de produção correspondentes da mesma aplicação. Faça novo deploy e valide antes de divulgar a loja.

Não habilite pagamentos reais até confirmar que o webhook atualiza o pedido e o estoque corretamente no ambiente publicado. A criação da aplicação e a emissão das credenciais acontecem na conta do Mercado Pago; não podem ser feitas apenas a partir deste repositório.

## Fluxos implementados

- `/` e `/produto/:id`: produtos ativos e disponíveis no banco.
- `/sacola` e `/checkout`: sacola e início de checkout; ao informar um CEP válido, o endereço é preenchido pela consulta pública ViaCEP e o frete é cotado automaticamente. Entregas para CEPs que a ViaCEP identifica como Aracaju/SE recebem uma única opção grátis; o servidor confirma o CEP novamente ao criar o pedido, mesmo se `SHIPPING_QUOTE_SECRET` não estiver configurado. Nos demais destinos, o cliente pode revisar as opções do Melhor Envio, com cotação protegida pelo segredo; o servidor recalcula preços/estoque antes de iniciar o pagamento.
- `POST /api/shipping/quote`: cotações do Melhor Envio assinadas e vinculadas ao CEP, variantes, quantidades e preços; expiram em 15 minutos. A cotação requer token OAuth válido, CEP de origem, e-mail de suporte e `SHIPPING_QUOTE_SECRET`.
- `POST /api/orders`: valida pedido e frete, reserva estoque em transação e prepara o Payment Brick.
- `POST /api/orders/:code/payment`: cria a cobrança do Payment Brick no servidor com o valor calculado pelo banco.
- `POST /api/payments/mercadopago/webhook`: valida assinatura, consulta o pagamento ao provedor e atualiza pedido/estoque.
- `/pedido/:code` e `GET /api/orders/:code`: consulta limitada do estado do pedido.
- `POST /api/cron/expire-orders`: cancela checkouts vencidos e libera reservas. Agende a chamada com `Authorization: Bearer <CRON_SECRET>`.
- `/admin`: painel com faturamento pago, pedidos pendentes, ticket médio, custos registrados, taxas do Mercado Pago recebidas no webhook, resultado estimado, evolução diária, mais vendidos, estoque baixo, consulta paginada de cada venda, pesquisa e exportação CSV da página; também inclui gestão de estoque, publicação individual ou em lote (somente produtos com estoque disponível), retirada individual ou em lote, medidas, retirada na loja e imagens.
- `GET /api/admin/analytics?period=7d|30d|90d|all` e `GET /api/admin/orders?page=1&pageSize=25`: relatórios autenticados do painel.
- `PATCH /api/admin/orders/:id`: atualização operacional e cancelamento autenticado de pedidos pendentes; cancelar libera estoque e preserva o histórico.
- `POST /api/admin/orders/cancel-pending`: cancela em lotes todos os pedidos que aguardam pagamento, mesmo fora do período/página atual, com autenticação administrativa.

Entrega local está bloqueada até que taxa e área atendida sejam definidas. Retirada fica disponível quando o endereço for cadastrado no painel.
O status `REFUND_PENDING` serve apenas para acompanhamento: inicie o reembolso no Mercado Pago e confirme-o pelo webhook; a loja não dispara reembolsos automaticamente. O resultado do painel usa o custo gravado em cada novo item vendido e as taxas comunicadas pelo Mercado Pago no webhook; não inclui impostos, custo efetivo do frete, taxas não informadas pelo provedor nem despesas operacionais. Pedidos antigos sem custo/taxa registrados não podem compor resultado histórico confiável. O login administrativo ainda precisa de limitação de tentativas e de política de acesso adequada ao ambiente do cliente.

## Antes de entregar/operar

1. Provisionar banco e configurar segredos de administração; executar migração e seed.
2. Conferir com o fornecedor o custo real e o direito de reutilizar as imagens; cadastrar estoque e medidas físicas corretas de cada produto.
3. Configurar bucket Supabase e migrar as imagens para ele.
4. Configurar credenciais e URL de webhook do Mercado Pago; homologar Pix, cartão, pagamentos pendentes/recusados, reembolsos, cancelamentos e reenvio de webhook em sandbox.
5. Configurar conta/serviços do Melhor Envio e validar cotações para CEPs reais; definir rotina de renovação do token.
6. Agendar a expiração de pedidos e definir área/taxa de entrega local, se aplicável.
7. Confirmar endereço de retirada, WhatsApp, domínio, hospedagem, textos de privacidade, termos, trocas e devoluções.
8. Testar o fluxo completo no ambiente de homologação e revisar os dados da loja com o cliente antes de habilitar pagamentos reais.

## Verificação

```bash
npm run db:generate
npm run typecheck
npm run lint
npm run build
```

Não foi possível testar serviços externos ou conexão real ao banco sem as credenciais do cliente. O código de integração não deve ser considerado homologado até executar os testes de ponta a ponta acima.
