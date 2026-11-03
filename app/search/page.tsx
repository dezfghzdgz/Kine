import { supabaseServer } from '@/lib/supabaseServer';
import { computeTrustRating } from '@/lib/trustRating';
import SearchResults from '@/components/SearchResults';
import {
  applySearchFilters,
  filtersActive,
  parseSearchFilters,
  restrictedOwners,
  withoutRestricted,
  type OwnerFlags,
  type SearchFilters,
} from '@/lib/searchFilters';
import { isSpark } from '@/lib/videoBlocks';
import { gameFromText, searchGames } from '@/lib/games';

export const dynamic = 'force-dynamic';

/** Co karta videa potřebuje (components/VideoCard.tsx): náhled po najetí,
 *  tvar, délku, tvůrce. */
const CARD_FIELDS =
  'id, title, thumbnail_url, views, width, height, duration_seconds, category, owner_id, cloudflare_video_id, created_at, scheduled_at, is_premiere, profiles!videos_owner_id_fkey(id, username, created_at)';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Hledání.
 *
 * Napřed přes databázové funkce search_videos / search_creators
 * (supabase-migration-vyhledavani.sql): fulltext, bez ohledu na háčky,
 * s překlepy, v názvu i popisu a hashtagách. Když migrace ještě
 * neproběhla (funkce chybí), spadne to na staré "název obsahuje" - hledá
 * hůř, ale hledá.
 *
 * Hledá se přes service role (obchází pravidla databáze - RLS), takže
 * zablokované a shadow-banované kanály musí vyřadit server sám
 * (loadRestrictedOwners). Schovaná videa diváka vyřadí až prohlížeč
 * (components/SearchResults.tsx) - server diváka nezná.
 */
/**
 * Hry k hledanému (karta nahoře - odkaz na stránku hry): přesný název nebo
 * hashtag ("cs2"), začátek názvu ("mine"), nebo hra v delším dotazu
 * ("minecraft survival"). Nejvýš tři.
 */
function matchingGames(query: string): string[] {
  const slugs = searchGames(query, 6)
    .filter((m) => m.score >= 2)
    .map((m) => m.game.slug);
  const inText = gameFromText(query);
  if (inText && !slugs.includes(inText.slug)) slugs.unshift(inText.slug);
  return slugs.slice(0, 3);
}

/** "%" a "_" jsou v LIKE zástupné znaky - hledaný text se bere doslova. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Které z daných kanálů se nesmí ukázat (zablokované, shadow-banované).
 * Jeden dotaz na všechny; starší databáze bez některého sloupce = podle
 * toho, který tam je (bez sloupce nikdo zablokovaný není).
 */
