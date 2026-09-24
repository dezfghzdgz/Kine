import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/linkPreview';

// Tenhle soubor appka automaticky promění na /robots.txt - říká appce
// vyhledávačů (Google atd.), že appku smí procházet a indexovat.
export default function robots(): MetadataRoute.Robots {
  const baseUrl = SITE_URL;

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // /embed se neindexuje sám (má noindex), ale procházet se smí - vede
      // z něj odkaz na stránku videa.
      disallow: ['/settings', '/admin', '/api/'],
    },
    // Druhá sitemap říká, že stránky videí jsou videa (app/video-sitemap.xml/route.ts).
    sitemap: [`${baseUrl}/sitemap.xml`, `${baseUrl}/video-sitemap.xml`],
  };
}
