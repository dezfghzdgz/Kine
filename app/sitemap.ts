import { MetadataRoute } from 'next';
import { supabaseServer } from '@/lib/supabaseServer';

// Tenhle soubor appka automaticky promění na /sitemap.xml - je to seznam
// všech stránek appky, ať appka vyhledávačů ví, co všechno na appce
// zaindexovat (kromě toho, na co narazí sama procházením odkazů).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  const staticRoutes = ['', '/explore', '/login', '/signup', '/terms', '/privacy', '/rules'].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
  }));

  const { data: videos } = await supabaseServer
    .from('videos')
    .select('id, created_at')
    .eq('status', 'ready')
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(500);

  const videoRoutes = (videos ?? []).map((v) => ({
    url: `${baseUrl}/watch/${v.id}`,
    lastModified: new Date(v.created_at),
  }));

  const { data: channels } = await supabaseServer
    .from('profiles')
    .select('id, created_at')
    .limit(500);

  const channelRoutes = (channels ?? []).map((c) => ({
    url: `${baseUrl}/channel/${c.id}`,
    lastModified: new Date(c.created_at),
  }));

  return [...staticRoutes, ...videoRoutes, ...channelRoutes];
}
