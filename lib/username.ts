/**
 * Pravidla pro uživatelské jméno.
 *
 * Tenhle soubor je jen pro hezkou hlášku v prohlížeči. Skutečnou stráží je
 * databáze (supabase-migration-username-rules.sql) - anon klíč Supabase je
 * veřejný, takže kdokoliv umí obejít formulář a zapsat si do profilu, co
 * chce. Kontrola tady a kontrola v databázi proto říkají to samé; když
 * budeš jednu měnit, změň i druhou.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/**
 * Písmena, číslice, tečka a podtržítko. Začínat i končit musí písmenem
 * nebo číslicí a dvě oddělovací znaménka nesmí být za sebou.
 *
 * Schválně jen základní latinka: jméno "kіne" s ukrajinským "і" vypadá na
 * první pohled stejně jako "kine" a je to nejlacinější způsob, jak se
 * vydávat za někoho jiného. Zobrazované jméno (display_name) žádné takové
 * omezení nemá - tam si každý může napsat, co chce, včetně diakritiky
 * a emoji.
 */
const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._]*[a-zA-Z0-9]$/;

/**
 * Dvě oddělovací znaménka za sebou ("jan..novak").
 *
 * Je to schválně druhá podmínka a ne chytřejší regulární výraz: databáze
 * neumí "lookahead", takže by tam stejné pravidlo muselo být napsané jinak
 * a časem by se ta dvě místa rozešla. Takhle jsou obě stejná.
 */
const DOUBLE_SEPARATOR = /[._]{2}/;

/**
 * Jména, která si nikdo nevezme.
 *
 * Půlka je kvůli tomu, aby se nikdo nevydával za appku nebo za podporu,
 * druhá kvůli adresám: /channel/me už v appce něco znamená a profil se
 * jménem "me" by se s tím pral.
 */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'sysadmin',
  'kine', 'kineapp', 'kineofficial', 'official', 'staff', 'team',
  'support', 'help', 'helpdesk', 'moderator', 'moderators', 'mod', 'mods',
  'security', 'billing', 'payments', 'legal', 'privacy', 'terms',
  'api', 'www', 'app', 'cdn', 'static', 'assets',
  'me', 'you', 'null', 'undefined', 'anonymous', 'deleted',
  'everyone', 'here', 'all',
]);

export type UsernameProblem =
  | 'usernameTooShort'
  | 'usernameTooLong'
  | 'usernameBadCharacters'
  | 'usernameReserved';

/** Vrátí překladový klíč problému, nebo null když je jméno v pořádku. */
export function validateUsername(raw: string): UsernameProblem | null {
  const name = raw.trim();

  if (name.length < USERNAME_MIN) return 'usernameTooShort';
  if (name.length > USERNAME_MAX) return 'usernameTooLong';
  if (!USERNAME_PATTERN.test(name) || DOUBLE_SEPARATOR.test(name)) return 'usernameBadCharacters';
  if (RESERVED.has(name.toLowerCase())) return 'usernameReserved';

  return null;
}

/**
 * Podoba jména pro porovnávání.
 *
 * Databáze hlídá jedinečnost přes lower(username), takže "Kine" a "kine"
 * je jedno a to samé jméno. Prohlížeč to musí počítat stejně.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}
