'use client';

import { useEffect, useState } from 'react';
import { initMercadoPago, Payment } from '@mercadopago/sdk-react';

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
  const [initialized, setInitialized] = useState(false);
  const [brickReady, setBrickReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!publicKey) return;
    initMercadoPago(publicKey, { locale: 'pt-BR' });
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized || brickReady || error) return;
    const timeout = setTimeout(() => {
      setError('O formulário do Mercado Pago demorou para carregar. Atualize a página e tente novamente.');
    }, 20000);
    return () => clearTimeout(timeout);
  }, [brickReady, error, initialized]);

  if (!publicKey) {
    return <p className="admin-warning" role="alert">Pagamento indisponível: configure a Public Key do Mercado Pago na Vercel.</p>;
  }
  if (!initialized) return <p className="shipping-status" role="status">Carregando pagamento seguro...</p>;

  return (
    <div className="mercado-pago-brick">
      {!brickReady && !error && <p className="shipping-status" role="status">Carregando as formas de pagamento...</p>}
      {error && <p className="admin-warning" role="alert">{error}</p>}
      <Payment
        initialization={{ amount: amountCents / 100, payer: { email } }}
        customization={{
          paymentMethods: {
            creditCard: 'all',
            debitCard: 'all',
            prepaidCard: 'all',
            ticket: 'all',
            bankTransfer: 'all',
          },
        }}
        onReady={() => setBrickReady(true)}
        onSubmit={async ({ formData }) => {
          setError('');
          const response = await fetch(`/api/orders/${encodeURIComponent(orderCode)}/payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ formData }),
          });
          const result = await response.json();
          if (!response.ok) {
            const message = result.error || 'Não foi possível processar o pagamento.';
            setError(message);
            throw new Error(message);
          }
          onPaymentResult(result.payment.status);
          return result.payment;
        }}
        onError={(brickError) => {
          console.error('Mercado Pago Payment Brick failed:', {
            type: brickError.type,
            cause: brickError.cause,
            message: brickError.message,
          });
          setError('O formulário de pagamento apresentou um erro. Confira a configuração da Public Key e tente novamente.');
        }}
      />
    </div>
  );
}
