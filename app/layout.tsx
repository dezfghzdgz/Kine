import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import AppShellChrome from '@/components/AppShellChrome';
import ErrorReporter from '@/components/ErrorReporter';
import TvMode from '@/components/TvMode';
import BadgeWatcher from '@/components/BadgeWatcher';
import { LanguageProvider } from '@/lib/i18n';
import { MobileNavProvider } from '@/lib/mobileNavContext';
import { MusicPlayerProvider } from '@/lib/musicPlayer';
import { UploadProvider } from '@/lib/uploadManager';
import './globals.css';
import { SITE_URL } from '@/lib/linkPreview';
import { APPEARANCE_BOOT_SCRIPT } from '@/lib/appearance';
import { BRAND_BOOT_SCRIPT } from '@/lib/brandColor';
import { NETWORK_HINTS_BOOT_SCRIPT } from '@/lib/networkHints';

const siteUrl = SITE_URL;

/** Adresa databáze (Supabase) - spojení se naváže hned v hlavičce stránky. */
const SUPABASE_ORIGIN = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
})();

/** Server videí Cloudflare (customer-<kód>.cloudflarestream.com), když je kód v nastavení serveru. */
const STREAM_CODE = (process.env.NEXT_PUBLIC_STREAM_CUSTOMER_CODE ?? '').trim();
const STREAM_ORIGIN = /^[a-z0-9]{6,40}$/i.test(STREAM_CODE) ? `https://customer-${STREAM_CODE}.cloudflarestream.com` : null;

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
    // Věta z obrázku náhledu se tu neopakuje - popis říká, co se na Kine dá dělat.
    description: 'Watch and create videos and Sparks, go live, and clip your games with Kine Clipper.',
    url: siteUrl,
    siteName: 'Kine',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kine',
    description: 'Watch and create videos and Sparks, go live, and clip your games with Kine Clipper.',
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
        <script dangerouslySetInnerHTML={{ __html: BRAND_BOOT_SCRIPT }} />
        {/* Spojení se servery se naváže hned (lib/networkHints.ts): databáze (každá stránka
            si o data říká hned po načtení) a Cloudflare (náhledy, video). Na mobilních
            datech to je klidně půl vteřiny na každý server. */}
        {SUPABASE_ORIGIN && <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" />}
        {STREAM_ORIGIN && <link rel="preconnect" href={STREAM_ORIGIN} crossOrigin="anonymous" />}
        {STREAM_ORIGIN && <link rel="preconnect" href={STREAM_ORIGIN} />}
        <link rel="preconnect" href="https://videodelivery.net" />
        {/* Kód Cloudflare z minula (když není v nastavení serveru) - spojení hned, ne až s prvním náhledem. */}
        {!STREAM_ORIGIN && <script dangerouslySetInnerHTML={{ __html: NETWORK_HINTS_BOOT_SCRIPT }} />}
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
                {/* Nový odznak = oslavné okénko a oznámení (components/BadgeWatcher.tsx). */}
                <BadgeWatcher />
                <AppShellChrome>{children}</AppShellChrome>
              </UploadProvider>
            </MusicPlayerProvider>
          </MobileNavProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
