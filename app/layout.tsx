import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter } from 'next/font/google';
import AppShellChrome from '@/components/AppShellChrome';
import ErrorReporter from '@/components/ErrorReporter';
import TvMode from '@/components/TvMode';
import { LanguageProvider } from '@/lib/i18n';
import { MobileNavProvider } from '@/lib/mobileNavContext';
import { MusicPlayerProvider } from '@/lib/musicPlayer';
import { UploadProvider } from '@/lib/uploadManager';
import './globals.css';
import { SITE_URL } from '@/lib/linkPreview';
import { APPEARANCE_BOOT_SCRIPT } from '@/lib/appearance';

const siteUrl = SITE_URL;

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
  // Anglicky: náhled odkazu (Discord, X, Messenger) vidí lidé z celého
  // světa a web je v základu anglicky. Obrázek náhledu je app/opengraph-image.tsx.
  title: {
    default: 'Kine - the video platform for creators',
    template: '%s | Kine',
  },
  description: 'Kine is a video platform built on free expression - watch, create and share videos, Sparks, posts and live streams.',
  openGraph: {
    title: 'Kine',
    description: 'The video platform built on free expression. Videos, Sparks, live streams and clips.',
    url: siteUrl,
    siteName: 'Kine',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kine',
    description: 'The video platform built on free expression. Videos, Sparks, live streams and clips.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Výchozí jazyk webu je angličtina (LanguageProvider začíná na "en");
    // jakmile si člověk přepne jazyk, LanguageProvider atribut přepíše.
    // suppressHydrationWarning: skript v <head> nastaví <html> (motiv, sklo) ještě před Reactem.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Uložený vzhled (motiv, sklo, světlo kolem videa) hned při načtení - bez přebliknutí. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
      </head>
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
                {/* Režim televize: zvětšení a ovládání šipkami (lib/tvMode.ts). */}
                <TvMode />
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
