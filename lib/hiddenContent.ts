import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { isHiddenBy } from './feedFilters';

/**
 * "Nezajímá mě" a "Nedoporučovat kanál".
 *
 * Divák si může schovat konkrétní video nebo rovnou celý kanál a appka mu
 * ho přestane doporučovat - na hlavní stránce, v Exploreru, ve Sparks,
 * v hledání i po konci videa. Seznam je vždycky jen jeho - kdo si co
 * schoval se nikdo jiný, ani tvůrce, nedozví.
 *
 * Seznam se načte jednou za ~10 minut (sdílí ho všechny stránky) a každé
 * schování / vrácení ho hned upraví a ohlásí (onHiddenChange) - hlavní
 * stránka tak schované video nevrátí ani při návratu zpět. Dřív se karta
 * jen sbalila a po návratu na stránku tam byla zas.
 *
 * Tabulky přidává samostatná migrace (supabase-migration-hidden-content.sql).
 * Dokud neproběhne, tyhle funkce se tváří, jako by nebylo schované nic -
 * feed tím pádem funguje dál, jen se schovávání neuloží.
 */

/** Schované video s kategorií a hashtagy - pro doporučování "tohle ne" (lib/homeRecommendation.ts - interestWeights). */
export type HiddenVideoDetail = { category: string | null; hashtags: string[]; at: number };

export type HiddenContent = {
  videoIds: Set<string>;
  channelIds: Set<string>;
  /** Nejnovější schovaná videa (nepovinné). */
  details?: HiddenVideoDetail[];
};

export const NOTHING_HIDDEN: HiddenContent = {
  videoIds: new Set<string>(),
  channelIds: new Set<string>(),
};

export type HiddenChange =
  | { type: 'hide' | 'unhide'; kind: 'video' | 'channel'; id: string; userId: string }
  | { type: 'clear'; userId: string };

const CACHE_TTL_MS = 10 * 60 * 1000;
const DETAILS_MAX = 50;

let cache: { userId: string; at: number; value: HiddenContent } | null = null;
let inflight: { userId: string; promise: Promise<HiddenContent> } | null = null;
const listeners = new Set<(change: HiddenChange) => void>();

