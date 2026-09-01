'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import OnboardingChecklist from '@/components/OnboardingChecklist';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import VideoCard from '@/components/VideoCard';
import { scoreVideo, buildBlocks, formatDuration, FEED_BATCH, WATCHED_HISTORY_LIMIT } from '@/lib/homeRecommendation';
import type { Block } from '@/lib/homeRecommendation';
import { loadHiddenContent, filterHidden, clearHiddenContent, NOTHING_HIDDEN } from '@/lib/hiddenContent';
import type { HiddenContent } from '@/lib/hiddenContent';
import { isSpark, nearMissSparks } from '@/lib/videoBlocks';

const VIDEO_COLUMNS =
  'id, title, thumbnail_url, views, duration_seconds, width, height, created_at, category, hashtags, owner_id, cloudflare_video_id, profiles!videos_owner_id_fkey(username)';

// Kolik dávek za sebou smí vyjít naprázdno, než to appka vzdá. Když má divák
// schovaný celý kanál, může se stát, že se z jedné dávky nedostane do feedu
// nic - v tom případě sáhne rovnou pro další, ale ne donekonečna.
const MAX_EMPTY_BATCHES = 4;

/** Co appka potřebuje vědět, aby videím spočítala skóre. Platí pro celé sezení. */
type FeedContext = {
  userId: string | null;
  preference: 'short' | 'long';
  disableShorts: boolean;
  hidden: HiddenContent;
  subscribedIds: Set<string>;
  watchedIds: Set<string>;
  topCategories: Set<string>;
  topHashtags: Set<string>;
  /**
   * Čas načtení stránky. Drží okno videí na místě: bez něj by video nahrané
   * mezitím posunulo všechna ostatní o jedno dolů a při donačítání by se
   * některé ve feedu objevilo dvakrát.
   */
  cutoff: string;
};

/**
 * Proč ve feedu nejsou Sparks.
 *
 * Vrací jen důvody, se kterými divák může něco udělat:
 *  - 'off'  = v Nastavení je zapnuté "Vypnout Sparks a krátký obsah",
 *             ale Sparks by tu jinak byly
 *  - 'rule' = žádné video pravidlu neodpovídá, i když na výšku nějaká jsou
 *             (jsou delší než dvě minuty, nebo u nich chybí rozměry)
 * Když je všechno v pořádku, nebo tu prostě žádná Sparks videa nejsou,
 * vrátí null a hlavní stránka nic nepíše.
 */
function explainMissingSparks(pool: any[], rawSparkCount: number, disableShorts: boolean): 'off' | 'rule' | null {
  if (pool.some(isSpark)) return null;
  if (disableShorts) return rawSparkCount > 0 ? 'off' : null;

  const { portraitTooLong, missingDimensions } = nearMissSparks(pool);
  return portraitTooLong > 0 || missingDimensions > 0 ? 'rule' : null;
}

