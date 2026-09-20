/** @type {import('next').NextConfig} */
const nextConfig = {
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
        // API endpointy nesmí být cachovány proxy servery
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