/** Přihlásí se k odběru změn (schování / vrácení). Vrací funkci na odhlášení. */
export function onHiddenChange(listener: (change: HiddenChange) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Upraví sadu schovaných podle změny (nové objekty - starý zůstane, jak byl). */
export function applyHiddenChange(hidden: HiddenContent, change: HiddenChange): HiddenContent {
  if (change.type === 'clear') return { videoIds: new Set(), channelIds: new Set(), details: [] };
  const videoIds = new Set(hidden.videoIds);
  const channelIds = new Set(hidden.channelIds);
  const target = change.kind === 'video' ? videoIds : channelIds;
  if (change.type === 'hide') target.add(change.id);
  else target.delete(change.id);
  return { videoIds, channelIds, details: hidden.details };
}

function emit(change: HiddenChange) {
  if (cache && cache.userId === change.userId) {
    cache = { ...cache, value: applyHiddenChange(cache.value, change) };
  }
  listeners.forEach((listener) => {
    try {
      listener(change);
    } catch {
      // Jeden posluchač nesmí shodit ostatní.
    }
  });
}

/** Co má divák schované teď (z paměti, bez dotazu); null = ještě se nenačetlo. */
export function cachedHiddenContent(userId: string | null | undefined): HiddenContent | null {
  if (!userId || !cache || cache.userId !== userId) return null;
  return cache.value;
}

function toDetails(rows: any[]): HiddenVideoDetail[] {
  return rows
    .map((r) => {
      const video = Array.isArray(r?.videos) ? r.videos[0] : r?.videos;
      const at = Date.parse(r?.hidden_at ?? '');
      return {
        category: typeof video?.category === 'string' ? video.category : null,
        hashtags: Array.isArray(video?.hashtags) ? video.hashtags.filter((h: unknown) => typeof h === 'string') : [],
        at: Number.isFinite(at) ? at : 0,
      };
    })
    .filter((d) => d.category || d.hashtags.length > 0)
    .sort((a, b) => b.at - a.at)
    .slice(0, DETAILS_MAX);
}

async function fetchHidden(userId: string): Promise<HiddenContent> {
  const withDetails = () =>
    supabase.from('hidden_videos').select('video_id, hidden_at, videos(category, hashtags)').eq('user_id', userId);
  const [videosRes, channels] = await Promise.all([
    withDetails().then(async (res) => (res.error ? supabase.from('hidden_videos').select('video_id').eq('user_id', userId) : res)),
    supabase.from('hidden_channels').select('channel_id').eq('user_id', userId),
  ]);
  const videoRows: any[] = (videosRes.data as any[] | null) ?? [];
  return {
    videoIds: new Set(videoRows.map((r: any) => r.video_id)),
    channelIds: new Set(((channels.data as any[] | null) ?? []).map((r: any) => r.channel_id)),
    details: toDetails(videoRows),
  };
}

/**
 * Co má divák schované. Jednou za ~10 minut z databáze, jinak z paměti
 * (všechny stránky sdílí jedno načtení). `fresh` = vždy z databáze.
 */
export async function loadHiddenContent(userId: string, opts: { fresh?: boolean } = {}): Promise<HiddenContent> {
  if (!userId) return NOTHING_HIDDEN;
  if (!opts.fresh && cache && cache.userId === userId && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight && inflight.userId === userId) return inflight.promise;
  const promise = fetchHidden(userId)
    .then((value) => {
      cache = { userId, at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { userId, promise };
  return promise;
}

/**
 * Schované položky přihlášeného diváka pro stránku, která dostane seznam
 * hotový (hledání - výsledky počítá server, který diváka nezná). Bez
 * přihlášení nic. Platí stav z načtení stránky: karta, kterou divák schová
 * teď, zůstane sbalená s tlačítkem "Zpět" (components/VideoCard.tsx) -
 * nezmizí mu pod rukama. S `live` se změny projeví hned.
 */
export function useHiddenContent(opts: { live?: boolean } = {}): HiddenContent {
  const live = !!opts.live;
  // Z paměti hned (načetla ho už jiná stránka) - schované tak neproblikne; účet se ověří níž.
  const [state, setState] = useState<{ userId: string | null; hidden: HiddenContent }>(() => ({
    userId: cache?.userId ?? null,
    hidden: cache?.value ?? NOTHING_HIDDEN,
  }));
  useEffect(() => {
    let alive = true;
    let userId: string | null = null;
    const off = onHiddenChange((change) => {
      if (!live || !alive || change.userId !== userId) return;
      setState((prev) => ({ userId: prev.userId, hidden: applyHiddenChange(prev.hidden, change) }));
    });
    (async () => {
      const { data } = await supabase.auth.getSession();
      userId = data.session?.user?.id ?? null;
      if (!alive) return;
      if (!userId) {
        // Nepřihlášený (nebo odhlášený) - nic schovaného, ani z paměti po jiném účtu.
        setState((prev) => (prev.userId === null && prev.hidden === NOTHING_HIDDEN ? prev : { userId: null, hidden: NOTHING_HIDDEN }));
        return;
      }
      const hidden = await loadHiddenContent(userId).catch(() => NOTHING_HIDDEN);
      if (alive) setState({ userId, hidden });
    })().catch(() => {});
    return () => {
      alive = false;
      off();
    };
  }, [live]);
  return state.hidden;
}

/**
 * Vyhodí ze seznamu videa, která si divák (nebo jejichž kanál) schoval.
 *
 * Typ videa se schválně nijak neomezuje: každá stránka si z databáze tahá
 * jiné sloupce, takže jakékoliv přesnější omezení by se s některým z těch
 * tvarů rozešlo a build by spadl. Funkce vrátí přesně ten typ, který
 * dostala.
 */
export function filterHidden<T>(videos: T[], hidden: HiddenContent): T[] {
  if (hidden.videoIds.size === 0 && hidden.channelIds.size === 0) return videos;
  return videos.filter((video) => !isHiddenBy(video, hidden));
}

/**
 * Schová video z doporučení.
 *
 * Zapisuje se přes insert, ne upsert - upsert znamená "když už tam je,
 * přepiš to", což potřebuje zvláštní povolení k úpravě, které tabulka
 * schválně nemá. Když už je video schované, databáze se ozve duplicitou
 * a to je v pořádku, výsledek je stejný.
 */
export async function hideVideo(userId: string, videoId: string) {
  const { error } = await supabase.from('hidden_videos').insert({ user_id: userId, video_id: videoId });
  const result = { error: isDuplicate(error) ? null : error };
  if (!result.error) emit({ type: 'hide', kind: 'video', id: videoId, userId });
  return result;
}

function isDuplicate(error: { code?: string } | null) {
  return !!error && (error.code === '23505' || error.code === '23409');
}

export async function unhideVideo(userId: string, videoId: string) {
  const result = await supabase.from('hidden_videos').delete().eq('user_id', userId).eq('video_id', videoId);
  if (!result.error) emit({ type: 'unhide', kind: 'video', id: videoId, userId });
  return result;
}

export async function hideChannel(userId: string, channelId: string) {
  const { error } = await supabase.from('hidden_channels').insert({ user_id: userId, channel_id: channelId });
  const result = { error: isDuplicate(error) ? null : error };
  if (!result.error) emit({ type: 'hide', kind: 'channel', id: channelId, userId });
  return result;
}

export async function unhideChannel(userId: string, channelId: string) {
  const result = await supabase.from('hidden_channels').delete().eq('user_id', userId).eq('channel_id', channelId);
  if (!result.error) emit({ type: 'unhide', kind: 'channel', id: channelId, userId });
  return result;
}

/**
 * Vrátí zpátky všechno schované najednou.
 *
 * "Nezajímá mě" byla do teď jednosměrka - kliknutím video zmizelo z
 * doporučení a nikde v appce nebylo, jak si ho vrátit. Odsud to jde jedním
 * tlačítkem přímo z hlavní stránky.
 */
export async function clearHiddenContent(userId: string) {
  await Promise.all([
    supabase.from('hidden_videos').delete().eq('user_id', userId),
    supabase.from('hidden_channels').delete().eq('user_id', userId),
  ]);
  emit({ type: 'clear', userId });
}
