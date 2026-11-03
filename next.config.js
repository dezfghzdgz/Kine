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
/** Host vlastního projektu Supabase (z NEXT_PUBLIC_SUPABASE_URL); bez nastavení jakýkoli *.supabase.co. */
function supabaseImageHost() {
  try {
    return new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL || '')).hostname || '*.supabase.co';
  } catch {
    return '*.supabase.co';
  }
}

/** Náhledy Cloudflare Stream: jen vlastní účet, když je kód zákazníka v nastavení. */
function streamImageHost() {
  const code = String(process.env.NEXT_PUBLIC_STREAM_CUSTOMER_CODE || '').trim().toLowerCase();
  return /^[a-z0-9]+$/.test(code) ? `customer-${code}.cloudflarestream.com` : 'customer-*.cloudflarestream.com';
}

const nextConfig = {
  // Do prohlížeče jde jen zmenšený kód bez zdrojových map (výchozí Next, tady napsáno
  // schválně, ať to nikdo omylem nezapne) a bez hlavičky "X-Powered-By".
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  // Titulek a značky náhledu odkazu (og:..., twitter:...) jdou do <head> všem, jako v Next 14.
  // Next 15.2+ je u stránek s generateMetadata (video, kanál, příspěvek, přenos, hra) jinak
  // posílá až na konec stránky a do <head> je dává jen robotům ze svého seznamu (Discord, X,
  // WhatsApp, Facebook...) - náhledy ale dělají i další (Mastodon, Viber, Pinterest...).
  htmlLimitedBots: /.*/,
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
  // Kontrola nahoty (lib/nudityScan.ts): TensorFlow.js a model se na serveru
  // načtou z node_modules tak, jak jsou - nebalí se do kódu stránek.
  // (Do Next 14 se to jmenovalo experimental.serverComponentsExternalPackages.)
  serverExternalPackages: ['@tensorflow/tfjs', 'nsfwjs', 'jpeg-js'],
  // Soubory modelu nsfwjs se načítají až za běhu (require s vypočtenou cestou) -
  // sledování závislostí je samo nenajde, tak se k funkcím, které kontrolují, přidají ručně.
  // (Do Next 14 bylo pod experimental, od Next 15 je to hlavní volba.)
  outputFileTracingIncludes: {
    '/api/videos/**': NSFW_MODEL_FILES,
    '/api/live/**': NSFW_MODEL_FILES,
    '/api/desktop/**': NSFW_MODEL_FILES,
    '/api/moderation/**': NSFW_MODEL_FILES,
    // Písmo obrázku náhledu odkazu a ikon (app/opengraph-image.tsx, app/apple-icon.tsx).
    '/opengraph-image': ['./lib/og-fonts/**'],
    '/apple-icon': ['./lib/og-fonts/**'],
  },
  images: {
    // Jen naše zdroje: vlastní projekt Supabase (veřejné úložiště), vlastní účet Cloudflare
    // Stream (když je kód zákazníka v nastavení) a Giphy. Dřív šel přes optimalizaci obrázků
    // Vercelu (placená kvóta) obrázek z jakéhokoli projektu Supabase / účtu Cloudflare.
    remotePatterns: [
      { protocol: 'https', hostname: streamImageHost() },
      { protocol: 'https', hostname: supabaseImageHost(), pathname: '/storage/v1/object/public/**' },
      { protocol: 'https', hostname: 'media*.giphy.com' },
    ],
    // Výchozí hodnoty Next 16 stačí: kvalita jen 75 (žádný <Image> nemá vlastní quality) a
    // zmenšený obrázek se drží 4 hodiny (Next 14: minuta, u Supabase hodina podle hlavičky).
    // Přes <Image> jdou jen náhledy videí a obaly playlistů a nový obrázek má vždycky novou
    // adresu (soubor s časem v názvu nebo ?t=<čas>) - pod starou adresou se nic nezmění.
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
          // Prohlížeč chodí na Kine jen přes HTTPS (i když někdo napíše http://) - rok.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
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
