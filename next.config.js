// Model nsfwjs (kontrola nahoty): soubory modelu a package.json vedle nich - bez něj by
// Node načetl model jako ES modul (balíček je "type": "module") a model by byl prázdný.
const NSFW_MODEL_FILES = ['./node_modules/nsfwjs/dist/models/mobilenet_v2/**/*', './node_modules/nsfwjs/dist/models/package.json'];

/**
 * Hlavní adresa webu: NEXT_PUBLIC_SITE_URL, jinak produkční adresa, kterou hlásí
 * Vercel (VERCEL_PROJECT_PRODUCTION_URL - vlastní doména, když je nastavená).
 * Stejné pravidlo jako lib/linkPreview.ts (SITE_URL).
 */
function canonicalSite() {
  const env = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return vercel ? `https://${vercel}` : '';
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    const site = canonicalSite();
    let host = '';
    try {
      host = new URL(site).host;
    } catch {
      host = '';
    }
    // Jen produkce s vlastní doménou - náhledová nasazení (preview) zůstávají na své adrese.
    if (process.env.VERCEL_ENV !== 'production' || !host || /\.vercel\.app$/i.test(host)) return [];
    return [
      {
        // Stránky otevřené na *.vercel.app (kine-lac.vercel.app...) -> vlastní doména, ať
        // sdílené odkazy nenesou "vercel". API ne: appka do PC na staré adrese posílá
        // přihlášení v hlavičce a přesměrování na jinou doménu by ho zahodilo - appka si
        // novou adresu vezme sama (/api/desktop/config).
        source: '/:path((?!api/|_next/).*)',
        has: [{ type: 'host', value: '.+\\.vercel\\.app' }],
        destination: `${site}/:path`,
        permanent: false,
      },
    ];
  },
  experimental: {
    // Kontrola nahoty (lib/nudityScan.ts): TensorFlow.js a model se na serveru
    // načtou z node_modules tak, jak jsou - nebalí se do kódu stránek.
    serverComponentsExternalPackages: ['@tensorflow/tfjs', 'nsfwjs', 'jpeg-js'],
    // Soubory modelu nsfwjs se načítají až za běhu (require s vypočtenou cestou) -
    // sledování závislostí je samo nenajde, tak se k funkcím, které kontrolují, přidají ručně.
    outputFileTracingIncludes: {
      '/api/videos/**': NSFW_MODEL_FILES,
      '/api/live/**': NSFW_MODEL_FILES,
      '/api/desktop/**': NSFW_MODEL_FILES,
      '/api/moderation/**': NSFW_MODEL_FILES,
      // Písmo obrázku náhledu odkazu a ikon (app/opengraph-image.tsx, app/apple-icon.tsx).
      '/opengraph-image': ['./lib/og-fonts/**'],
      '/apple-icon': ['./lib/og-fonts/**'],
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'customer-*.cloudflarestream.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'media*.giphy.com' },
    ],
  },
  async headers() {
    return [
      {
        // Všechno kromě vložitelného přehrávače (/embed/...), který cizí
        // stránky do rámu načíst smí - viz pravidlo pod tímhle.
        source: '/:path((?!embed/).*)',
        headers: [
          // Brání načítání appky jako iframe v cizích stránkách (clickjacking)
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Zabraňuje prohlížeči hádat MIME typ souborů (bezpečnostní riziko)
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Odstraní referrer z adresního řádku při opuštění appky
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Povolí jen potřebné webové funkce (zakáže zbytečné API jako kamera bez přihlášení)
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // Vložitelný přehrávač: smí ho zarámovat kdokoliv (Discord, X,
        // cizí web s kódem "Vložit na web"). Ostatní hlavičky zůstávají.
        source: '/embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // API endpointy nesmí být cachovány proxy servery. Výjimky si hlavičku
        // nastavují samy: /api/live/now (počet přenosů pro menu a seznam Živě
        // bez přihlášení jdou chvíli z mezipaměti CDN, jinak by každá otevřená
        // stránka volala server), /api/live/status (stav přenosu pro diváky bez
        // přihlášení, pár vteřin), /api/badges/stats (součty pro odznaky kanálu,
        // 5 minut) a /api/live/chat/emotes (emoty kanálu, půl minuty). Next
        // hlavičku odsud k té z odpovědi přidává (ne nahrazuje) - "no-store" by
        // tak cache vypnulo i tam, kde ji odpověď povoluje.
        source: '/api/:path((?!live/now|live/status|live/chat/emotes|badges/stats).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
