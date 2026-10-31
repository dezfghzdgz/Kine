import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/linkPreview';

/** Náhled odkazu na stránku her (anglicky jako zbytek náhledů). */
export const metadata: Metadata = {
  title: 'Games',
  description: 'Clips, videos and live streams on Kine by game - Counter-Strike 2, Minecraft, Fortnite, VALORANT and more. Follow your games.',
  alternates: { canonical: `${SITE_URL}/games` },
  openGraph: {
    type: 'website',
    title: 'Games on Kine',
    description: 'Clips, videos and live streams by game. Follow your games.',
    url: `${SITE_URL}/games`,
    siteName: 'Kine',
  },
  twitter: { card: 'summary_large_image', title: 'Games on Kine', description: 'Clips, videos and live streams by game.' },
};

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
