/**
 * Hledání v knihovně: na stránce playlistu, lajkovaných, historie, Sledovat
 * později atd. hledá pole nahoře jen v tom, co je na stránce - ne na celém Kine.
 *
 *  - Kde se hledá v sekci, rozhoduje cesta (searchScopeFor). Dřív v tom
 *    chyběly lajkovaná, historie i jednotlivý playlist - hledání odtud vedlo
 *    na celé Kine.
 *  - Výsledky se filtrují hned při psaní (adresa ?q= se mění bez načítání
 *    stránky); Enter nikam nevede. Na celé Kine vede tlačítko v poli.
 *  - Hledá se v názvu, jménu tvůrce a hashtazích, bez ohledu na velká písmena
 *    a diakritiku ("dabel" najde "Ďábel"); víc slov = musí sedět všechna.
 *
 * Čisté funkce mají test: tests/searchScope.test.mjs.
 */

export type SearchScope =
  | 'playlist'
  | 'liked'
  | 'history'
  | 'watchLater'
  | 'playlists'
  | 'subscriptions'
  | 'yourVideos'
  | 'downloaded'
  | 'activity';

const EXACT: Record<string, SearchScope> = {
  '/liked': 'liked',
  '/history': 'history',
  '/watch-later': 'watchLater',
  '/playlists': 'playlists',
  '/subscriptions': 'subscriptions',
  '/your-videos': 'yourVideos',
  '/downloaded': 'downloaded',
  '/activity': 'activity',
};

/** V jaké knihovně je stránka (hledá se jen v ní); null = hledá se na celém Kine. */
export function searchScopeFor(pathname: string | null | undefined): SearchScope | null {
  if (!pathname) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (EXACT[path]) return EXACT[path];
  if (/^\/playlists\/[^/]+$/.test(path)) return 'playlist';
  return null;
}

/** Klíč překladu pro text v poli hledání ("Hledat v playlistu…"). */
export const SCOPE_PLACEHOLDER: Record<SearchScope, string> = {
  playlist: 'searchInPlaylist',
  liked: 'searchInLiked',
  history: 'searchInHistory',
  watchLater: 'searchInWatchLater',
  playlists: 'searchInPlaylists',
  subscriptions: 'searchInSubscriptions',
  yourVideos: 'searchInYourVideos',
  downloaded: 'searchInDownloads',
  activity: 'searchInActivity',
};

/** Malá písmena bez diakritiky ("Ďábel" -> "dabel"). */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Slova hledaného textu (bez diakritiky); prázdné = hledá se všechno. */
export function searchWords(query: string | null | undefined): string[] {
  return foldText(query ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/^#/, ''))
    .filter(Boolean);
}

type Searchable = {
  title?: string | null;
  username?: string | null;
  display_name?: string | null;
  hashtags?: unknown;
  profiles?: unknown;
};

/** Texty, ve kterých se u položky hledá: název, tvůrce, hashtagy. */
function textsOf(item: Searchable): string[] {
  const texts: string[] = [];
  if (typeof item?.title === 'string') texts.push(item.title);
  if (typeof item?.username === 'string') texts.push(item.username);
  if (typeof item?.display_name === 'string') texts.push(item.display_name);
  const profiles = Array.isArray(item?.profiles) ? item.profiles : item?.profiles ? [item.profiles] : [];
  for (const p of profiles as any[]) {
    if (typeof p?.username === 'string') texts.push(p.username);
    if (typeof p?.display_name === 'string') texts.push(p.display_name);
  }
  if (Array.isArray(item?.hashtags)) for (const h of item.hashtags) if (typeof h === 'string') texts.push(h);
  return texts;
}

/** Sedí položka (video, playlist, kanál) na hledaný text? Prázdný text = ano. */
export function matchesSearch(item: Searchable | null | undefined, query: string | null | undefined): boolean {
  const words = searchWords(query);
  if (words.length === 0) return true;
  if (!item) return false;
  const hay = foldText(textsOf(item).join(' \u0001 '));
  return words.every((w) => hay.includes(w));
}

/** Seznam vyfiltrovaný hledaným textem (prázdný text = celý seznam). */
export function filterBySearch<T extends Searchable>(items: readonly T[], query: string | null | undefined): T[] {
  if (searchWords(query).length === 0) return [...items];
  return items.filter((item) => matchesSearch(item, query));
}

/** Adresa stránky s hledaným textem (?q=), ostatní parametry zůstanou. */
export function withQuery(pathname: string, search: string, query: string): string {
  const params = new URLSearchParams(search);
  const q = query.trim();
  if (q) params.set('q', q);
  else params.delete('q');
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
