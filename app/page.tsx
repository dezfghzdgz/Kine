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
import {
  scoreVideo,
  explainVideo,
  buildBlocks,
  formatDuration,
  diversify,
  interestWeights,
  mergeCandidates,
  nextDiversityPrior,
  pickChunk,
  topInterests,
  watchFraction,
  watchInfoFromRow,
  watchVerdict,
  FEED_BATCH,
  WATCHED_HISTORY_LIMIT,
  type DiversityPrior,
  type InterestSignal,
  type WatchInfo,
} from '@/lib/homeRecommendation';
import { impressionsSnapshot, recordImpressions, clearImpression } from '@/lib/feedImpressions';
import { reportHandledError } from '@/lib/errorReporter';
import { gameTagSets } from '@/lib/games';
import { loadFollowedGames } from '@/lib/gamesData';
import type { Block } from '@/lib/homeRecommendation';
import {
  loadHiddenContent,
  filterHidden,
  clearHiddenContent,
  cachedHiddenContent,
  onHiddenChange,
  applyHiddenChange,
  NOTHING_HIDDEN,
} from '@/lib/hiddenContent';
import type { HiddenContent } from '@/lib/hiddenContent';
import { feedEligible, isHiddenBy } from '@/lib/feedFilters';
import { anonViewerKey, seededUnit, sessionSeed } from '@/lib/seededRandom';
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

/**
 * Jak hlavní stránka vybírá (lib/homeRecommendation.ts):
 *
 * Dřív se seřadila vždycky jen jedna dávka 48 nejnovějších videí a dávky se
 * lepily za sebe. Penalizace (zhlédnuté, přehlédnuté karty) a zájmy tak
 * jen přehazovaly pořadí uvnitř té dávky - nahoře bylo pořád těch samých
 * ~60 videí, jen jinak zamíchaných. Teď se seřadí celá zásoba kandidátů
 * (prvních ~100 z časové osy + oblíbené, nejlépe hodnocené, odebírané,
 * podle zájmů, sledované hry, čerstvě zveřejněné) a na stránku jde vždy
 * nejlepších 48. Zhlédnuté video do zásoby vůbec nepřijde, takže místo něj
 * dostane šanci něco jiného. Když zásoba dochází, dobere se další stránka
 * časové osy.
 */
const FIRST_PAGE = FEED_BATCH * 2;
/** Kolik karet přibude najednou (jedna "dávka" na stránce). */
const CHUNK = FEED_BATCH;
/** Pod tolik nevydaných kandidátů se dobere další stránka časové osy. */
const POOL_LOW = 60;
/** Kolik stránek časové osy se dobere nanejvýš na jedno přidání (když filtry vyhází skoro všechno). */
const MAX_PAGE_FETCHES = 4;

