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
        source: '/(.*)',
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
