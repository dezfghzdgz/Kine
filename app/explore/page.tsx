'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import VideoCard from '@/components/VideoCard';
import { buildVideoBlocks, isSpark } from '@/lib/videoBlocks';
import { computeTrustRatingClient } from '@/lib/trustRatingClient';
import { useLanguage } from '@/lib/i18n';
import { useWatchProgress } from '@/lib/useWatchProgress';
import { VideoBlockRow } from '@/components/SparksShelf';
import GamesRail from '@/components/GamesRail';
import { loadHiddenContent, NOTHING_HIDDEN, type HiddenContent } from '@/lib/hiddenContent';
import { filterFeed, sparkCandidateFilter } from '@/lib/feedFilters';
import { anonViewerKey, seededShuffle, sessionSeed } from '@/lib/seededRandom';

type Tab = 'popular' | 'trending' | 'newest' | 'shorts' | 'surprise';

const FIELDS =
  'id, title, thumbnail_url, views, duration_seconds, width, height, created_at, category, cloudflare_video_id, scheduled_at, is_premiere, owner_id, profiles!videos_owner_id_fkey(id, username, display_name, avatar_url, created_at)';
/** Kolik se ukáže. */
const SHOWN = 48;
/** Překvapení: z kolika nejnovějších se vybírá (po vyřazení odebíraných, lajkovaných a zhlédnutých). */
const SURPRISE_POOL = 200;

export default function ExplorePage() {
  return (
    <Suspense fallback={null}>
      <ExploreInner />
    </Suspense>
  );
}

