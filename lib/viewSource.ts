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

/**
 * Překladový klíč k názvu zdroje.
 *
 * Vrací klíč, ne hotový text - popisky se pak zobrazí v jazyce, který má
 * uživatel nastavený. U cizích webů se vrací null, protože doména se
 * nepřekládá (ukáže se tak, jak je: třeba "youtube.com").
 */
const SOURCE_LABEL_KEYS: Record<string, string> = {
  home: 'srcHome',
  explore: 'srcExplore',
  search: 'srcSearch',
  subscriptions: 'srcSubscriptions',
  playlist: 'srcPlaylist',
  channel: 'srcChannel',
  sparks: 'srcSparks',
  hashtag: 'srcHashtag',
  watch: 'srcWatch',
  activity: 'srcActivity',
  direct: 'srcDirect',
  external: 'srcExternal',
  unknown: 'srcUnknown',
};

export function viewSourceLabelKey(source: string): string | null {
  return SOURCE_LABEL_KEYS[source] ?? null;
}
