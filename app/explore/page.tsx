'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import VideoCard from '@/components/VideoCard';
import { buildVideoBlocks, isSpark } from '@/lib/videoBlocks';
import { computeTrustRatingClient } from '@/lib/trustRatingClient';
import { useLanguage } from '@/lib/i18n';
import { useWatchProgress } from '@/lib/useWatchProgress';

type Tab = 'popular' | 'trending' | 'newest' | 'shorts' | 'surprise';

export default function ExplorePage() {
  return (
    <Suspense fallback={null}>
      <ExploreInner />
    </Suspense>
  );
}

function ExploreInner() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const TAB_LABELS: Record<Tab, string> = {
    popular: t('popular'),
    trending: t('trending'),
    newest: t('newest'),
    shorts: 'Sparks',
    surprise: t('surprise'),
  };
  const [tab, setTab] = useState<Tab>('popular');
  const [category, setCategory] = useState<string | null>(null);
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [highCreditOnly, setHighCreditOnly] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const watchProgress = useWatchProgress(videos.map((v: any) => v.id));

  useEffect(() => {
    const tabParam = searchParams.get('tab') as Tab | null;
    const categoryParam = searchParams.get('category');

    if (categoryParam) {
      setCategory(categoryParam);
      setTab('popular');
    } else {
      setCategory(null);
      setTab(tabParam && Object.keys(TAB_LABELS).includes(tabParam) ? tabParam : 'popular');
    }
  }, [searchParams]);

  useEffect(() => {
    load();
  }, [tab, category, highCreditOnly]);

  async function load() {
    setLoading(true);
    const nowIso = new Date().toISOString();

    let query = supabase
      .from('videos')
      // cloudflare_video_id je tu kvůli náhledu při najetí myší a stahování
      // z nabídky ⋮ - bez něj by karta obojí tiše vynechala.
      .select('id, title, thumbnail_url, views, duration_seconds, width, height, created_at, category, cloudflare_video_id, profiles!videos_owner_id_fkey(id, username, created_at)')
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`);

    if (category) {
      query = query.eq('category', category);
    }

    if (tab === 'popular') {
      query = query.order('views', { ascending: false });
    }

    if (tab === 'newest') {
      query = query.order('created_at', { ascending: false });
    }

    if (tab === 'trending') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('created_at', weekAgo).order('views', { ascending: false });
    }

    const { data } = await query.limit(100);
    let results = data ?? [];

    if (tab === 'shorts') {
      // Stejné pravidlo jako všude jinde (lib/videoBlocks). Dřív se délka
      // ořezávala rovnou v dotazu přes lte(120) - jenže to zahodí i videa,
      // u kterých délka v databázi chybí, takže záložka Sparks ukazovala
      // něco jiného než hlavní stránka.
      results = results.filter(isSpark);
    }

    if (tab === 'surprise') {
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('channel_id')
          .eq('subscriber_id', authData.user.id);
        const { data: likes } = await supabase
          .from('video_reactions')
          .select('video_id')
          .eq('user_id', authData.user.id)
          .eq('reaction', 'like');

        const subscribedChannels = new Set((subs ?? []).map((s) => s.channel_id));
        const likedVideoIds = new Set((likes ?? []).map((l) => l.video_id));

        results = results.filter(
          (v: any) => !subscribedChannels.has(v.profiles?.id) && !likedVideoIds.has(v.id)
        );
      }
      // Zamíchat náhodně, ať jsou pokaždé jiná "překvapení"
      results = [...results].sort(() => Math.random() - 0.5);
    }

    if (highCreditOnly) {
      setFiltering(true);
      const uniqueOwners = new Map<string, string>();
      results.forEach((v: any) => {
        if (v.profiles?.id && v.profiles?.created_at) uniqueOwners.set(v.profiles.id, v.profiles.created_at);
      });

      const scores = await Promise.all(
        Array.from(uniqueOwners.entries()).map(async ([id, createdAt]) => [id, await computeTrustRatingClient(id, createdAt)] as const)
      );
      const highCreditIds = new Set(scores.filter(([, score]) => score >= 80).map(([id]) => id));
      results = results.filter((v: any) => highCreditIds.has(v.profiles?.id));
      setFiltering(false);
    }

    setVideos(results.slice(0, 48));
    setLoading(false);
  }

  return (
    <div>
      <p className="section-title">
        Explore {category ? `· ${t(category as any)}` : tab !== 'popular' ? `· ${TAB_LABELS[tab]}` : ''}
      </p>

      {tab === 'popular' && (
        <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: -14, marginBottom: 20 }}>
          {t('popularDesc')}
        </p>
      )}
      {tab === 'shorts' && (
        <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: -14, marginBottom: 20 }}>
          {t('shortsDesc')}
        </p>
      )}
      {tab === 'surprise' && (
        <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: -14, marginBottom: 20 }}>
          {t('surpriseDesc')}
        </p>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>
      ) : videos.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('nothingHereYet')}</p>
      ) : tab === 'shorts' ? (
        // Karty vykresluje sdílená komponenta - díky tomu má i tady každá
        // karta nabídku ⋮ (fronta, playlist, sdílet, schovat, nahlásit).
        <div className="shorts-grid">
          {videos.map((video: any) => (
            <VideoCard
              key={video.id}
              video={video}
              href={`/sparks?start=${video.id}`}
              isSparks
              progressPercent={watchProgress[video.id]}
            />
          ))}
        </div>
      ) : (
        buildVideoBlocks(videos).map((block, bi) => (
          <div key={bi} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 20 }}>
            {block.items.map((video: any) => (
              <VideoCard
                key={video.id}
                video={video}
                href={block.type === 'sparks' ? `/sparks?start=${video.id}` : `/watch/${video.id}`}
                isSparks={block.type === 'sparks'}
                progressPercent={watchProgress[video.id]}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
