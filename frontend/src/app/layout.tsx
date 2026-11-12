import type { Metadata } from 'next';
import '../index.css';

export const metadata: Metadata = {
  title: "Namma Raitha - India's #1 Platform for Farmers | DBT Subsidies & Mandi Bhav",
  description:
    'Namma Raitha (ನಮ್ಮ ರೈತ) - Guaranteed Direct Benefit Transfers (DBT), live mandi prices, 3NF normalized land registry, and real-time fraud defense.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
