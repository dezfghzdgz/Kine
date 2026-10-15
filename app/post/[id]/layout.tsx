import type { Metadata } from 'next';
import { supabaseServerCached } from '@/lib/supabaseServer';
import { SITE_URL, shorten } from '@/lib/linkPreview';
import { postImages } from '@/lib/posts';

export const revalidate = 300;

/**
 * Náhled odkazu na příspěvek (Discord, X...): kdo, text a první fotka.
 * Příspěvky jsou veřejné (stejně jako na kanálu); zablokovaný kanál nic neukáže.
 */
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return { title: 'Kine' };
  // Metadata postu smí být až 5 minut stará (revalidate výše) - API cesty čtou vždy čerstvě.
  const { data: post } = await supabaseServerCached(300)
    .from('posts')
    .select('*, profiles!posts_owner_id_fkey(username, display_name, is_banned)')
    .eq('id', params.id)
    .maybeSingle();
  const author = (post as any)?.profiles;
  if (!post || author?.is_banned) return { title: 'Kine', robots: { index: false, follow: false } };
  const name = author?.display_name || author?.username || 'Kine';
  const text = shorten(post.content) ?? (post.type === 'poll' ? (post.poll_options ?? []).map((o: any) => o?.text).filter(Boolean).join(' · ') : null);
  const image = postImages(post)[0];
  const url = `${SITE_URL}/post/${post.id}`;
  return {
    title: `${name} · Kine`,
    description: text ?? undefined,
    alternates: { canonical: url },
    openGraph: { type: 'article', title: `${name} · Kine`, description: text ?? undefined, url, siteName: 'Kine', images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: `${name} · Kine`, description: text ?? undefined, images: image ? [image] : undefined },
  };
}

export default function PostLayout({ children }: { children: React.ReactNode }) {
  return children;
}
