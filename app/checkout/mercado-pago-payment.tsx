'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { loadMercadoPago } from '@mercadopago/sdk-js';
import './mercado-pago-payment.css';

type PaymentFormData = {
  formData: Record<string, unknown>;
};

type BrickError = {
  type?: string;
  cause?: string;
  message?: string;
};

type PaymentBrickSettings = {
  initialization: {
    amount: number;
    payer: { email: string };
  };
  customization: {
    paymentMethods: {
      creditCard: 'all';
      debitCard: 'all';
      prepaidCard: 'all';
      ticket: 'all';
      bankTransfer: 'all';
    };
  };
  callbacks: {
    onReady: () => void;
    onError: (error: BrickError) => void;
    onSubmit: (data: PaymentFormData) => Promise<unknown>;
  };
};

type PaymentBrickController = { unmount: () => void };
type PaymentInstructions = {
  id?: number | string;
  status?: string;
  statusDetail?: string;
  paymentMethodId?: string;
  qrCode?: string | null;
  qrCodeBase64?: string | null;
  paymentUrl?: string | null;
};
type MercadoPagoClient = {
  bricks: () => {
    create: (
      name: 'payment',
      containerId: string,
      settings: PaymentBrickSettings,
    ) => Promise<PaymentBrickController>;
  };
};
type MercadoPagoConstructor = new (publicKey: string, options: { locale: string }) => MercadoPagoClient;

declare global {
  interface Window {
    MercadoPago?: MercadoPagoConstructor;
  }
}

type MercadoPagoPaymentProps = {
  orderCode: string;
  amountCents: number;
  email: string;
  onPaymentResult: (status: string) => void;
};

const publicKey = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY;

export default function MercadoPagoPayment({
  orderCode,
  amountCents,
  email,
  onPaymentResult,
}: MercadoPagoPaymentProps) {
  const [brickReady, setBrickReady] = useState(false);
  const [error, setError] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState<PaymentInstructions | null>(null);
  const [copied, setCopied] = useState(false);
  const paymentResultCallback = useRef(onPaymentResult);

  useEffect(() => {
    paymentResultCallback.current = onPaymentResult;
  }, [onPaymentResult]);

  useEffect(() => {
    if (!publicKey) return;
    let active = true;
    let controller: PaymentBrickController | undefined;
    const timeout = setTimeout(() => {
      if (active) {
        setError('O formulário do Mercado Pago demorou para carregar. Verifique a Public Key e as permissões do domínio da loja.');
      }
    }, 20000);

    const renderPaymentBrick = async () => {
      try {
        await loadMercadoPago();
        if (!active) return;
        if (!window.MercadoPago) throw new Error('SDK Mercado Pago não foi carregado no navegador.');

        const mercadoPago = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
        const instance = await mercadoPago.bricks().create('payment', 'paymentBrick_container', {
          initialization: { amount: amountCents / 100, payer: { email } },
          customization: {
            paymentMethods: {
              creditCard: 'all',
              debitCard: 'all',
              prepaidCard: 'all',
              ticket: 'all',
              bankTransfer: 'all',
            },
          },
          callbacks: {
            onReady: () => {
              if (active) {
                clearTimeout(timeout);
                setError('');
                setBrickReady(true);
              }
            },
            onError: (brickError) => {
              console.error('Mercado Pago Payment Brick failed:', brickError);
              if (active) {
                clearTimeout(timeout);
                const detail = brickError.message || brickError.cause || '';
                setError([
                  'O Mercado Pago não conseguiu carregar as formas de pagamento.',
                  detail.slice(0, 180),
                ].filter(Boolean).join(' '));
              }
            },
            onSubmit: async ({ formData }) => {
              const response = await fetch(`/api/orders/${encodeURIComponent(orderCode)}/payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ formData }),
              });
              const result = await response.json();
              if (!response.ok) {
                throw new Error(result.error || 'Não foi possível processar o pagamento.');
              }
              setPaymentInstructions(result.payment as PaymentInstructions);
              paymentResultCallback.current(result.payment.status);
              return result.payment;
            },
          },
        });

        if (!active) {
          instance.unmount();
          return;
        }
        controller = instance;
      } catch (reason) {
        console.error('Could not render Mercado Pago Payment Brick:', reason);
        if (active) {
          clearTimeout(timeout);
          const detail = reason instanceof Error ? reason.message : '';
          setError([
            'Não foi possível carregar o pagamento.',
            detail.slice(0, 180),
            'Confirme se a Public Key é de teste e pertence à mesma aplicação do Access Token.',
          ].filter(Boolean).join(' '));
        }
      }
    };

    void renderPaymentBrick();

    return () => {
      active = false;
      clearTimeout(timeout);
      controller?.unmount();
    };
  }, [amountCents, email, orderCode]);

  if (!publicKey) {
    return <p className="admin-warning" role="alert">Pagamento indisponível: configure a Public Key do Mercado Pago na Vercel.</p>;
  }

  return (
    <div className="mercado-pago-brick">
      {paymentInstructions?.qrCode ? (
        <section className="checkout-success" aria-live="polite">
          <h3>Pix gerado</h3>
          <p>Escaneie o QR Code com o aplicativo do seu banco ou copie o código Pix abaixo.</p>
          {paymentInstructions.qrCodeBase64 && (
            <Image
              src={`data:image/png;base64,${paymentInstructions.qrCodeBase64}`}
              alt="QR Code Pix para pagamento do pedido"
              width={240}
              height={240}
              unoptimized
            />
          )}
          <div className="pix-copy-section">
            <p className="pix-copy-label">Pix copia e cola</p>
            <p className="pix-copy-code" tabIndex={0} aria-label="Código Pix copia e cola">
              {paymentInstructions.qrCode}
            </p>
          </div>
          <button
            className="button button-dark"
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(paymentInstructions.qrCode ?? '');
                setCopied(true);
              } catch (reason) {
                console.error('Could not copy Pix code:', reason);
                setError('Não foi possível copiar o código automaticamente. Selecione e copie o código Pix manualmente.');
              }
            }}
          >
            {copied ? 'Código Pix copiado' : 'Copiar código Pix'}
          </button>
          <p>O pedido será confirmado automaticamente após a confirmação do pagamento.</p>
        </section>
      ) : paymentInstructions?.paymentUrl ? (
        <section className="checkout-success" aria-live="polite">
          <h3>Pagamento gerado</h3>
          <p>Conclua o pagamento no link seguro abaixo. O pedido será atualizado após a confirmação.</p>
          <a className="button button-dark" href={paymentInstructions.paymentUrl} target="_blank" rel="noreferrer">
            Abrir instruções de pagamento
          </a>
        </section>
      ) : paymentInstructions ? (
        <p className="shipping-status" role="status">
          Pagamento enviado. Aguardando confirmação do Mercado Pago...
        </p>
      ) : null}
      {!brickReady && !error && <p className="shipping-status" role="status">Carregando as formas de pagamento...</p>}
      {error && <p className="admin-warning" role="alert">{error}</p>}
      {!paymentInstructions && <div id="paymentBrick_container" />}
    </div>
  );
}
