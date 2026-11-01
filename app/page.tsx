'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { prefetchSparks } from '@/lib/sparksPrefetch';
import OnboardingChecklist from '@/components/OnboardingChecklist';
import DesktopAppBanner from '@/components/DesktopAppBanner';
import LoadFailed from '@/components/LoadFailed';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import VideoCard from '@/components/VideoCard';
import ContinueWatching from '@/components/ContinueWatching';
import LiveNowRow from '@/components/LiveNowRow';
import HomePostsShelf from '@/components/HomePostsShelf';
import { scoreVideo, explainVideo, buildBlocks, formatDuration, diversify, interestWeights, mergeCandidates, FEED_BATCH, WATCHED_HISTORY_LIMIT } from '@/lib/homeRecommendation';
import { impressionsSnapshot, recordImpressions, clearImpression } from '@/lib/feedImpressions';
import { gameTagSets } from '@/lib/games';
import { loadFollowedGames } from '@/lib/gamesData';
import type { Block } from '@/lib/homeRecommendation';
import { loadHiddenContent, filterHidden, clearHiddenContent, NOTHING_HIDDEN } from '@/lib/hiddenContent';
import type { HiddenContent } from '@/lib/hiddenContent';
import { isSpark, nearMissSparks } from '@/lib/videoBlocks';
import { VideoBlockRow } from '@/components/SparksShelf';

const VIDEO_COLUMNS =
  'id, title, thumbnail_url, views, duration_seconds, width, height, created_at, category, hashtags, owner_id, cloudflare_video_id, scheduled_at, is_premiere, profiles!videos_owner_id_fkey(username)';
/** Navíc pro doporučování: jazyk videa a kvalita (videos.engagement z supabase-migration-doporucovani-vykon.sql). */
const RANK_COLUMNS = `${VIDEO_COLUMNS}, language, engagement`;
/** Bez migrace sloupec engagement chybí - pak se jede po staru (bez kvality), nic nespadne. */
let rankColumns = true;
function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === '42703' || /column .* does not exist/i.test(error.message ?? ''));
}

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
  /** Zájmy s vahou 0-1 (čerstvá zhlédnutí víc) - lib/homeRecommendation.ts interestWeights. */
  categoryWeights: Map<string, number>;
  hashtagWeights: Map<string, number>;
  /** Jazyk webu - videa v něm dostanou přednost. */
  lang: string;
  /** Kolikrát divák kartu už viděl bez kliknutí (lib/feedImpressions.ts), zmrazené při načtení. */
  impressions: (videoId: string) => number;
  /** Hashtagy her, které divák sleduje (lib/games.ts - gameTagSets). */
  gameStrong: Set<string>;
  gameWeak: Set<string>;
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

/**
 * Feed z minula - návrat na hlavní stránku (zpět z videa, klik na Domů) se
 * ukáže hned, i s místem, kde divák byl, místo nového kola dotazů a kostry.
 * Žije jen v paměti otevřené stránky (zavřením karty zmizí) a 10 minut.
 */
type FeedSnapshot = {
  savedAt: number;
  userId: string | null;
  blocks: Block[];
  progressMap: Record<string, number>;
  hasMore: boolean;
  sparkNotice: 'off' | 'rule' | null;
  hiddenCount: number;
  ctx: FeedContext;
  offset: number;
  seenIds: string[];
  pool: any[];
  scrollY: number;
};

const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
/** Feed načtený před víc než půl hodinou se už neukazuje ani při častém vracení (nová videa). */
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
let feedSnapshot: FeedSnapshot | null = null;
/** Kdy naposledy přišel krok zpět/vpřed v prohlížeči - jen tehdy se vrací i pozice na stránce. */
let lastPopAt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastPopAt = Date.now();
  });
}

function freshSnapshot(): FeedSnapshot | null {
  if (!feedSnapshot) return null;
  const now = Date.now();
  const loadedAt = Date.parse(feedSnapshot.ctx.cutoff);
  if (now - feedSnapshot.savedAt >= SNAPSHOT_TTL_MS || !Number.isFinite(loadedAt) || now - loadedAt >= SNAPSHOT_MAX_AGE_MS) return null;
  return feedSnapshot;
}

