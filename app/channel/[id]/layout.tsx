import type { Metadata } from 'next';
import { supabaseServerCached } from '@/lib/supabaseServer';
import { SITE_URL, shorten } from '@/lib/linkPreview';

export const revalidate = 300;

type ProfileRow = {
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  bio: string | null;
};

async function loadProfile(id: string): Promise<ProfileRow | null> {
  try {
    // Metadata kanálu smí být až 5 minut stará (revalidate výše) - API cesty čtou vždy čerstvě.
    const { data } = await supabaseServerCached(300)
      .from('profiles')
      .select('username, display_name, avatar_url, banner_url, bio')
      .eq('id', id)
      .maybeSingle();

    return (data as ProfileRow | null) ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const profile = await loadProfile(params.id);

  if (!profile) {
    return { title: 'Channel', robots: { index: false, follow: false } };
  }

  const name = profile.display_name || profile.username || 'Channel';
  const description = shorten(profile.bio) ?? `${name} on Kine - videos, Sparks and live streams.`;
  // Banner je na náhled lepší než avatar - je široký, takže ho sítě
  // ukážou celý místo aby ho ořízly.
  const image = profile.banner_url || profile.avatar_url || undefined;
  const url = `${SITE_URL}/channel/${params.id}`;

  // Karta pro Twitter/X se schválně skládá ve dvou celých variantách.
  // Kdyby se přepínal jen druh karty (card: image ? 'a' : 'b'), TypeScript
  // by výsledek nepřiřadil k žádné z povolených podob a build by spadl -
  // přesně na tomhle už jednou stálo nasazení.
  const twitter: Metadata['twitter'] = image
    ? { card: 'summary_large_image', title: name, description, images: [image] }
    : { card: 'summary', title: name, description };

  return {
    title: name,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      title: name,
      description,
      url,
      siteName: 'Kine',
      images: image ? [{ url: image, alt: name }] : undefined,
    },
    twitter,
  };
}

export default function ChannelLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
