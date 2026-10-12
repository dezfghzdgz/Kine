import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/linkPreview';

/** Náhled odkazu na stránku Živě (anglicky jako zbytek náhledů). */
export const metadata: Metadata = {
  title: 'Live now',
  description: 'Live streams on Kine right now - games, music, talk and more. Small channels get a fair spot too.',
  alternates: { canonical: `${SITE_URL}/streams` },
  openGraph: {
    type: 'website',
    title: 'Live now on Kine',
    description: 'Live streams on Kine right now - games, music, talk and more.',
    url: `${SITE_URL}/streams`,
    siteName: 'Kine',
  },
  twitter: { card: 'summary_large_image', title: 'Live now on Kine', description: 'Live streams on Kine right now.' },
};

export default function StreamsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
