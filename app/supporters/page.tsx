import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/linkPreview';
import { loadFanWall } from '@/lib/fansServer';
import { supabaseServerCached } from '@/lib/supabaseServer';
import FansWall from '@/components/FansWall';

/**
 * Podporovatelé - playkine.com/supporters (odkaz do reklam na Instagramu;
 * stará adresa /fans sem přesměruje - app/fans/page.tsx).
 * Stránka se drží v mezipaměti a obnoví se nejpozději za minutu; po přidání
 * jména v Adminu hned (app/api/admin/fans - revalidatePath).
 */
export const revalidate = 60;

const description = 'Everyone who has supported Kine from the very first days - and stays here forever.';

export const metadata: Metadata = {
  title: 'Supporters',
  description,
  alternates: { canonical: `${SITE_URL}/supporters` },
  openGraph: { type: 'website', title: 'Kine supporters', description, url: `${SITE_URL}/supporters`, siteName: 'Kine' },
  twitter: { card: 'summary_large_image', title: 'Kine supporters', description },
};

export default async function SupportersPage() {
  const wall = await loadFanWall(supabaseServerCached(revalidate));
  return <FansWall available={wall.available} entries={wall.entries} total={wall.total} instagramUrl={wall.instagramUrl} />;
}