/** Kdo se dívá a co si schoval (bez přihlášení nic). */
async function viewerBasics(): Promise<{ userId: string | null; hidden: HiddenContent }> {
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }) as any);
  const userId: string | null = data?.session?.user?.id ?? null;
  if (!userId) return { userId: null, hidden: NOTHING_HIDDEN };
  return { userId, hidden: await loadHiddenContent(userId).catch(() => NOTHING_HIDDEN) };
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
  // Záložka a kategorie z adresy se převezmou dřív, než se poprvé načítá (dřív šly
  // dva dotazy - výchozí "Oblíbené" a pak ten z adresy - a vyhrál ten, co doběhl později).
  const [ready, setReady] = useState(false);
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [highCreditOnly, setHighCreditOnly] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const watchProgress = useWatchProgress(videos.map((v: any) => v.id));
  /** Pořadové číslo načítání - pozdě doběhlá odpověď staršího načítání se zahodí. */
  const loadSeqRef = useRef(0);

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
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!ready) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tab, category, highCreditOnly]);

  async function load() {
    const seq = ++loadSeqRef.current;
    const stale = () => seq !== loadSeqRef.current;
    setLoading(true);
    const nowIso = new Date().toISOString();

    const base = () => {
      const q = supabase
        .from('videos')
        // cloudflare_video_id je tu kvůli náhledu při najetí myší a stahování
        // z nabídky ⋮ - bez něj by karta obojí tiše vynechala.
        .select(FIELDS)
        .eq('status', 'ready')
        .eq('visibility', 'public');
      return category ? q.eq('category', category) : q;
    };
    let query = base();

    let limit = 100;
    if (tab === 'popular') {
      query = query.or(`scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`).order('views', { ascending: false }).order('created_at', { ascending: false });
    } else if (tab === 'newest') {
      query = query.or(`scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`).order('created_at', { ascending: false });
    } else if (tab === 'trending') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query
        .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`)
        .gte('created_at', weekAgo)
        .order('views', { ascending: false })
        .order('created_at', { ascending: false });
    } else if (tab === 'shorts') {
      // Jen krátká videa na výšku, která už vyšla, nejsledovanější napřed - délku a rozměry
      // hlídá už databáze (lib/feedFilters.ts - sparkCandidateFilter). Dřív šlo 100 videí
      // bez řazení (jakýchkoli, klidně nejstarších) a Sparks z nich zbylo pár.
      query = query
        .not('width', 'is', null)
        .not('height', 'is', null)
        .or(sparkCandidateFilter(nowIso))
        .order('views', { ascending: false })
        .order('created_at', { ascending: false });
      limit = 150;
    } else {
      // Překvapení: z nejnovějších, ne z náhodné stovky bez řazení (ta byla pořád stejná).
      query = query.or(`scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`).order('created_at', { ascending: false });
      limit = SURPRISE_POOL;
    }

    const [first, viewer] = await Promise.all([query.limit(limit), viewerBasics()]);
    let data: any[] | null = first.data;
    if (first.error && tab === 'shorts') {
      // Kdyby databáze kombinovaný filtr nevzala: postaru (jen co vyšlo), krátké se vyberou níž.
      const retry = await base().or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`).order('views', { ascending: false }).limit(limit);
      data = retry.data;
    }
    if (stale()) return;
    let results: any[] = data ?? [];

    // Schované ("Nezajímá mě", "Nedoporučovat kanál") nikde; naplánované, které ještě nevyšlo, taky ne.
    // Vlastní videa pryč z doporučovacích záložek (Sparks, Překvapení) - žebříčky je nechávají.
    const ownOut = tab === 'shorts' || tab === 'surprise';
    results = filterFeed(results, { viewerId: viewer.userId, hidden: viewer.hidden, allowOwn: !ownOut, allowUpcomingPremiere: tab !== 'shorts' });

    if (tab === 'shorts') {
      // Stejné pravidlo jako všude jinde (lib/videoBlocks).
      results = results.filter(isSpark);
    }

    if (tab === 'surprise') {
      if (viewer.userId) {
        const [{ data: subs }, { data: likes }, { data: history }] = await Promise.all([
          supabase.from('subscriptions').select('channel_id').eq('subscriber_id', viewer.userId),
          supabase.from('video_reactions').select('video_id').eq('user_id', viewer.userId).eq('reaction', 'like').order('created_at', { ascending: false }).limit(500),
          // Zhlédnuté (aspoň pár vteřin) - překvapení má být něco nového.
          supabase.from('watch_history').select('video_id').eq('user_id', viewer.userId).order('watched_at', { ascending: false }).limit(500),
        ]);
        if (stale()) return;

        const subscribedChannels = new Set((subs ?? []).map((s: any) => s.channel_id));
        const likedVideoIds = new Set((likes ?? []).map((l: any) => l.video_id));
        const watchedIds = new Set((history ?? []).map((h: any) => h.video_id));

        results = results.filter(
          (v: any) => !subscribedChannels.has(v.owner_id ?? v.profiles?.id) && !likedVideoIds.has(v.id) && !watchedIds.has(v.id)
        );
      }
      // Zamíchat rovnoměrně (Fisher-Yates) se semínkem na ~30 minut: obnovení stránky
      // výběr nepřehází, další posezení přinese jiná překvapení. Dřív sort(random),
      // které některá pořadí upřednostňuje.
      results = seededShuffle(results, sessionSeed(viewer.userId ?? anonViewerKey()) ^ 0x51ab);
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
      if (stale()) return;
      const highCreditIds = new Set(scores.filter(([, score]) => score >= 80).map(([id]) => id));
      results = results.filter((v: any) => highCreditIds.has(v.profiles?.id));
      setFiltering(false);
    }

    setVideos(results.slice(0, SHOWN));
    setLoading(false);
  }

  // Schované během prohlížení (nabídka ⋮) zůstanou sbalené s tlačítkem "Zpět" (VideoCard);
  // při dalším načtení (jiná záložka) už v seznamu nejsou - seznam schovaných se hned upraví.
  const shown = videos;

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
      {/* Kategorie Hry: nahoře řada her - podle hry se hledá líp než v jedné velké hromadě. */}
      {category === 'catGaming' && <GamesRail />}
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
      ) : shown.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('nothingHereYet')}</p>
      ) : tab === 'shorts' ? (
        // Karty vykresluje sdílená komponenta - díky tomu má i tady každá
        // karta nabídku ⋮ (fronta, playlist, sdílet, schovat, nahlásit).
        <div className="shorts-grid">
          {shown.map((video: any) => (
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
        buildVideoBlocks(shown).map((block, bi) => (
          <VideoBlockRow key={bi} type={block.type} style={{ marginBottom: 20 }}>
            {block.items.map((video: any) => (
              <VideoCard
                key={video.id}
                video={video}
                href={block.type === 'sparks' ? `/sparks?start=${video.id}` : `/watch/${video.id}`}
                isSparks={block.type === 'sparks'}
                progressPercent={watchProgress[video.id]}
              />
            ))}
          </VideoBlockRow>
        ))
      )}
    </div>
  );
}