/** Veřejná hotová videa do `cutoff` (základ všech dotazů hlavní stránky). */
function feedQuery(cutoff: string) {
  return supabase
    .from('videos')
    .select(rankColumns ? RANK_COLUMNS : VIDEO_COLUMNS)
    .eq('status', 'ready')
    .eq('visibility', 'public')
    .lte('created_at', cutoff)
    .or(`scheduled_at.is.null,scheduled_at.lte.${cutoff},is_premiere.eq.true`);
}

/** Jedna dávka videí z databáze (od `from`, videa do `cutoff`). */
function queryBatch(from: number, cutoff: string) {
  return feedQuery(cutoff)
    .order('created_at', { ascending: false })
    .range(from, from + FEED_BATCH - 1);
}

const daysAgo = (cutoff: string, days: number) => new Date(Date.parse(cutoff) - days * 24 * 3600 * 1000).toISOString();

/**
 * Kandidáti mimo časovou osu. Feed jde jinak po dávkách od nejnovějšího -
 * starší, ale skvělé video nebo video odebíraného kanálu z minulého týdne
 * by se k divákovi dostalo, jen kdyby doscrolloval hodně hluboko.
 *
 * Zdroje: oblíbené za poslední týden, nejlépe hodnocené (dokoukanost a
 * hodnocení) za 3 měsíce, odebírané kanály, nejsilnější zájem a sledované
 * hry. Každý zdroj pár desítek videí; spadlý zdroj se tiše vynechá.
 */
async function loadCandidates(cutoff: string, who: { subscribedIds: Set<string>; topCategory: string | null; gameTags: string[] } | null): Promise<any[]> {
  const sources: PromiseLike<{ data: any[] | null; error: any }>[] = [
    feedQuery(cutoff).gte('created_at', daysAgo(cutoff, 7)).order('views', { ascending: false }).limit(24),
  ];
  if (rankColumns) {
    sources.push(feedQuery(cutoff).gte('created_at', daysAgo(cutoff, 90)).not('engagement', 'is', null).order('engagement', { ascending: false }).limit(24));
  }
  if (who && who.subscribedIds.size > 0) {
    // Adresa dotazu má limit délky - stačí 150 kanálů.
    const ids = [...who.subscribedIds].slice(0, 150);
    sources.push(feedQuery(cutoff).in('owner_id', ids).gte('created_at', daysAgo(cutoff, 45)).order('created_at', { ascending: false }).limit(36));
  }
  if (who?.topCategory) {
    sources.push(feedQuery(cutoff).eq('category', who.topCategory).gte('created_at', daysAgo(cutoff, 120)).order('views', { ascending: false }).limit(24));
  }
  if (who && who.gameTags.length > 0) {
    sources.push(feedQuery(cutoff).overlaps('hashtags', who.gameTags.slice(0, 20)).gte('created_at', daysAgo(cutoff, 60)).order('created_at', { ascending: false }).limit(18));
  }
  const results = await Promise.all(sources.map((q) => Promise.resolve(q).then((r) => r, () => ({ data: null, error: true }))));
  if (rankColumns && results.some((r) => isMissingColumn(r.error))) {
    // Migrace ještě není spuštěná - znovu bez nových sloupců.
    rankColumns = false;
    return loadCandidates(cutoff, who);
  }
  return mergeCandidates(results.map((r) => (r.error ? null : (r.data as any[]))));
}

/** Kolik kandidátů mimo časovou osu se přimíchá do jedné dávky (první dávka víc - je nejvíc vidět). */
const POOL_FIRST = 16;
const POOL_NEXT = 10;

/** Kolik karet nahoře stáhne náhled hned a přednostně (to, co je vidět bez scrollování). */
const PRIORITY_CARDS = 4;

