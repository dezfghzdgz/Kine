import type { Metadata } from 'next';
import AppShellChrome from '@/components/AppShellChrome';
import { LanguageProvider } from '@/lib/i18n';
import { MobileNavProvider } from '@/lib/mobileNavContext';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Kine - video platforma pro tvůrce',
    template: '%s | Kine',
  },
  description: 'Kine je video platforma postavená na svobodě projevu - sleduj, tvoř a sdílej videa, Sparks i příspěvky.',
  openGraph: {
    title: 'Kine',
    description: 'Video platforma postavená na svobodě projevu.',
    url: siteUrl,
    siteName: 'Kine',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kine',
    description: 'Video platforma postavená na svobodě projevu.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <LanguageProvider>
          <MobileNavProvider>
            <AppShellChrome>{children}</AppShellChrome>
          </MobileNavProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
