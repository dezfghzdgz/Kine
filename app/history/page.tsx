'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { fetchAllRows, fetchByIds } from '@/lib/loadAll';
import { useLanguage } from '@/lib/i18n';

function HistoryPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() ?? '';
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setLoading(false);
      return;
    }
    setUserId(authData.user.id);

    // Po dávkách: bez toho vrátí databáze nejvýš tisíc řádků a zbytek
    // historie tiše zmizí. fetchByIds navíc rozdělí dotaz na videa, aby
    // adresa nepřerostla - u pár stovek položek se dotaz jinak neprovede
    // vůbec a stránka zůstane prázdná bez chybové hlášky.
    const history = await fetchAllRows((from, to) =>
      supabase
        .from('watch_history')
        .select('video_id, watched_at')
        .eq('user_id', authData.user!.id)
        .order('watched_at', { ascending: false })
        .range(from, to)
    );

    const videoIds = history.map((h: any) => h.video_id);
    if (videoIds.length > 0) {
      // Pořadí drží historie, ne databáze - proto ho fetchByIds zachovává.
      setVideos(await fetchByIds<any>('videos', 'id, title, thumbnail_url, views, profiles!videos_owner_id_fkey(username)', videoIds));
    }

    setLoading(false);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!userId) {
    return (
      <div className="auth-gate">
        <p>Pro zobrazení historie se musíš nejdřív přihlásit.</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  const filtered = query ? videos.filter((v) => v.title.toLowerCase().includes(query)) : videos;

  if (videos.length === 0) {
    return (
      <div className="auth-gate">
        <p>Historie</p>
        <p style={{ fontSize: 13 }}>Tady uvidíš videa, která jsi nedávno sledoval/a.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="section-title">Historie</p>
      <div className="video-grid">
        {filtered.map((v: any) => (
          <Link href={`/watch/${v.id}`} key={v.id} className="video-card">
            <div className="video-thumb">
              {v.thumbnail_url ? (
                <Image src={v.thumbnail_url} alt={v.title} width={320} height={180} />
              ) : null}
              <div className="play-badge">▶</div>
            </div>
            <p className="video-card-title">{v.title}</p>
            <p className="video-card-meta">
              {v.profiles?.username ?? 'neznámý tvůrce'} · {v.views} {t('views')}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <HistoryPageInner />
    </Suspense>
  );
}
