import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/linkPreview';

/** Náhled odkazu na stránku O Kine (anglicky jako zbytek náhledů). */
const description =
  'Kine is a video platform for viewers and creators: videos, Sparks, live streams with chat and tips, and two Windows apps - Kine for PC and Kine Clipper.';

export const metadata: Metadata = {
  title: 'About Kine',
  description,
  alternates: { canonical: `${SITE_URL}/about` },
  openGraph: { type: 'website', title: 'About Kine', description, url: `${SITE_URL}/about`, siteName: 'Kine' },
  twitter: { card: 'summary_large_image', title: 'About Kine', description },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