/** Co appka potřebuje vědět, aby videím spočítala skóre. Platí pro celé sezení. */
type FeedContext = {
  userId: string | null;
  preference: 'short' | 'long';
  disableShorts: boolean;
  hidden: HiddenContent;
  subscribedIds: Set<string>;
  /** Jen kvůli kompatibilitě se scoreVideo - rozhoduje `watched` (s rozkoukaností). */
  watchedIds: Set<string>;
  /** Historie s rozkoukaností (lib/homeRecommendation.ts - watchVerdict). */
  watched: Map<string, WatchInfo>;
  topCategories: Set<string>;
  topHashtags: Set<string>;
  /** Zájmy s vahou -0.5 až 1 (čerstvá a dokoukaná zhlédnutí, lajky; disliky a schované do minusu). */
  categoryWeights: Map<string, number>;
  hashtagWeights: Map<string, number>;
  /** Jazyk webu - videa v něm dostanou přednost. */
  lang: string;
  /** Kolikrát divák kartu už viděl bez kliknutí (lib/feedImpressions.ts), zmrazené při načtení. */
  impressions: (videoId: string) => number;
  /** Náhoda pro video stálá ~30 minut (lib/seededRandom.ts) - F5 feed nepřehází. */
  random: (videoId: string) => number;
  /** Hashtagy her, které divák sleduje (lib/games.ts - gameTagSets). */
  gameStrong: Set<string>;
  gameWeak: Set<string>;
  /**
   * Čas načtení stránky. Drží okno videí na místě: bez něj by video nahrané
   * mezitím posunulo všechna ostatní o jedno dolů a při donačítání by se
   * některé ve feedu objevilo dvakrát.
   */
  cutoff: string;
  /** Totéž v ms - podle něj se počítá stáří (skóre je pro celé sezení stejné). */
  now: number;
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
  chronoDone: boolean;
  seenIds: string[];
  pool: any[];
  prior: DiversityPrior | null;
  scores: [string, number][];
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

/** Bloky bez schovaných videí (prázdné bloky pryč). */
function withoutHidden(blocks: Block[], hidden: HiddenContent): Block[] {
  if (hidden.videoIds.size === 0 && hidden.channelIds.size === 0) return blocks;
  return blocks
    .map((block) => ({ ...block, items: block.items.filter((v: any) => !isHiddenBy(v, hidden)) }))
    .filter((block) => block.items.length > 0);
}

function freshSnapshot(): FeedSnapshot | null {
  if (!feedSnapshot) return null;
  const now = Date.now();
  const loadedAt = Date.parse(feedSnapshot.ctx.cutoff);
  if (now - feedSnapshot.savedAt >= SNAPSHOT_TTL_MS || !Number.isFinite(loadedAt) || now - loadedAt >= SNAPSHOT_MAX_AGE_MS) return null;
  // Mezitím si divák mohl něco schovat jinde (Explore, hledání) - ať se to nevrátí.
  const latest = cachedHiddenContent(feedSnapshot.userId);
  if (latest && latest !== feedSnapshot.ctx.hidden) {
    feedSnapshot.ctx.hidden = latest;
    feedSnapshot.blocks = withoutHidden(feedSnapshot.blocks, latest);
    feedSnapshot.pool = feedSnapshot.pool.filter((v: any) => !isHiddenBy(v, latest));
  }
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

/**
 * Jedna stránka časové osy (od `from`, videa do `cutoff`). Druhé řazení podle
 * id drží stránky pevné i u videí nahraných ve stejnou chvíli (jinak by se
 * mezi stránkami mohla prohodit - jedno dvakrát, jiné nikdy).
 */
function queryPage(from: number, size: number, cutoff: string) {
  return feedQuery(cutoff)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + size - 1);
}

const daysAgo = (cutoff: string, days: number) => new Date(Date.parse(cutoff) - days * 24 * 3600 * 1000).toISOString();

/**
 * Kandidáti mimo časovou osu. Časová osa jde od nejnovějšího - starší, ale
 * skvělé video nebo video odebíraného kanálu z minulého týdne by se
 * k divákovi dostalo, jen kdyby doscrolloval hodně hluboko.
 *
 * Zdroje: oblíbené za poslední týden, nejlépe hodnocené (dokoukanost a
 * hodnocení) za 3 měsíce, odebírané kanály, nejsilnější zájmy (kategorie
 * i hashtagy), sledované hry a čerstvě zveřejněná naplánovaná videa (ta se
 * na časové ose řadí podle nahrání, takže by jinak byla hluboko). Každý
 * zdroj pár desítek videí; spadlý zdroj se tiše vynechá.
 */
async function loadCandidates(
  cutoff: string,
  who: { subscribedIds: Set<string>; topCategories: string[]; topHashtags: string[]; gameTags: string[] } | null
): Promise<any[]> {
  const sources: PromiseLike<{ data: any[] | null; error: any }>[] = [
    feedQuery(cutoff).gte('created_at', daysAgo(cutoff, 7)).order('views', { ascending: false }).limit(24),
    feedQuery(cutoff)
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', daysAgo(cutoff, 7))
      .lte('scheduled_at', cutoff)
      .order('scheduled_at', { ascending: false })
      .limit(16),
  ];
  if (rankColumns) {
    sources.push(feedQuery(cutoff).gte('created_at', daysAgo(cutoff, 90)).not('engagement', 'is', null).order('engagement', { ascending: false }).limit(24));
  }
  if (who && who.subscribedIds.size > 0) {
    // Adresa dotazu má limit délky - stačí 150 kanálů.
    const ids = [...who.subscribedIds].slice(0, 150);
    sources.push(feedQuery(cutoff).in('owner_id', ids).gte('created_at', daysAgo(cutoff, 45)).order('created_at', { ascending: false }).limit(36));
  }
  if (who && who.topCategories.length > 0) {
    sources.push(feedQuery(cutoff).in('category', who.topCategories.slice(0, 3)).gte('created_at', daysAgo(cutoff, 120)).order('views', { ascending: false }).limit(36));
  }
  // Hashtagy jsou volný text - se závorkou, uvozovkou nebo čárkou by se pole v dotazu rozbilo.
  const safeTags = (who?.topHashtags ?? []).filter((h) => h.length <= 50 && !/[{}",()\\\s]/.test(h)).slice(0, 8);
  if (safeTags.length > 0) {
    sources.push(feedQuery(cutoff).overlaps('hashtags', safeTags).gte('created_at', daysAgo(cutoff, 60)).order('created_at', { ascending: false }).limit(24));
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

/** Chyba přihlášení u dotazu (prošlý / neplatný token) - pomůže obnovit přihlášení. */
function isAuthError(e: unknown): boolean {
  const o = (e && typeof e === 'object' ? e : {}) as { status?: unknown; code?: unknown; message?: unknown };
  return Number(o.status) === 401 || o.code === 'PGRST301' || o.code === 'PGRST302' || /jwt/i.test(String(o.message ?? ''));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Kolik karet nahoře stáhne náhled hned a přednostně (to, co je vidět bez scrollování). */
const PRIORITY_CARDS = 4;

/** Vnořený profil/video chodí ze Supabase jako objekt i jako pole. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Signály zájmu: zhlédnutí (s dokoukaností), lajky a disliky, schovaná videa. */
function interestSignals(recent: any[], reactions: any[], hidden: HiddenContent): InterestSignal[] {
  const out: InterestSignal[] = [];
  for (const row of recent) {
    const video = one<any>(row?.videos);
    if (!video) continue;
    const info = watchInfoFromRow(row);
    out.push({
      category: video.category ?? null,
      hashtags: Array.isArray(video.hashtags) ? video.hashtags : [],
      kind: 'watch',
      at: info.at || null,
      fraction: watchFraction(info, video.duration_seconds),
    });
  }
  for (const row of reactions) {
    const video = one<any>(row?.videos);
    if (!video) continue;
    const raw = Number(row?.score);
    const score = Number.isFinite(raw) && raw > 0 ? raw : row?.reaction === 'like' ? 5 : row?.reaction === 'dislike' ? 1 : 3;
    if (score === 3) continue;
    const at = Date.parse(row?.created_at ?? '');
    out.push({
      category: video.category ?? null,
      hashtags: Array.isArray(video.hashtags) ? video.hashtags : [],
      kind: score >= 4 ? 'like' : 'dislike',
      at: Number.isFinite(at) ? at : null,
    });
  }
  for (const d of hidden.details ?? []) {
    out.push({ category: d.category, hashtags: d.hashtags, kind: 'hide', at: d.at || null });
  }
  return out;
}

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
  // Přidání nevyšlo nic (filtry vyhází celou stránku), ale další jsou - značka dole to zkusí znovu.
  const [kick, setKick] = useState(0);

  // Tyhle věci se mezi dávkami nemění a nesmí spustit překreslení stránky,
  // proto sedí v ref a ne ve state.
  const ctxRef = useRef<FeedContext | null>(restored?.ctx ?? null);
  /** Kam až se došlo na časové ose (kolik řádků už přišlo). */
  const offsetRef = useRef(restored?.offset ?? 0);
  const chronoDoneRef = useRef(restored?.chronoDone ?? false);
  /** Co už je na stránce (nikdy podruhé). */
  const seenIdsRef = useRef<Set<string>>(new Set(restored?.seenIds ?? []));
  /** Zásoba kandidátů, kteří na stránce ještě nebyli - řadí se celá. */
  const poolRef = useRef<any[]>(restored?.pool ?? []);
  /** Rozmanitost napříč dávkami (kanály a kategorie, které už na stránce jsou). */
  const priorRef = useRef<DiversityPrior | null>(restored?.prior ?? null);
  /** Skóre se počítá jednou na video a sezení. */
  const scoresRef = useRef<Map<string, number>>(new Map(restored?.scores ?? []));
  const feedRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Pro uložení feedu při odchodu ze stránky (úklid efektu vidí jen první vykreslení).
  const latestRef = useRef({ blocks, progressMap, hasMore, sparkNotice, hiddenCount });
  latestRef.current = { blocks, progressMap, hasMore, sparkNotice, hiddenCount };
  const scrollYRef = useRef(0);
  const mountedRef = useRef(true);
  const router = useRouter();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // "Nezajímá mě" / "Nedoporučovat kanál" na kartě: hned do kontextu - další dávky,
  // zásoba i uložený feed (návrat zpět) ho už neukážou. Dřív se karta jen sbalila
  // a po návratu na stránku tam byla zas.
  useEffect(
    () =>
      onHiddenChange((change) => {
        const ctx = ctxRef.current;
        if (!ctx || !ctx.userId || change.userId !== ctx.userId) return;
        ctx.hidden = applyHiddenChange(ctx.hidden, change);
        if (change.type === 'hide') poolRef.current = poolRef.current.filter((v: any) => !isHiddenBy(v, ctx.hidden));
      }),
    []
  );

  // Sparks dopředu (lib/sparksPrefetch.ts): až je feed načtený a prohlížeč volný,
  // připraví se seznam a první dva Sparks - klepnutí na Sparks v menu pak nečeká.
  const feedReady = !!blocks && blocks.length > 0;
  useEffect(() => {
    if (!feedReady) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      router.prefetch('/sparks');
      const ctx = ctxRef.current;
      // Co o divákovi víme (schovaná, historie, odběry) - Sparks podle toho seřadí stejně jako jejich stránka.
      void prefetchSparks(ctx ? { userId: ctx.userId, hidden: ctx.hidden, watched: ctx.watched, subscribed: ctx.subscribedIds } : undefined);
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
        resetFeedState();
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
      const ctx = ctxRef.current;
      if (!st.blocks || st.blocks.length === 0 || !ctx) return;
      feedSnapshot = {
        savedAt: Date.now(),
        userId: ctx.userId,
        // Schované během prohlížení (sbalená karta) se při návratu už neukáže.
        blocks: withoutHidden(st.blocks, ctx.hidden),
        progressMap: st.progressMap,
        hasMore: st.hasMore,
        sparkNotice: st.sparkNotice,
        hiddenCount: st.hiddenCount,
        ctx,
        offset: offsetRef.current,
        chronoDone: chronoDoneRef.current,
        seenIds: [...seenIdsRef.current],
        pool: poolRef.current,
        prior: priorRef.current,
        scores: [...scoresRef.current.entries()],
        scrollY: scrollYRef.current,
      };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetFeedState() {
    ctxRef.current = null;
    offsetRef.current = 0;
    chronoDoneRef.current = false;
    seenIdsRef.current = new Set();
    poolRef.current = [];
    priorRef.current = null;
    scoresRef.current = new Map();
  }

  /**
   * Spustí načtení feedu. Když první pokus spadne, zkusí to appka sama ještě
   * dvakrát (po chvilce), než ukáže „Nepovedlo se“: po obnovení stránky (F5)
   * první dotaz občas spadne (obnovuje se přihlášení, staré spojení s databází)
   * a hned další projde - dřív to divák musel odklikat sám. Příčina se nahlásí
   * na /admin/errors (lib/errorReporter.ts - reportHandledError).
   */
  async function startLoad() {
    setLoadFailed(false);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await loadInitial();
        return;
      } catch (e) {
        loadingRef.current = false;
        if (attempt === 0) reportHandledError('Domů: načtení feedu', e);
        if (attempt === 2 || !mountedRef.current) break;
        // Prošlé / neplatné přihlášení: nejdřív ho obnovit.
        if (isAuthError(e)) await supabase.auth.refreshSession().catch(() => undefined);
        await wait(attempt === 0 ? 700 : 2000);
        if (!mountedRef.current) return;
      }
    }
    if (mountedRef.current) setLoadFailed(true);
  }

  // Automatické donačítání - jakmile je "cílová značka" dole vidět na
  // obrazovce, appka přidá další dávku (ze zásoby, případně dobere databázi).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, blocks, kick]);

  // Spojení se vrátilo / divák se vrátil k záložce: když feed visí na „Nepovedlo se“,
  // zkusí to znovu sám (bez klikání na „Zkusit znovu“).
  useEffect(() => {
    if (!loadFailed) return;
    const again = () => {
      if (document.visibilityState === 'visible') void retryLoad();
    };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFailed]);

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
    // První stránka videí jde do databáze hned, souběžně s tím, co o divákovi
    // víme (odběry, historie...) - dřív čekala, až dorazí všechno ostatní.
    const cutoff = new Date().toISOString();
    const now = Date.parse(cutoff);
    // Přihlášení napřed připravit (z paměti prohlížeče; prošlý token se tu obnoví) -
    // první dotaz po obnovení stránky jinak mohl odejít dřív a spadnout.
    await supabase.auth.getSession().catch(() => null);
    // Pozor: dotaz Supabase se odešle až při "await"/then() - bez then() tady by
    // první stránka čekala na profil a historii a souběh by byl jen naoko.
    const firstPage = queryPage(0, FIRST_PAGE, cutoff).then((res) => res);
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user ?? null;

    const subscribedIds = new Set<string>();
    const watchedIds = new Set<string>();
    const watched = new Map<string, WatchInfo>();
    let categoryWeights = new Map<string, number>();
    let hashtagWeights = new Map<string, number>();
    let preference: 'short' | 'long' = 'long';
    let disableShorts = false;
    let hidden: HiddenContent = NOTHING_HIDDEN;
    let gameSets = { strong: new Set<string>(), weak: new Set<string>() };

    if (user) {
      const reactionsQuery = (fields: string) =>
        supabase.from('video_reactions').select(fields).eq('user_id', user.id).order('created_at', { ascending: false }).limit(60);
      const [{ data: profile }, { data: subs }, { data: history }, { data: recentHistory }, reactionsRes, loadedHidden, followedGames] =
        await Promise.all([
          supabase.from('profiles').select('content_preference, disable_shorts').eq('id', user.id).single(),
          supabase.from('subscriptions').select('channel_id').eq('subscriber_id', user.id),
          // Jen posledních pár set zhlédnutí, i s tím, kolik z videa divák viděl (watchVerdict).
          // Bez omezení a bez určeného pořadí vrátí databáze náhodných tisíc řádků.
          supabase
            .from('watch_history')
            .select('video_id, progress_seconds, completed, watched_at')
            .eq('user_id', user.id)
            .order('watched_at', { ascending: false })
            .limit(WATCHED_HISTORY_LIMIT),
          supabase
            .from('watch_history')
            .select('video_id, watched_at, progress_seconds, completed, videos(category, hashtags, duration_seconds)')
            .eq('user_id', user.id)
            .order('watched_at', { ascending: false })
            .limit(60),
          // Lajky a disliky (hvězdičky) - zájem i nechuť. Bez sloupce score (starší databáze) jen reakce.
          reactionsQuery('video_id, score, reaction, created_at, videos(category, hashtags)').then(async (res) =>
            res.error ? reactionsQuery('video_id, reaction, created_at, videos(category, hashtags)') : res
          ),
          loadHiddenContent(user.id).catch(() => NOTHING_HIDDEN),
          // Sledované hry (/game/[slug]); bez migrace nebo při chybě prostě žádné.
          loadFollowedGames(),
        ]);
      gameSets = gameTagSets(followedGames);

      preference = (profile?.content_preference as 'short' | 'long') ?? 'long';
      disableShorts = !!profile?.disable_shorts;
      hidden = loadedHidden;

      (subs ?? []).forEach((s: any) => subscribedIds.add(s.channel_id));
      for (const row of (history ?? []) as any[]) {
        if (!row?.video_id || watched.has(row.video_id)) continue;
        watched.set(row.video_id, watchInfoFromRow(row));
        watchedIds.add(row.video_id);
      }

      // Zájmy s vahou: co divák sledoval nedávno a dokoukal, váží víc než překlik před měsícem;
      // lajky přidají, disliky a "Nezajímá mě" uberou.
      const reactions = reactionsRes && !reactionsRes.error ? ((reactionsRes.data ?? []) as any[]) : [];
      const weights = interestWeights(interestSignals((recentHistory ?? []) as any[], reactions, loadedHidden), { now });
      categoryWeights = weights.categories;
      hashtagWeights = weights.hashtags;
    }

    const topCategoryList = topInterests(categoryWeights, 3);
    const topHashtagList = topInterests(hashtagWeights, 8);
    // Semínko na ~30 minut: obnovení stránky (F5) feed nepřehází, další posezení ano.
    const seed = sessionSeed(user?.id ?? anonViewerKey(), now);

    const ctx: FeedContext = {
      userId: user?.id ?? null,
      preference,
      disableShorts,
      hidden,
      subscribedIds,
      watchedIds,
      watched,
      topCategories: new Set(topCategoryList),
      topHashtags: new Set(topHashtagList),
      categoryWeights,
      hashtagWeights,
      lang,
      impressions: impressionsSnapshot(),
      random: (id: string) => seededUnit(seed, id),
      gameStrong: gameSets.strong,
      gameWeak: gameSets.weak,
      cutoff,
      now,
    };
    resetFeedState();
    ctxRef.current = ctx;

    // Kandidáti mimo časovou osu. První dávka na ně počká nanejvýš chvilku -
    // na pomalém připojení se feed ukáže hned a kandidáti přijdou do dalších dávek.
    let candidatesReady: any[] | null = null;
    const candidates = loadCandidates(
      cutoff,
      user ? { subscribedIds, topCategories: topCategoryList, topHashtags: topHashtagList, gameTags: [...gameSets.strong] } : null
    )
      .then((items) => {
        candidatesReady = items;
        return items;
      })
      .catch(() => [] as any[]);
    await Promise.race([candidates, wait(800)]);

    const rows = await fetchPage(ctx, FIRST_PAGE, firstPage);
    if (candidatesReady) admit(candidatesReady, ctx);
    else {
      void candidates.then((items) => {
        if (ctxRef.current !== ctx) return;
        const added = admit(items, ctx);
        // Feed už byl "dočtený" a přišli další kandidáti - značka dole může pokračovat.
        if (added > 0 && mountedRef.current) setHasMore(true);
      });
    }

    // Kolik videí z první stránky si divák schoval (hláška "Zobrazit znovu").
    setHiddenCount(rows.length - filterHidden(rows, ctx.hidden).length);
    await serveChunk(true, rows);
  }

  /** Smí video do zásoby? Ne vlastní, schované, vypnuté Sparks a zhlédnuté (watchVerdict). Vrací, kolik přibylo. */
  function admit(rows: any[], ctx: FeedContext): number {
    const inPool = new Set(poolRef.current.map((v: any) => v.id));
    let added = 0;
    for (const v of rows) {
      if (!v?.id || seenIdsRef.current.has(v.id) || inPool.has(v.id)) continue;
      if (!feedEligible(v, { viewerId: ctx.userId, hidden: ctx.hidden, now: ctx.now })) continue;
      // Nastavení "Vypnout Sparks a krátký obsah".
      if (ctx.disableShorts && isSpark(v)) continue;
      if (watchVerdict(ctx.watched.get(v.id), v, ctx.now).hide) continue;
      poolRef.current.push(v);
      inPool.add(v.id);
      added++;
    }
    return added;
  }

  /**
   * Další stránka časové osy do zásoby. Chyba se tu dřív zahazovala a
   * pokračovalo se s prázdným polem - z toho appce vyšlo "konec seznamu"
   * a při vypadlé wifi tvrdila, že je celá platforma prázdná. Teď vyhodí
   * výjimku (zachytí ji startLoad / loadMore).
   */
  async function fetchPage(ctx: FeedContext, size: number, prefetched?: PromiseLike<Awaited<ReturnType<typeof queryPage>>>) {
    const from = offsetRef.current;
    let { data, error, status } = await (prefetched && from === 0 ? prefetched : queryPage(from, size, ctx.cutoff));
    if (error && rankColumns && isMissingColumn(error)) {
      // Bez migrace (sloupec engagement) - stejná stránka po staru.
      rankColumns = false;
      ({ data, error, status } = await queryPage(from, size, ctx.cutoff));
    }
    if (error) throw Object.assign(new Error(error.message || 'Dotaz na videa spadl'), { code: error.code, status });
    const rows = (data ?? []) as any[];
    offsetRef.current = from + rows.length;
    // Kratší stránka, než jsme chtěli, znamená konec časové osy.
    if (rows.length < size) chronoDoneRef.current = true;
    admit(rows, ctx);
    return rows;
  }

  /** Seřadí celou zásobu a vezme nejlepší dávku (skóre jednou na video, rozmanitost napříč dávkami). */
  function takeChunk(ctx: FeedContext): any[] {
    const pool = poolRef.current;
    if (pool.length === 0) return [];
    const scores = scoresRef.current;
    const score = (v: any) => {
      let s = scores.get(v.id);
      if (s === undefined) {
        s = scoreVideo(v, ctx);
        scores.set(v.id, s);
      }
      return s;
    };
    const ranked = diversify(pool, score, { prior: priorRef.current ?? undefined });
    const quota = ctx.preference === 'short' ? { long: CHUNK / 2, short: CHUNK / 2, total: CHUNK } : { long: CHUNK - 12, short: 12, total: CHUNK };
    const { chunk, rest } = pickChunk(ranked, isSpark, quota);
    poolRef.current = rest;
    priorRef.current = nextDiversityPrior(priorRef.current, chunk);
    return chunk;
  }

  /**
   * Přidá dávku na konec feedu.
   *
   * Bloky se schválně jen přidávají a už hotové se nesahá. Dřív se při
   * každém donačtení přestavěl celý seznam, takže React překreslil i
   * karty, které byly dávno na obrazovce - a právě tam appka viditelně
   * škubla.
   */
  function appendChunk(chunk: any[], ctx: FeedContext) {
    chunk.forEach((v: any) => seenIdsRef.current.add(v.id));
    const sparksVideos = chunk.filter(isSpark);
    const longVideos = chunk.filter((v: any) => !isSpark(v));
    const nextBlocks = buildBlocks(longVideos, sparksVideos, ctx.preference);
    setBlocks((prev) => [...(prev ?? []), ...nextBlocks]);

    // Proužky "kde jsi skončil" z historie, kterou už máme (dřív dotaz na každou dávku).
    const progress: Record<string, number> = {};
    for (const v of chunk) {
      const info = ctx.watched.get(v.id);
      if (!info) continue;
      const fraction = watchFraction(info, v.duration_seconds);
      if (fraction !== null && (info.completed || info.progress > 0)) progress[v.id] = Math.min(100, Math.round(fraction * 100));
    }
    if (Object.keys(progress).length > 0) setProgressMap((prev) => ({ ...prev, ...progress }));
  }

  /**
   * Další dávka na stránku: když zásoba dochází, dobere se časová osa
   * (nanejvýš pár stránek najednou), pak se seřadí a přidá nejlepších 48.
   */
  async function serveChunk(isFirst: boolean, firstRows: any[] = []) {
    const ctx = ctxRef.current;
    if (!ctx || loadingRef.current) return;
    loadingRef.current = true;
    try {
      let fetched = 0;
      while (poolRef.current.length < POOL_LOW && !chronoDoneRef.current && fetched < MAX_PAGE_FETCHES) {
        await fetchPage(ctx, FEED_BATCH);
        fetched++;
      }

      const admitted = isFirst ? [...poolRef.current] : [];
      const chunk = takeChunk(ctx);
      if (chunk.length > 0) appendChunk(chunk, ctx);
      const more = poolRef.current.length > 0 || !chronoDoneRef.current;
      setHasMore(more);

      if (isFirst) {
        setSparkNotice(explainMissingSparks(admitted, firstRows.filter(isSpark).length, ctx.disableShorts));
      } else if (chunk.some(isSpark)) {
        // Sparks se objevily až v pozdější dávce - hláška "žádné Sparks" by pak lhala.
        setSparkNotice(null);
      }

      if (chunk.length === 0) {
        if (isFirst && !more) setEmpty(true);
        // Ať stránka nezůstane viset na kostře, ukáže se prázdný feed - značka dole pak sama sáhne pro další.
        else if (isFirst) setBlocks([]);
        else if (more) setKick((k) => k + 1);
      }
    } finally {
      loadingRef.current = false;
    }
  }

  async function loadMore() {
    if (loadingRef.current || !hasMore || loadFailed) return;
    setLoadingMore(true);
    try {
      try {
        await serveChunk(false);
      } catch (e) {
        // Jednou sám znovu (výpadek na chvilku), teprve pak tlačítko.
        loadingRef.current = false;
        reportHandledError('Domů: další dávka', e);
        if (isAuthError(e)) await supabase.auth.refreshSession().catch(() => undefined);
        await wait(1200);
        await serveChunk(false);
      }
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
      await serveChunk(false);
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
    resetFeedState();
    setHiddenCount(0);
    setBlocks(null);
    setEmpty(false);
    setHasMore(true);
    startLoad();
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
    const key = explainVideo(video, ctx, ctx.now);
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
