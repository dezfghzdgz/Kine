/**
 * Odkud divák na video přišel.
 *
 * Rozpozná se to z toho, odkud prohlížeč na stránku videa přišel
 * (document.referrer) a z adresy samotné. Uvnitř Kine se to přeloží na
 * název místa ("home", "explore", "search", ...), zvenku se uloží jen
 * doména (např. "youtube.com"), nikdy celá adresa - v tom by se dala najít
 * hledaná fráze i jiné věci, které se tvůrce týkat nemají.
 */

export type ViewSource =
  | 'home' | 'explore' | 'search' | 'subscriptions' | 'playlist' | 'channel'
  | 'sparks' | 'hashtag' | 'watch' | 'activity' | 'direct' | 'external' | string;

/** Vnitřní cesty appky přeložené na srozumitelný název místa. */
const INTERNAL_PATHS: { prefix: string; source: ViewSource }[] = [
  { prefix: '/explore', source: 'explore' },
  { prefix: '/search', source: 'search' },
  { prefix: '/subscriptions', source: 'subscriptions' },
  { prefix: '/playlists', source: 'playlist' },
  { prefix: '/channel', source: 'channel' },
  { prefix: '/u/', source: 'channel' },
  { prefix: '/sparks', source: 'sparks' },
  { prefix: '/hashtag', source: 'hashtag' },
  { prefix: '/watch', source: 'watch' },
  { prefix: '/activity', source: 'activity' },
  { prefix: '/history', source: 'activity' },
  { prefix: '/liked', source: 'activity' },
  { prefix: '/watch-later', source: 'playlist' },
  { prefix: '/downloaded', source: 'activity' },
];

export function detectViewSource(): ViewSource {
  if (typeof window === 'undefined') return 'direct';

  // Sledování z playlistu poznáme rovnou z adresy - ta je jistější než to,
  // odkud uživatel přišel (mohl se do playlistu dostat oklikou).
  if (new URLSearchParams(window.location.search).has('playlist')) return 'playlist';

  const referrer = document.referrer;
  if (!referrer) return 'direct';

  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return 'direct';
  }

  if (url.origin !== window.location.origin) {
    // Zvenku si necháme jen doménu, bez "www." a bez zbytku adresy.
    return url.hostname.replace(/^www\./, '').slice(0, 60) || 'external';
  }

  if (url.pathname === '/') return 'home';

  const match = INTERNAL_PATHS.find((p) => url.pathname.startsWith(p.prefix));
  return match ? match.source : 'home';
}

/** Hezký název zdroje pro statistiky. */
export function viewSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    home: 'Hlavní stránka',
    explore: 'Prozkoumat',
    search: 'Hledání',
    subscriptions: 'Odběry',
    playlist: 'Playlist',
    channel: 'Kanál',
    sparks: 'Sparks',
    hashtag: 'Hashtag',
    watch: 'Doporučená videa',
    activity: 'Aktivita a historie',
    direct: 'Přímý odkaz',
    external: 'Odjinud',
    unknown: 'Neznámé',
  };
  return labels[source] ?? source;
}
