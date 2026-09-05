import { supabaseServer } from '@/lib/supabaseServer';
import { computeTrustRating } from '@/lib/trustRating';
import SearchResults from '@/components/SearchResults';

export const dynamic = 'force-dynamic';

/** Co karta videa potřebuje (components/VideoCard.tsx): náhled po najetí,
 *  tvar, délku, tvůrce. */
const CARD_FIELDS =
  'id, title, thumbnail_url, views, width, height, duration_seconds, category, owner_id, cloudflare_video_id, ' +
  'profiles!videos_owner_id_fkey(id, username, created_at)';

/**
 * Hledání.
 *
 * Napřed přes databázové funkce search_videos / search_creators
 * (supabase-migration-vyhledavani.sql): fulltext, bez ohledu na háčky,
 * s překlepy, v názvu i popisu a hashtagách. Když migrace ještě
 * neproběhla (funkce chybí), spadne to na staré "název obsahuje" - hledá
 * hůř, ale hledá.
 */
async function searchVideos(query: string): Promise<any[]> {
  const { data, error } = await supabaseServer.rpc('search_videos', { q: query, max_rows: 48 });

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
    .ilike('title', `%${query}%`)
    .limit(48);
  return videosRaw ?? [];
}

async function searchCreators(query: string): Promise<any[]> {
  const { data, error } = await supabaseServer.rpc('search_creators', { q: query, max_rows: 12 });
  if (!error && Array.isArray(data)) return data;

  // Záloha. Čárka a závorky mají ve filtru PostgREST význam - z hledaného
  // textu se vyhodí, ať si nikdo nesloží vlastní podmínku.
  const safe = query.replace(/[,()]/g, ' ').trim();
  if (!safe) return [];
  const { data: creators } = await supabaseServer
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%`)
    .limit(12);
  return creators ?? [];
}

async function searchAll(query: string, minRating: number | null) {
  let [videos, creators] = await Promise.all([searchVideos(query), searchCreators(query)]);

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
      .order('views', { ascending: false })
      .limit(12);
    recommended = rec ?? [];
  }

  return { videos, creators, recommended };
}

export default async function SearchPage({ searchParams }: { searchParams: { q?: string; minRating?: string } }) {
  const query = searchParams.q?.trim() ?? '';
  const minRating = searchParams.minRating ? Number(searchParams.minRating) : null;

  if (!query) {
    return <SearchResults query="" videos={[]} creators={[]} recommended={[]} />;
  }

  const { videos, creators, recommended } = await searchAll(query, minRating);

  // Kreslí se až v prohlížeči (components/SearchResults.tsx) - jazyk si
  // divák volí tam a server o něm neví.
  return <SearchResults query={query} videos={videos} creators={creators} recommended={recommended} />;
}
