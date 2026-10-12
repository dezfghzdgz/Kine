import type { Metadata } from 'next';
import { SITE_URL, shorten } from '@/lib/linkPreview';
import { loadLivePreview } from '@/lib/livePreview';

// Stav přenosu se mění - náhled se drží nejvýš minutu.
export const revalidate = 60;

/**
 * Náhled odkazu na přenos (Discord, X, Messenger...). Dřív měl odkaz na
 * přenos jen obecný text webu ("Video platforma postavená na svobodě
 * projevu") - teď: "🔴 <kanál> is live: <název>", popis přenosu a velký
 * obrázek se snímkem z vysílání a odznakem LIVE (opengraph-image.tsx
 * vedle). Anglicky - odkaz uvidí lidé odkudkoli.
 */
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const preview = await loadLivePreview(params.id);
  if (!preview) return { title: 'Live', robots: { index: false, follow: false } };

  const url = `${SITE_URL}/live/${params.id}`;
  const title = preview.live
    ? `🔴 ${preview.name} is live${preview.title ? `: ${preview.title}` : ''}`
    : `${preview.name} - live on Kine`;
  const description = preview.live
    ? shorten(preview.description) ?? `Watch ${preview.name} live on Kine and join the chat.`
    : `${preview.name} isn't live right now. Follow the channel on Kine to know when the next stream starts.`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', title, description, url, siteName: 'Kine' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
