import type { Metadata } from 'next';
import Script from 'next/script';
import AppShellChrome from '@/components/AppShellChrome';
import { LanguageProvider } from '@/lib/i18n';
import { MobileNavProvider } from '@/lib/mobileNavContext';
import { MusicPlayerProvider } from '@/lib/musicPlayer';
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
            {/* Hudba musí být nad kostrou appky, ne uvnitř stránky. Přehrávač
                je cizí iframe od Cloudflare a Next.js ho při každém přechodu
                na jinou stránku odpojí - odsud přechody nevidí a hraje dál. */}
            <MusicPlayerProvider>
              <AppShellChrome>{children}</AppShellChrome>
            </MusicPlayerProvider>
          </MobileNavProvider>
        </LanguageProvider>
        {/* Přehrávač Cloudflare (kvůli náhledům při najetí myší) se načte
            jednou pro celou appku. Dřív si ho o načtení říkala každá karta
            zvlášť, takže na plném feedu vzniklo pár desítek zbytečných
            komponent. */}
        <Script src="https://embed.cloudflarestream.com/embed/sdk.latest.js" strategy="lazyOnload" />
      </body>
    </html>
  );
}
