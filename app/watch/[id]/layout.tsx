import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabaseServer';
import { SITE_URL, shorten, firstRelation, videoThumbnail } from '@/lib/linkPreview';

// Náhled se smí chvíli držet v paměti - název ani obrázek videa se běžně
// nemění každou minutu a nemá smysl kvůli každému robotovi sahat do databáze.
export const revalidate = 300;

type VideoRow = {
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  cloudflare_video_id: string | null;
  width: number | null;
  height: number | null;
  visibility: string;
  status: string;
  profiles: { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null;
};

async function loadVideo(id: string): Promise<VideoRow | null> {
  try {
    const { data } = await supabaseServer
      .from('videos')
      .select(
        'title, description, thumbnail_url, cloudflare_video_id, width, height, visibility, status, profiles!videos_owner_id_fkey(username, display_name)'
      )
      .eq('id', id)
      .maybeSingle();

    return (data as VideoRow | null) ?? null;
  } catch {
    // Nesmyslné ID v adrese (nebo výpadek databáze) nesmí shodit celou
    // stránku - přehrávač si s chybějícím videem poradí sám.
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const video = await loadVideo(params.id);

  // Soukromá videa a videa jen pro odběratele nesmí přes náhled odkazu
  // prozradit ani název - kdo na ně má právo, uvidí je až v přehrávači.
  if (!video || video.status !== 'ready' || video.visibility !== 'public') {
    return { title: 'Video', robots: { index: false, follow: false } };
  }

  const owner = firstRelation(video.profiles);
  const creator = owner?.display_name || owner?.username || 'Kine';
  const description = shorten(video.description) ?? `${creator} · Kine`;
  const image = videoThumbnail(video.thumbnail_url, video.cloudflare_video_id);
  const url = `${SITE_URL}/watch/${params.id}`;

  return {
    title: video.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'video.other',
      title: video.title,
      description,
      url,
      siteName: 'Kine',
      images: image ? [{ url: image, width: 1280, height: 720, alt: video.title }] : undefined,
      // Díky tomuhle umí Discord i Facebook video přehrát rovnou v příspěvku,
      // místo aby ukázaly jen obrázek.
      videos: video.cloudflare_video_id
        ? [
            {
              url: `https://iframe.videodelivery.net/${video.cloudflare_video_id}`,
              type: 'text/html',
              width: video.width ?? 1280,
              height: video.height ?? 720,
            },
          ]
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: video.title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
