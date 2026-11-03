import type { Metadata } from 'next';
import { supabaseServerCached } from '@/lib/supabaseServer';
import { SITE_URL } from '@/lib/linkPreview';
import { GAMING_CATEGORY, gameBySlug } from '@/lib/games';

export const revalidate = 3600;

/**
 * Náhled odkazu na stránku hry (anglicky jako zbytek náhledů). Hra bez
 * jediného veřejného videa se vyhledávačům nenabízí (prázdná stránka by
 * jim vadila) - jakmile video přibude, do hodiny se to srovná.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const game = gameBySlug(slug);
  if (!game) return { title: 'Kine', robots: { index: false, follow: false } };
  let hasVideos = true;
  try {
    let query = supabaseServerCached(3600)
      .from('videos')
      .select('id')
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .overlaps('hashtags', game.strong.length > 0 ? game.strong : game.tags);
    if (game.strong.length === 0) query = query.eq('category', GAMING_CATEGORY);
    const { data, error } = await query.limit(1);
    if (!error) hasVideos = (data ?? []).length > 0;
  } catch {
    // Bez databáze radši indexovat.
  }
  const url = `${SITE_URL}/game/${game.slug}`;
  const description = `${game.name} clips, videos and live streams on Kine. Follow ${game.name} to see more of it.`;
  return {
    title: game.name,
    description,
    alternates: { canonical: url },
    robots: hasVideos ? undefined : { index: false, follow: true },
    openGraph: { type: 'website', title: `${game.name} on Kine`, description, url, siteName: 'Kine' },
    twitter: { card: 'summary', title: `${game.name} on Kine`, description },
  };
}

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return children;
}
