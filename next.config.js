// Model nsfwjs (kontrola nahoty): soubory modelu a package.json vedle nich - bez něj by
// Node načetl model jako ES modul (balíček je "type": "module") a model by byl prázdný.
const NSFW_MODEL_FILES = ['./node_modules/nsfwjs/dist/models/mobilenet_v2/**/*', './node_modules/nsfwjs/dist/models/package.json'];

/** @type {import('next').NextConfig} */
const nextConfig = {
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
        // API endpointy nesmí být cachovány proxy servery. Výjimka: /api/live/now
        // si hlavičku nastavuje sám - počet přenosů pro menu (?countOnly=1) jde
        // 30 s z mezipaměti CDN, jinak by každá otevřená stránka volala server.
        source: '/api/:path((?!live/now).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
