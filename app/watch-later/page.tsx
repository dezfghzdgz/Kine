'use client';

import { Suspense, useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { fetchAllRows, fetchByIds } from '@/lib/loadAll';

function WatchLaterPageInner() {
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

    const { data: systemPlaylist } = await supabase
      .from('playlists')
      .select('id')
      .eq('owner_id', authData.user.id)
      .eq('is_system', true)
      .maybeSingle();

    if (!systemPlaylist) {
      setLoading(false);
      return;
    }

    const { data: items } = await supabase
      .from('playlist_videos')
      .select('video_id, added_at')
      .eq('playlist_id', systemPlaylist.id)
      .order('added_at', { ascending: false });

    const videoIds = (items ?? []).map((i) => i.video_id);
    if (videoIds.length > 0) {
      const videoData = await fetchByIds<any>('videos', 'id, title, thumbnail_url, views, profiles!videos_owner_id_fkey(username)', videoIds);
      const ordered = videoIds.map((id) => videoData?.find((v) => v.id === id)).filter(Boolean);
      setVideos(ordered as any[]);
    }
    setLoading(false);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!userId) {
    return (
      <div className="auth-gate">
        <p>{t('loginToViewListNote')}</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  const filtered = query ? videos.filter((v) => v.title.toLowerCase().includes(query)) : videos;

  if (videos.length === 0) {
    return (
      <div className="auth-gate">
        <p>{t('watchLaterEmptyTitle')}</p>
        <p style={{ fontSize: 13 }}>{t('watchLaterEmptyNote')}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="section-title">{t('watchLaterTitle')}</p>
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

export default function WatchLaterPage() {
  return (
    <Suspense fallback={null}>
      <WatchLaterPageInner />
    </Suspense>
  );
}
