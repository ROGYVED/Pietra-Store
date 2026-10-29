import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pietra | Calçados e bolsas femininas',
  description: 'Calçados e bolsas femininas que acompanham o seu estilo em todos os momentos.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
