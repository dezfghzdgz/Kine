import { MetadataRoute } from 'next';

// Tenhle soubor appka automaticky promění na /robots.txt - říká appce
// vyhledávačů (Google atd.), že appku smí procházet a indexovat.
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/settings', '/admin', '/api/'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
