/**
 * Jméno kanálu, jak se ukazuje divákům.
 *
 * PROČ
 *
 * Na kartách i na stránce videa se jméno bralo jako
 * `display_name ?? username` - operátor ?? přeskočí jen null, ne prázdný
 * text. Kanál s vymazaným zobrazovaným jménem ('') se tak všude ukazoval
 * bez jména („· 15 zhlédnutí“, prázdná hlavička u videa). Tady se bere první
 * neprázdné jméno a když žádné není, náhradní text.
 *
 * Čistá funkce: tests/channelName.test.mjs.
 */
export type NamedProfile = { display_name?: string | null; username?: string | null } | null | undefined;

export function channelName(profile: NamedProfile, fallback: string): string {
  const display = typeof profile?.display_name === 'string' ? profile.display_name.trim() : '';
  if (display) return display;
  const username = typeof profile?.username === 'string' ? profile.username.trim() : '';
  if (username) return username;
  return fallback;
}

/** První písmeno jména pro náhradní „avatar“ (kolečko s písmenem), když kanál fotku nemá. */
export function channelInitial(name: string): string {
  const ch = (name || '').trim().replace(/^[@#\s]+/, '').charAt(0);
  return ch ? ch.toLocaleUpperCase() : '•';
}