export default function HomePage() {
  const { t, lang } = useLanguage();
  // Feed z minula (návrat na stránku) - jen při prvním vykreslení.
  const restoredRef = useRef<FeedSnapshot | null | undefined>(undefined);
  if (restoredRef.current === undefined) restoredRef.current = freshSnapshot();
  const restored = restoredRef.current;
  const [blocks, setBlocks] = useState<Block[] | null>(restored?.blocks ?? null);
  const [empty, setEmpty] = useState(false);
  const [progressMap, setProgressMap] = useState<Record<string, number>>(restored?.progressMap ?? {});
  const [hasMore, setHasMore] = useState(restored?.hasMore ?? true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Proč na stránce nejsou Sparks. Feed je do teď zahazoval potichu, takže
  // se nedalo poznat, jestli je chyba v appce, v nastavení nebo v datech.
  const [sparkNotice, setSparkNotice] = useState<'off' | 'rule' | null>(restored?.sparkNotice ?? null);
  const [hiddenCount, setHiddenCount] = useState(restored?.hiddenCount ?? 0);
  // Dokud tohle tu nebylo, spadlý dotaz nikdo nezachytil: stav zůstal na
  // "ještě nemám data" a stránka ukazovala kostru donekonečna.
  const [loadFailed, setLoadFailed] = useState(false);

  // Tyhle věci se mezi dávkami nemění a nesmí spustit překreslení stránky,
  // proto sedí v ref a ne ve state.
  const ctxRef = useRef<FeedContext | null>(restored?.ctx ?? null);
  const offsetRef = useRef(restored?.offset ?? 0);
  const seenIdsRef = useRef<Set<string>>(new Set(restored?.seenIds ?? []));
  // Kandidáti mimo časovou osu (loadCandidates) - přimíchávají se do dávek.
  const poolRef = useRef<any[]>(restored?.pool ?? []);
  const poolPromiseRef = useRef<Promise<void> | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Pro uložení feedu při odchodu ze stránky (úklid efektu vidí jen první vykreslení).
  const latestRef = useRef({ blocks, progressMap, hasMore, sparkNotice, hiddenCount });
  latestRef.current = { blocks, progressMap, hasMore, sparkNotice, hiddenCount };
  const scrollYRef = useRef(0);
  const router = useRouter();

  // Sparks dopředu (lib/sparksPrefetch.ts): až je feed načtený a prohlížeč volný,
  // připraví se seznam a první dva Sparks - klepnutí na Sparks v menu pak nečeká.
  const feedReady = !!blocks && blocks.length > 0;
  useEffect(() => {
    if (!feedReady) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      router.prefetch('/sparks');
      void prefetchSparks();
    };
    const w = window as typeof window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const idle = typeof w.requestIdleCallback === 'function';
    const handle = idle ? w.requestIdleCallback!(run, { timeout: 4000 }) : window.setTimeout(run, 1500);
    return () => {
      cancelled = true;
      if (idle && w.cancelIdleCallback) w.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedReady]);

  useEffect(() => {
    const onScroll = () => {
      scrollYRef.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    if (restored) {
      // Zpět z videa: i na stejné místo, kde divák byl.
      if (Date.now() - lastPopAt < 1500 && restored.scrollY > 0) {
        requestAnimationFrame(() => window.scrollTo(0, restored.scrollY));
      }
      // Mezitím se mohl změnit účet (odhlášení, jiný účet) - pak feed načíst znovu.
      supabase.auth.getSession().then(({ data }) => {
        if ((data.session?.user?.id ?? null) === restored.userId) return;
        feedSnapshot = null;
        ctxRef.current = null;
        offsetRef.current = 0;
        seenIdsRef.current = new Set();
        poolRef.current = [];
        poolPromiseRef.current = null;
        setBlocks(null);
        setProgressMap({});
        setHasMore(true);
        setSparkNotice(null);
        setHiddenCount(0);
        startLoad();
      });
    } else {
      startLoad();
    }

    return () => {
      window.removeEventListener('scroll', onScroll);
      const st = latestRef.current;
      if (!st.blocks || st.blocks.length === 0 || !ctxRef.current) return;
      feedSnapshot = {
        savedAt: Date.now(),
        userId: ctxRef.current.userId,
        blocks: st.blocks,
        progressMap: st.progressMap,
        hasMore: st.hasMore,
        sparkNotice: st.sparkNotice,
        hiddenCount: st.hiddenCount,
        ctx: ctxRef.current,
        offset: offsetRef.current,
        seenIds: [...seenIdsRef.current],
        pool: poolRef.current,
        scrollY: scrollYRef.current,
      };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Spustí načtení feedu a pohlídá, že se případný pád projeví na obrazovce. */
  async function startLoad() {
    setLoadFailed(false);
    try {
      await loadInitial();
    } catch {
      // Konkrétní chybu tu nemá cenu ukazovat - divákovi neřekne nic
      // a bývá to stejně jen "Failed to fetch". Podstatné je, že se dá
      // zkusit to znovu.
      setLoadFailed(true);
      loadingRef.current = false;
    }
  }

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

  // Které karty divák opravdu viděl (aspoň napůl, přes vteřinu) - příště
  // klesnou, když na ně neklikl (lib/feedImpressions.ts). Jedna karta se
  // za návštěvu stránky započítá nejvýš jednou.
  const impressionObserverRef = useRef<IntersectionObserver | null>(null);
  const observedRef = useRef<WeakSet<Element>>(new WeakSet());
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const timers = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (timers.has(el)) continue;
            timers.set(
              el,
              window.setTimeout(() => {
                timers.delete(el);
                observer.unobserve(el);
                const id = el.dataset.vid;
                if (id && !document.hidden) recordImpressions([id]);
              }, 1000)
            );
          } else {
            const timer = timers.get(el);
            if (timer !== undefined) {
              clearTimeout(timer);
              timers.delete(el);
            }
          }
        }
      },
      { threshold: [0.5] }
    );
    impressionObserverRef.current = observer;
    return () => {
      observer.disconnect();
      timers.forEach((timer) => clearTimeout(timer));
      impressionObserverRef.current = null;
      observedRef.current = new WeakSet();
    };
  }, []);

  useEffect(() => {
    const observer = impressionObserverRef.current;
    const root = feedRef.current;
    if (!observer || !root) return;
    root.querySelectorAll<HTMLElement>('[data-vid]').forEach((el) => {
      if (observedRef.current.has(el)) return;
      observedRef.current.add(el);
      observer.observe(el);
    });
  }, [blocks]);

  /** Klik na kartu = zájem; karta se nepenalizuje (lib/feedImpressions.ts). */
  function onFeedClick(e: { target: EventTarget | null }) {
    const card = (e.target as HTMLElement | null)?.closest?.('[data-vid]') as HTMLElement | null;
    const id = card?.dataset.vid;
    if (id) clearImpression(id);
  }

  async function loadInitial() {
    // První dávka videí jde do databáze hned, souběžně s tím, co o divákovi
    // víme (odběry, historie...) - dřív čekala, až dorazí všechno ostatní.
    const cutoff = new Date().toISOString();
    // Pozor: dotaz Supabase se odešle až při "await"/then() - bez then() tady by
    // první dávka čekala na profil a historii a souběh by byl jen naoko.
    const firstBatch = queryBatch(0, cutoff).then((res) => res);
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user ?? null;

    const subscribedIds = new Set<string>();
    const watchedIds = new Set<string>();
    const topCategories = new Set<string>();
    const topHashtags = new Set<string>();
    let categoryWeights = new Map<string, number>();
    let hashtagWeights = new Map<string, number>();
    let preference: 'short' | 'long' = 'long';
    let disableShorts = false;
    let hidden: HiddenContent = NOTHING_HIDDEN;
    let gameSets = { strong: new Set<string>(), weak: new Set<string>() };

    if (user) {
      const [{ data: profile }, { data: subs }, { data: watched }, { data: recentHistory }, loadedHidden, followedGames] =
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
            .limit(60),
          loadHiddenContent(user.id),
          // Sledované hry (/game/[slug]); bez migrace nebo při chybě prostě žádné.
          loadFollowedGames(),
        ]);
      gameSets = gameTagSets(followedGames);

      preference = (profile?.content_preference as 'short' | 'long') ?? 'long';
      disableShorts = !!profile?.disable_shorts;
      hidden = loadedHidden;

      (subs ?? []).forEach((s: any) => subscribedIds.add(s.channel_id));
      (watched ?? []).forEach((w: any) => watchedIds.add(w.video_id));

      // Zájmy s vahou: co divák sledoval nedávno, váží víc než to, co sledoval před měsícem.
      const weights = interestWeights((recentHistory ?? []).map((h: any) => ({ category: h.videos?.category ?? null, hashtags: h.videos?.hashtags ?? [] })));
      categoryWeights = weights.categories;
      hashtagWeights = weights.hashtags;
      [...categoryWeights.keys()].slice(0, 3).forEach((c) => topCategories.add(c));
      [...hashtagWeights.keys()].slice(0, 8).forEach((h) => topHashtags.add(h));
    }

    const ctx: FeedContext = {
      userId: user?.id ?? null,
      preference,
      disableShorts,
      hidden,
      subscribedIds,
      watchedIds,
      topCategories,
      topHashtags,
      categoryWeights,
      hashtagWeights,
      lang,
      impressions: impressionsSnapshot(),
      gameStrong: gameSets.strong,
      gameWeak: gameSets.weak,
      cutoff,
    };
    ctxRef.current = ctx;

    // Kandidáti mimo časovou osu. První dávka na ně počká nanejvýš chvilku -
    // na pomalém připojení se feed ukáže hned a kandidáti přijdou do dalších dávek.
    poolRef.current = [];
    const pool = loadCandidates(cutoff, user ? { subscribedIds, topCategory: [...categoryWeights.keys()][0] ?? null, gameTags: [...gameSets.strong] } : null)
      .then((items) => {
        if (ctxRef.current !== ctx) return;
        poolRef.current = mergeCandidates([poolRef.current, items.filter((v: any) => !watchedIds.has(v.id))], seenIdsRef.current);
      })
      .catch(() => undefined);
    poolPromiseRef.current = pool;
    await Promise.race([pool, new Promise((resolve) => setTimeout(resolve, 700))]);

    await fetchBatch(true, firstBatch);
  }

  /**
   * Jedna dávka videí z databáze.
   *
   * Filtry (shadow ban, schované položky, vypnuté Sparks) můžou dávku
   * vyprázdnit celou - v tom případě appka rovnou sáhne pro další, ať
   * scrollování nekončí uprostřed.
   */
  async function fetchBatch(isFirst: boolean, prefetched?: PromiseLike<Awaited<ReturnType<typeof queryBatch>>>) {
    const ctx = ctxRef.current;
    if (!ctx || loadingRef.current) return;
    loadingRef.current = true;

    try {
      let emptyBatches = 0;
      let hiddenSoFar = 0;
      let early = prefetched && offsetRef.current === 0 ? prefetched : null;

      while (emptyBatches < MAX_EMPTY_BATCHES) {
        const from = offsetRef.current;
        // První dávka už mohla odejít dřív (loadInitial) - jinak teď.
        let { data, error } = await (early ?? queryBatch(from, ctx.cutoff));
        early = null;
        if (error && rankColumns && isMissingColumn(error)) {
          // Bez migrace (sloupec engagement) - stejná dávka po staru.
          rankColumns = false;
          ({ data, error } = await queryBatch(from, ctx.cutoff));
        }

        // Chyba se tu dřív zahazovala a pokračovalo se s prázdným polem.
        // Supabase u spadlého spojení nevyhodí výjimku, jen vrátí data:
        // null - z toho appce vyšlo "kratší dávka, než jsem chtěl", tedy
        // "konec seznamu", a divákovi ukázala hlášku "Zatím tu nejsou
        // žádná videa" s nabídkou nahrát první. Při vypadlé wifi tedy
        // appka tvrdila, že je celá platforma prázdná.
        if (error) throw error;

        const rows = data ?? [];
        offsetRef.current = from + rows.length;

        // Kratší dávka, než jsme chtěli, znamená konec seznamu.
        const reachedEnd = rows.length < FEED_BATCH;
        if (reachedEnd) setHasMore(false);

        // Přimíchat kandidáty mimo časovou osu (oblíbené, odebírané, zájmy...).
        // Na konci seznamu jdou ven všichni zbylí, ať žádný nepropadne.
        const extra = takeFromPool(ctx, reachedEnd ? Infinity : isFirst ? POOL_FIRST : POOL_NEXT);
        const batch = applyFilters(mergeCandidates([rows, extra]), ctx);

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

  /** Vezme z kandidátů až `count` videí, která na stránce ještě nebyla. */
  function takeFromPool(ctx: FeedContext, count: number): any[] {
    if (count <= 0 || poolRef.current.length === 0) return [];
    const fresh = poolRef.current.filter((v: any) => !seenIdsRef.current.has(v.id));
    // Nejlepší kandidáty napřed (bez náhody v pořadí výběru by vyhrávaly pořád stejné).
    const ranked = fresh
      .map((v: any) => ({ v, s: scoreVideo(v, ctx) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.v);
    const taken = ranked.slice(0, count);
    const takenIds = new Set(taken.map((v: any) => v.id));
    poolRef.current = fresh.filter((v: any) => !takenIds.has(v.id));
    return taken;
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

    // Skóre jednou na video (v něm je kousek náhody - počítat ho při každém
    // porovnání v řazení dávalo pokaždé jiné číslo a řazení bylo napůl náhodné).
    // Pak rozmanitost: stejný kanál za sebou postupně ztrácí body.
    const scores = new Map<string, number>(batch.map((v: any) => [v.id, scoreVideo(v, ctx)]));
    const scored = diversify(batch, (v: any) => scores.get(v.id) ?? 0);
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
    if (loadingRef.current || !hasMore || loadFailed) return;
    setLoadingMore(true);
    try {
      await fetchBatch(false);
    } catch {
      // Donačítání spadlo. Feed, který už na obrazovce je, zůstává -
      // jen se pod ním nabídne další pokus místo věčného "Načítám…".
      setLoadFailed(true);
      loadingRef.current = false;
    } finally {
      setLoadingMore(false);
    }
  }

  /** Další pokus po výpadku - dobere jen to, co chybí, feed se nemaže. */
  async function retryLoad() {
    setLoadFailed(false);
    if (!ctxRef.current) {
      startLoad();
      return;
    }
    setLoadingMore(true);
    try {
      await fetchBatch(false);
    } catch {
      setLoadFailed(true);
      loadingRef.current = false;
    } finally {
      setLoadingMore(false);
    }
  }

  // "Zobrazit znovu" - vrátí zpátky všechno, co si divák schoval přes ⋮,
  // a načte feed nanovo od začátku.
  async function restoreHidden() {
    const ctx = ctxRef.current;
    if (!ctx?.userId) return;

    await clearHiddenContent(ctx.userId);

    feedSnapshot = null;
    offsetRef.current = 0;
    seenIdsRef.current = new Set();
    poolRef.current = [];
    poolPromiseRef.current = null;
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
          {/* Volba "Vypnout Sparks" je v Nastavení v oddílu Domovská. */}
          <Link className="feed-notice-action" href="/settings#home">
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

  /** Popisek "proč tohle video" - viz explainVideo. Bez kontextu nic. */
  function reasonFor(video: any): string | null {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const key = explainVideo(video, ctx);
    return key ? t(key) : null;
  }

  if (empty) {
    return (
      <div>
        {notices}
        {/* I bez jediného videa může někdo vysílat živě. */}
        <LiveNowRow />
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
        <DesktopAppBanner />
        <p className="section-title">{t('recommendedForYouHeading')}</p>
        {loadFailed && <LoadFailed onRetry={startLoad} />}
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
      {/* Kine do PC na dosah - jen na počítači, ne v okně appky, jde zavřít. */}
      <DesktopAppBanner />
      <OnboardingChecklist />
      {/* "Tady jsi skončil" - jen pro přihlášené a jen když je co dokoukat;
          jinak se nevykreslí nic. */}
      <ContinueWatching />
      {/* Kdo teď vysílá živě - když nikdo, nevykreslí se nic. */}
      <LiveNowRow />
      <p className="section-title">{t('recommendedForYouHeading')}</p>
      {notices}

      <div ref={feedRef} className="home-feed" onClickCapture={onFeedClick} onAuxClickCapture={onFeedClick}>
      {blocks.map((block, i) => (
        <Fragment key={i}>
          {/* Novinky od odebíraných kanálů: jedna nenápadná řada pod prvním blokem videí (lib/homePosts.ts). */}
          {i === 1 && <HomePostsShelf />}
          <VideoBlockRow type={block.type} style={{ marginBottom: 24 }}>
            {block.items.map((video: any, j: number) => (
              <VideoCard
                key={video.id}
                priority={i === 0 && j < PRIORITY_CARDS}
                video={video}
                href={block.type === 'sparks' ? `/sparks?start=${video.id}` : `/watch/${video.id}`}
                isSparks={block.type === 'sparks'}
                progressPercent={progressMap[video.id]}
                formatDuration={formatDuration}
                reason={reasonFor(video)}
              />
            ))}
          </VideoBlockRow>
        </Fragment>
      ))}
      </div>
      {/* Jen jeden blok videí: řada novinek pod ním. */}
      {blocks.length === 1 && <HomePostsShelf />}

      <div ref={sentinelRef} style={{ height: 1 }} />
      {loadFailed && <LoadFailed onRetry={retryLoad} />}
      {loadingMore && (
        <p style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '20px 0' }}>{t('loadingMore')}</p>
      )}
      {!loadFailed && !hasMore && blocks.length > 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '20px 0', fontSize: 13 }}>
          {t('thatsAllForNow')}
        </p>
      )}
    </div>
  );
}
