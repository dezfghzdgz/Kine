import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter } from 'next/font/google';
import AppShellChrome from '@/components/AppShellChrome';
import ErrorReporter from '@/components/ErrorReporter';
import { LanguageProvider } from '@/lib/i18n';
import { MobileNavProvider } from '@/lib/mobileNavContext';
import { MusicPlayerProvider } from '@/lib/musicPlayer';
import { UploadProvider } from '@/lib/uploadManager';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

/**
 * Písmo appky.
 *
 * V globals.css bylo Inter napsané od začátku, ale nikde se nenačítalo -
 * appka tedy celou dobu jela systémovým písmem (Segoe UI na Windows,
 * Roboto na Androidu, San Francisco na Macu). Vypadala proto na každém
 * počítači jinak a nikde jako vlastní produkt.
 *
 * next/font si písmo stáhne při sestavení a naservíruje ho z vlastní
 * domény - prohlížeč tedy nikam nechodí, nic se nenačítá dodatečně a
 * text při načtení nepodskočí.
 *
 * latin-ext je tu kvůli češtině, slovenštině a polštině (ě, ř, ů, ł),
 * cyrillic kvůli ukrajinštině. Bez nich by se háčky a čárky braly
 * z náhradního písma a v jednom slově by se míchala dvě.
 */
const inter = Inter({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  display: 'swap',
  variable: '--font-inter',
});

/**
 * Viewport.
 *
 * viewportFit: 'cover' je ten jeden řádek, bez kterého na iPhonu s výřezem
 * nefunguje nic z env(safe-area-inset-*) v globals.css - spodní lišta,
 * Sparks, hlášky i ovládání přehrávače s ním počítají už dlouho, ale bez
 * tohohle byly ty hodnoty vždy nula. Appka pak sahala pod ukazatel domů.
 *
 * themeColor obarví lištu prohlížeče na mobilu do barvy pozadí appky,
 * aby nad Kine nesvítil bílý nebo cizí pruh.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#050506' },
  ],
};

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
    // lang="cs" je výchozí; jakmile si člověk přepne jazyk, LanguageProvider
    // atribut přepíše. Dřív tu natvrdo stálo "en", takže prohlížeč nabízel
    // překlad české stránky do češtiny a čtečky ji četly anglickou výslovností.
    <html lang="cs" className={inter.variable}>
      <body>
        <LanguageProvider>
          <MobileNavProvider>
            {/* Hudba musí být nad kostrou appky, ne uvnitř stránky. Přehrávač
                je cizí iframe od Cloudflare a Next.js ho při každém přechodu
                na jinou stránku odpojí - odsud přechody nevidí a hraje dál. */}
            <MusicPlayerProvider>
              {/* Nahrávání musí přežít odchod ze stránky /upload, tedy
                  ze stejného důvodu jako hudba: co bydlí ve stránce,
                  Next.js při přechodu jinam odpojí. */}
              <UploadProvider>
                {/* Hlášení chyb z prohlížeče na /admin/errors - viz
                    lib/errorReporter.ts. Nic nevykresluje. */}
                <ErrorReporter />
                <AppShellChrome>{children}</AppShellChrome>
              </UploadProvider>
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