async function loadRestrictedOwners(ids: (string | null | undefined)[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return new Set();
  const full = await supabaseServer.from('profiles').select('id, is_banned, is_shadow_banned').in('id', unique);
  if (!full.error) return restrictedOwners(full.data as OwnerFlags[]);
  const parts = await Promise.all([
    supabaseServer.from('profiles').select('id, is_shadow_banned').in('id', unique),
    supabaseServer.from('profiles').select('id, is_banned').in('id', unique),
  ]);
  return restrictedOwners(parts.flatMap((r) => (r.error ? [] : ((r.data ?? []) as OwnerFlags[]))));
}

function ownerOf(video: any): string | null {
  const profiles = video?.profiles;
  return video?.owner_id ?? (Array.isArray(profiles) ? profiles[0]?.id : profiles?.id) ?? null;
}

async function searchVideos(query: string, maxRows: number): Promise<any[]> {
  const { data, error } = await supabaseServer.rpc('search_videos', { q: query, max_rows: maxRows });

  if (!error && Array.isArray(data)) {
    // Funkce vrací jen to nejnutnější (id, název, náhled, zhlédnutí, tvůrce)
    // a řadí podle shody. Zbytek pro kartu - tvar, délku, jméno tvůrce -
    // doplní jeden dotaz podle id; pořadí z funkce zůstává.
    const ids = data.map((v: any) => v.id).filter(Boolean);
    const details = new Map<string, any>();
    if (ids.length > 0) {
      const { data: rows } = await supabaseServer.from('videos').select(CARD_FIELDS).in('id', ids);
      (rows ?? []).forEach((v: any) => details.set(v.id, v));
    }
    return data.map((v: any) => ({ ...v, ...(details.get(v.id) ?? { profiles: null }) }));
  }

  // Záloha: staré hledání.
  const { data: videosRaw } = await supabaseServer
    .from('videos')
    .select(CARD_FIELDS)
    .eq('status', 'ready')
    .eq('visibility', 'public')
    .ilike('title', `%${escapeLike(query)}%`)
    .limit(maxRows);
  return videosRaw ?? [];
}

async function searchCreators(query: string): Promise<any[]> {
  const { data, error } = await supabaseServer.rpc('search_creators', { q: query, max_rows: 12 });
  if (!error && Array.isArray(data)) return data;

  // Záloha. Čárka a závorky mají ve filtru PostgREST význam - z hledaného
  // textu se vyhodí, ať si nikdo nesloží vlastní podmínku.
  const safe = query.replace(/[,()"*%\\]/g, ' ').trim();
  if (!safe) return [];
  const { data: creators } = await supabaseServer
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%`)
    .limit(12);
  return creators ?? [];
}

async function searchAll(query: string, minRating: number | null, filters: SearchFilters) {
  // S filtry se bere víc kandidátů - část jich filtr vyřadí.
  let [videos, creators] = await Promise.all([searchVideos(query, filtersActive(filters) ? 120 : 48), searchCreators(query)]);
  // Zablokované a shadow-banované kanály pryč (jeden dotaz na všechny).
  const restricted = await loadRestrictedOwners([...videos.map(ownerOf), ...creators.map((c: any) => c?.id)]);
  videos = withoutRestricted(videos, restricted);
  creators = creators.filter((c: any) => !restricted.has(c?.id));
  // Typ, datum, délka, řazení (lib/searchFilters.ts); naplánovaná videa, která ještě nejsou venku, vypadnou vždycky.
  videos = applySearchFilters(videos, filters, isSpark);

  if (minRating !== null) {
    const uniqueOwners = new Map<string, string>();
    videos.forEach((v: any) => {
      if (v.profiles?.id && v.profiles?.created_at) uniqueOwners.set(v.profiles.id, v.profiles.created_at);
    });
    const scores = await Promise.all(
      Array.from(uniqueOwners.entries()).map(async ([id, createdAt]) => [id, await computeTrustRating(id, createdAt)] as const)
    );
    const passingIds = new Set(scores.filter(([, score]) => score >= minRating).map(([id]) => id));
    videos = videos.filter((v: any) => passingIds.has(v.profiles?.id));
  }
  videos = videos.slice(0, 24);

  let recommended: any[] = [];
  if (videos.length === 0) {
    const { data: rec } = await supabaseServer
      .from('videos')
      .select(CARD_FIELDS)
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()},is_premiere.eq.true`)
      .order('views', { ascending: false })
      .limit(24);
    const list = rec ?? [];
    const recRestricted = await loadRestrictedOwners(list.map(ownerOf));
    recommended = withoutRestricted(list, recRestricted).slice(0, 12);
  }

  return { videos, creators, recommended };
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Next.js 15+: searchParams přichází jako Promise (v Next 14 obyčejný objekt - await ho vrátí beze změny).
export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = (await searchParams) ?? {};
  const query = firstParam(params.q)?.trim() ?? '';
  const minRatingRaw = firstParam(params.minRating) ?? null;
  const minRatingNumber = minRatingRaw ? Number(minRatingRaw) : NaN;
  const minRating = Number.isFinite(minRatingNumber) ? minRatingNumber : null;
  // Filtr hodnocení (čip na stránce) jen s platným číslem - nesmysl v adrese dřív vyřadil všechno.
  const minRatingParam = minRating !== null ? minRatingRaw : null;
  const filters = parseSearchFilters(params);

  if (!query) {
    return <SearchResults query="" videos={[]} creators={[]} recommended={[]} filters={filters} minRating={minRatingParam} />;
  }

  const { videos, creators, recommended } = await searchAll(query, minRating, filters);

  // Kreslí se až v prohlížeči (components/SearchResults.tsx) - jazyk si
  // divák volí tam a server o něm neví.
  return (
    <SearchResults
      query={query}
      videos={videos}
      games={filters.type === 'all' ? matchingGames(query) : []}
      creators={filters.type === 'all' ? creators : []}
      recommended={recommended}
      filters={filters}
      minRating={minRatingParam}
    />
  );
}