export default function HomePage() {
  const { t } = useLanguage();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [empty, setEmpty] = useState(false);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Proč na stránce nejsou Sparks. Feed je do teď zahazoval potichu, takže
  // se nedalo poznat, jestli je chyba v appce, v nastavení nebo v datech.
  const [sparkNotice, setSparkNotice] = useState<'off' | 'rule' | null>(null);
  const [hiddenCount, setHiddenCount] = useState(0);

  // Tyhle věci se mezi dávkami nemění a nesmí spustit překreslení stránky,
  // proto sedí v ref a ne ve state.
  const ctxRef = useRef<FeedContext | null>(null);
  const offsetRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadInitial();
  }, []);

  // Automatické donačítání - jakmile je "cílová značka" dole vidět na
  // obrazovce, appka si řekne databázi o další dávku.
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: '600px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, blocks]);

  async function loadInitial() {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user ?? null;

    const subscribedIds = new Set<string>();
    const watchedIds = new Set<string>();
    const topCategories = new Set<string>();
    const topHashtags = new Set<string>();
    let preference: 'short' | 'long' = 'long';
    let disableShorts = false;
    let hidden: HiddenContent = NOTHING_HIDDEN;

    if (user) {
      const [{ data: profile }, { data: subs }, { data: watched }, { data: recentHistory }, loadedHidden] =
        await Promise.all([
          supabase.from('profiles').select('content_preference, disable_shorts').eq('id', user.id).single(),
          supabase.from('subscriptions').select('channel_id').eq('subscriber_id', user.id),
          // Jen posledních pár set zhlédnutí. Bez omezení a bez určeného
          // pořadí vrátí databáze náhodných tisíc řádků a "tohle už jsi
          // viděl" se u starších videí tiše rozbije.
          supabase
            .from('watch_history')
            .select('video_id')
            .eq('user_id', user.id)
            .order('watched_at', { ascending: false })
            .limit(WATCHED_HISTORY_LIMIT),
          supabase
            .from('watch_history')
            .select('video_id, watched_at, videos(category, hashtags)')
            .eq('user_id', user.id)
            .order('watched_at', { ascending: false })
            .limit(30),
          loadHiddenContent(user.id),
        ]);

      preference = (profile?.content_preference as 'short' | 'long') ?? 'long';
      disableShorts = !!profile?.disable_shorts;
      hidden = loadedHidden;

      (subs ?? []).forEach((s: any) => subscribedIds.add(s.channel_id));
      (watched ?? []).forEach((w: any) => watchedIds.add(w.video_id));

      const categoryCounts: Record<string, number> = {};
      const hashtagCounts: Record<string, number> = {};
      (recentHistory ?? []).forEach((h: any) => {
        const cat = h.videos?.category;
        if (cat) categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
        (h.videos?.hashtags ?? []).forEach((tag: string) => {
          hashtagCounts[tag] = (hashtagCounts[tag] ?? 0) + 1;
        });
      });
      Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([c]) => topCategories.add(c));
      Object.entries(hashtagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([h]) => topHashtags.add(h));
    }

    ctxRef.current = {
      userId: user?.id ?? null,
      preference,
      disableShorts,
      hidden,
      subscribedIds,
      watchedIds,
      topCategories,
      topHashtags,
      cutoff: new Date().toISOString(),
    };

    await fetchBatch(true);
  }

  /**
   * Jedna dávka videí z databáze.
   *
   * Filtry (shadow ban, schované položky, vypnuté Sparks) můžou dávku
   * vyprázdnit celou - v tom případě appka rovnou sáhne pro další, ať
   * scrollování nekončí uprostřed.
   */
  async function fetchBatch(isFirst: boolean) {
    const ctx = ctxRef.current;
    if (!ctx || loadingRef.current) return;
    loadingRef.current = true;

    try {
      let emptyBatches = 0;
      let hiddenSoFar = 0;

      while (emptyBatches < MAX_EMPTY_BATCHES) {
        const from = offsetRef.current;
        const { data } = await supabase
          .from('videos')
          .select(VIDEO_COLUMNS)
          .eq('status', 'ready')
          .eq('visibility', 'public')
          .lte('created_at', ctx.cutoff)
          .or(`scheduled_at.is.null,scheduled_at.lte.${ctx.cutoff},is_premiere.eq.true`)
          .order('created_at', { ascending: false })
          .range(from, from + FEED_BATCH - 1);

        const rows = data ?? [];
        offsetRef.current = from + rows.length;

        // Kratší dávka, než jsme chtěli, znamená konec seznamu.
        const reachedEnd = rows.length < FEED_BATCH;
        if (reachedEnd) setHasMore(false);

        const batch = applyFilters(rows, ctx);

        if (isFirst) {
          hiddenSoFar += countHidden(rows, ctx);
          setHiddenCount(hiddenSoFar);
          setSparkNotice(explainMissingSparks(batch, rows.filter(isSpark).length, ctx.disableShorts));
        } else if (batch.some(isSpark)) {
          // Sparks se objevily až v pozdější dávce - hláška "žádné Sparks"
          // by pak lhala.
          setSparkNotice(null);
        }

        if (batch.length > 0) {
          appendBatch(batch, ctx);
          loadProgressFor(batch, ctx);
          return;
        }

        if (reachedEnd) {
          if (isFirst) setEmpty(true);
          return;
        }

        emptyBatches++;
      }

      // Několik dávek za sebou vyšlo naprázdno (třeba když má divák schovaný
      // celý kanál). Ať stránka nezůstane viset na kostře, ukáže se prázdný
      // feed - značka dole pak sama sáhne pro další dávky.
      if (isFirst) setBlocks([]);
    } finally {
      loadingRef.current = false;
    }
  }

  function applyFilters(rows: any[], ctx: FeedContext) {
    let batch = rows.filter((v: any) => !seenIdsRef.current.has(v.id));

    // Shadow ban tady schválně není. Řeší ho databáze (restriktivní
    // politika na tabulce videos), takže platí i v Exploreru, hledání a
    // na hashtazích - dřív se filtrovalo jen tady a seznam
    // shadow-bannovaných si přitom mohl stáhnout kdokoliv.

    // Co si divák schoval přes ⋮ ("Nezajímá mě" / "Nedoporučovat kanál").
    batch = filterHidden(batch, ctx.hidden);

    // Nastavení "Vypnout Sparks a krátký obsah". Když jsou Sparks vidět
    // všude jinde, jen ne na hlavní stránce, bývá zapnuté právě tohle.
    if (ctx.disableShorts) batch = batch.filter((v: any) => !isSpark(v));

    return batch;
  }

  function countHidden(rows: any[], ctx: FeedContext) {
    return rows.length - filterHidden(rows, ctx.hidden).length;
  }

  /**
   * Přidá dávku na konec feedu.
   *
   * Bloky se schválně jen přidávají a už hotové se nesahá. Dřív se při
   * každém donačtení přestavěl celý seznam, takže React překreslil i
   * karty, které byly dávno na obrazovce - a právě tam appka viditelně
   * škubla.
   */
  function appendBatch(batch: any[], ctx: FeedContext) {
    batch.forEach((v: any) => seenIdsRef.current.add(v.id));

    const scored = [...batch].sort((a, b) => scoreVideo(b, ctx) - scoreVideo(a, ctx));
    const sparksVideos = scored.filter(isSpark);
    const longVideos = scored.filter((v: any) => !isSpark(v));
    const nextBlocks = buildBlocks(longVideos, sparksVideos, ctx.preference);

    setBlocks((prev) => [...(prev ?? []), ...nextBlocks]);
  }

  /** Doplní proužky "kde jsi skončil" u karet z právě přidané dávky. */
  async function loadProgressFor(batch: any[], ctx: FeedContext) {
    if (!ctx.userId) return;

    const { data: history } = await supabase
      .from('watch_history')
      .select('video_id, progress_seconds')
      .eq('user_id', ctx.userId)
      .in('video_id', batch.map((v: any) => v.id));

    if (!history || history.length === 0) return;

    setProgressMap((prev) => {
      const next = { ...prev };
      for (const h of history) {
        const video = batch.find((v: any) => v.id === h.video_id);
        if (video?.duration_seconds) {
          next[h.video_id] = Math.min(100, Math.round((h.progress_seconds / video.duration_seconds) * 100));
        }
      }
      return next;
    });
  }

  async function loadMore() {
    if (loadingRef.current || !hasMore) return;
    setLoadingMore(true);
    await fetchBatch(false);
    setLoadingMore(false);
  }

  // "Zobrazit znovu" - vrátí zpátky všechno, co si divák schoval přes ⋮,
  // a načte feed nanovo od začátku.
  async function restoreHidden() {
    const ctx = ctxRef.current;
    if (!ctx?.userId) return;

    await clearHiddenContent(ctx.userId);

    offsetRef.current = 0;
    seenIdsRef.current = new Set();
    setHiddenCount(0);
    setBlocks(null);
    setEmpty(false);
    setHasMore(true);
    loadInitial();
  }

  // Řádky "proč tu něco není". Ukazují se nad feedem i nad prázdnou
  // stránkou - právě když je stránka prázdná, je vysvětlení nejvíc potřeba.
  const notices = (
    <>
      {hiddenCount > 0 && (
        <div className="feed-notice">
          <span>{t('hiddenFilterNotice').replace('{n}', String(hiddenCount))}</span>
          <button type="button" className="feed-notice-action" onClick={restoreHidden}>
            {t('hiddenFilterNoticeAction')}
          </button>
        </div>
      )}
      {sparkNotice === 'off' && (
        <div className="feed-notice">
          <span>{t('sparksOffNotice')}</span>
          <Link className="feed-notice-action" href="/settings">
            {t('sparksOffNoticeAction')}
          </Link>
        </div>
      )}
      {sparkNotice === 'rule' && (
        <div className="feed-notice">
          <span>{t('sparksRuleNotice')}</span>
        </div>
      )}
    </>
  );

  if (empty) {
    return (
      <div>
        {notices}
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-faint)' }}>
          <p>{t('noVideosYet')}</p>
          <Link href="/upload" style={{ color: 'var(--text)' }}>{t('uploadFirstVideo')}</Link>
        </div>
      </div>
    );
  }

  if (!blocks) {
    return (
      <div>
        <p className="section-title">{t('recommendedForYouHeading')}</p>
        <div className="video-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="video-card-skeleton">
              <div className="video-thumb skeleton-shimmer" />
              <div className="skeleton-line skeleton-shimmer" style={{ width: '85%' }} />
              <div className="skeleton-line skeleton-shimmer" style={{ width: '50%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <OnboardingChecklist />
      <p className="section-title">{t('recommendedForYouHeading')}</p>
      {notices}

      {blocks.map((block, i) => (
        <div key={i} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 24 }}>
          {block.items.map((video: any) => (
            <VideoCard
              key={video.id}
              video={video}
              href={block.type === 'sparks' ? `/sparks?start=${video.id}` : `/watch/${video.id}`}
              isSparks={block.type === 'sparks'}
              progressPercent={progressMap[video.id]}
              formatDuration={formatDuration}
            />
          ))}
        </div>
      ))}

      <div ref={sentinelRef} style={{ height: 1 }} />
      {loadingMore && (
        <p style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '20px 0' }}>{t('loadingMore')}</p>
      )}
      {!hasMore && blocks.length > 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '20px 0', fontSize: 13 }}>
          {t('thatsAllForNow')}
        </p>
      )}
    </div>
  );
}
