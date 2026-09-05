import { supabaseServer } from '@/lib/supabaseServer';
import { computeTrustRating } from '@/lib/trustRating';
import Link from 'next/link';
import Image from 'next/image';

export const dynamic = 'force-dynamic';

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
    // Funkce vrací owner_id; jména a založení účtu tvůrců se doplní jedním
    // dotazem, ať zbytek stránky zůstává stejný.
    const ownerIds = Array.from(new Set(data.map((v: any) => v.owner_id).filter(Boolean)));
    const owners = new Map<string, any>();
    if (ownerIds.length > 0) {
      const { data: profiles } = await supabaseServer
        .from('profiles')
        .select('id, username, created_at')
        .in('id', ownerIds);
      (profiles ?? []).forEach((p: any) => owners.set(p.id, p));
    }
    return data.map((v: any) => ({ ...v, profiles: owners.get(v.owner_id) ?? null }));
  }

  // Záloha: staré hledání.
  const { data: videosRaw } = await supabaseServer
    .from('videos')
    .select('id, title, thumbnail_url, views, profiles!videos_owner_id_fkey(id, username, created_at)')
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
      .select('id, title, thumbnail_url, views, profiles!videos_owner_id_fkey(username)')
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
    return <p style={{ color: 'var(--text-faint)' }}>Type something to search for.</p>;
  }

  const { videos, creators, recommended } = await searchAll(query, minRating);

  return (
    <div>
      <p className="section-title">Výsledky pro "{query}"</p>

      {creators.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <p className="panel-heading">Tvůrci</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 420 }}>
            {creators.map((c: any) => (
              <Link key={c.id} href={`/channel/${c.id}`} className="sidebar-link" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="profile-avatar-small">
                  {c.avatar_url ? <img loading="lazy" decoding="async" src={c.avatar_url} alt="" /> : null}
                </span>
                {c.display_name ?? c.username}
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="panel-heading">Videa</p>
      {videos.length === 0 ? (
        <>
          <p style={{ color: 'var(--text-dim)', fontSize: 16, marginBottom: 28 }}>
            Žádná videa neodpovídají hledání "{query}". Ale možná by se ti mohla líbit tahle:
          </p>
          <div className="video-grid">
            {recommended.map((v: any) => (
              <Link href={`/watch/${v.id}`} key={v.id} className="video-card">
                <div className="video-thumb">
                  {v.thumbnail_url ? (
                    <Image src={v.thumbnail_url} alt={v.title} width={320} height={180} />
                  ) : null}
                  <div className="play-badge">▶</div>
                </div>
                <p className="video-card-title">{v.title}</p>
                <p className="video-card-meta">
                  {v.profiles?.username ?? 'unknown creator'} · {v.views} views
                </p>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="video-grid">
          {videos.map((v: any) => (
            <Link href={`/watch/${v.id}`} key={v.id} className="video-card">
              <div className="video-thumb">
                {v.thumbnail_url ? (
                  <Image src={v.thumbnail_url} alt={v.title} width={320} height={180} />
                ) : null}
                <div className="play-badge">▶</div>
              </div>
              <p className="video-card-title">{v.title}</p>
              <p className="video-card-meta">
                {v.profiles?.username ?? 'unknown creator'} · {v.views} views
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
