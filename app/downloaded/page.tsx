'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import VideoCard from '@/components/VideoCard';
import { formatDuration } from '@/lib/homeRecommendation';
import { isMusicVideo } from '@/lib/playbackMode';
import { useMusicCommands } from '@/lib/musicPlayer';
import type { MusicTrack } from '@/lib/musicPlayer';
import { trackFromVideo } from '@/lib/musicQueue';
import { PlayIcon } from '@/components/MusicIcons';

type Filter = 'all' | 'music' | 'video';

function DownloadedPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() ?? '';
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const musicCommands = useMusicCommands();

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

    const { data: downloads } = await supabase
      .from('downloads')
      .select('video_id, downloaded_at')
      .eq('user_id', authData.user.id)
      .order('downloaded_at', { ascending: false });

    const videoIds = (downloads ?? []).map((d) => d.video_id);

    if (videoIds.length > 0) {
      // Kategorie a rozměry jsou tu kvůli tomu, aby appka poznala hudbu od
      // videa. cloudflare_video_id kvůli přehrávání a náhledu při najetí -
      // bez něj karta obojí tiše vynechá.
      const { data: videoData } = await supabase
        .from('videos')
        .select(
          'id, title, thumbnail_url, views, duration_seconds, width, height, category, cloudflare_video_id, owner_id, profiles!videos_owner_id_fkey(id, username)'
        )
        .in('id', videoIds);

      const ordered = videoIds.map((id) => videoData?.find((v) => v.id === id)).filter(Boolean);
      setVideos(ordered as any[]);
    }

    setLoading(false);
  }

  const musicVideos = useMemo(() => videos.filter(isMusicVideo), [videos]);
  const otherVideos = useMemo(() => videos.filter((v) => !isMusicVideo(v)), [videos]);

  const shown = useMemo(() => {
    const base = filter === 'music' ? musicVideos : filter === 'video' ? otherVideos : videos;
    return query ? base.filter((v) => v.title.toLowerCase().includes(query)) : base;
  }, [filter, videos, musicVideos, otherVideos, query]);

  /**
   * Pustí všechnu staženou hudbu za sebou.
   *
   * Přesně kvůli tomuhle to tu je: mezi staženými se míchá hudba s videi
   * a při poslouchání do toho videa nemají co mluvit.
   */
  function playAllMusic() {
    const tracks = musicVideos
      .map(trackFromVideo)
      .filter((track): track is MusicTrack => track !== null);

    if (tracks.length === 0) return;
    musicCommands.openTrack(tracks[0], tracks);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!userId) {
    return (
      <div className="auth-gate">
        <p>{t('loginToViewDownloadedNote')}</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="auth-gate">
        <p>{t('downloadedEmptyTitle')}</p>
        <p style={{ fontSize: 13 }}>{t('downloadedEmptyNote')}</p>
      </div>
    );
  }

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: t('downloadedFilterAll'), count: videos.length },
    { key: 'music', label: t('downloadedFilterMusic'), count: musicVideos.length },
    { key: 'video', label: t('downloadedFilterVideos'), count: otherVideos.length },
  ];

  return (
    <div>
      <p className="section-title">{t('downloadedTitle')}</p>

      <div className="downloaded-toolbar">
        <div className="downloaded-filters" role="group" aria-label={t('downloadedTitle')}>
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? 'downloaded-filter downloaded-filter-active' : 'downloaded-filter'}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {f.label}
              <span className="downloaded-filter-count">{f.count}</span>
            </button>
          ))}
        </div>

        {musicVideos.length > 0 && (
          <button type="button" className="downloaded-play-music" onClick={playAllMusic}>
            <PlayIcon size={14} />
            {t('downloadedPlayAllMusic')}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>
          {t('downloadedNothingHere')}
        </p>
      ) : (
        // Karty jsou teď stejné jako všude jinde, takže mají i nabídku pod
        // třemi tečkami - odtamtud jde stažené video přidat do playlistu
        // nebo do fronty, což tady dřív nešlo vůbec.
        <div className="video-grid">
          {shown.map((v: any) => (
            <VideoCard key={v.id} video={v} href={`/watch/${v.id}`} formatDuration={formatDuration} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DownloadedPage() {
  return (
    <Suspense fallback={null}>
      <DownloadedPageInner />
    </Suspense>
  );
}
