import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/linkPreview';
import { loadFanWall } from '@/lib/fansServer';
import { supabaseServerCached } from '@/lib/supabaseServer';
import FansWall from '@/components/FansWall';

/**
 * Zeď fanoušků - playkine.com/fans (odkaz do reklam na Instagramu).
 * Stránka se drží v mezipaměti a obnoví se nejpozději za minutu; po přidání
 * jména v Adminu hned (app/api/admin/fans - revalidatePath).
 */
export const revalidate = 60;

const description = 'Everyone who has followed Kine from the very first days - and stays here forever.';

export const metadata: Metadata = {
  title: 'Fans',
  description,
  alternates: { canonical: `${SITE_URL}/fans` },
  openGraph: { type: 'website', title: 'Kine fans', description, url: `${SITE_URL}/fans`, siteName: 'Kine' },
  twitter: { card: 'summary_large_image', title: 'Kine fans', description },
};

export default async function FansPage() {
  const wall = await loadFanWall(supabaseServerCached(revalidate));
  return <FansWall available={wall.available} entries={wall.entries} total={wall.total} instagramUrl={wall.instagramUrl} />;
}
