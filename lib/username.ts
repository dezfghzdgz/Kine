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
  | 'usernameReserved'
  | 'usernameBlocked';

/* ---------- Nadávky ve jménech ----------
   Ve výpisu účtů se objevilo jméno z rasistické nadávky. Svoboda tvůrce
   je o obsahu, ne o tom, jaké jméno platforma nese v adrese kanálu.

   Dvě úrovně, obě schválně krátké a jen jednoznačné výrazy:
   - BLOCKED_ANYWHERE: nesmí být ani uvnitř jiného slova (nic slušného je
     neobsahuje),
   - BLOCKED_AS_WORD: jen jako celé slovo, protože se schovávají v běžných
     slovech (spic - spicy, coon - raccoon, negr - montenegro).
   Slovo = kus jména mezi tečkou/podtržítkem nebo mezi písmeny a číslicemi.

   Obcházení číslicemi (n1gg3r) řeší převod 0→o 1→i 3→e 4→a 5→s 7→t 8→b.

   Stejné pravidlo musí platit v databázi (username_is_valid v
   supabase-migration-username-rules.sql) - anon klíč je veřejný a formulář
   jde obejít. Když měníš seznam tady, změň ho i tam; test
   tests/username.test.mjs hlídá, že obě strany dávají stejné odpovědi. */

const BLOCKED_ANYWHERE = [
  'nigger', 'nigga', 'niggr', 'faggot', 'fagot', 'wetback', 'raghead', 'towelhead',
  'tranny', 'hitler', 'heilhitler', 'buzerant', 'buzna', 'holohoax',
];

const BLOCKED_AS_WORD = [
  'negr', 'negri', 'nigr', 'spic', 'chink', 'coon', 'gook', 'dyke', 'cunt', 'retard',
  'nazi', 'rape', 'rapist', 'cigos', 'cigosi', 'fag', 'fags', '1488',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' };

function unleet(text: string): string {
  return text.replace(/[0134578@$!]/g, (ch) => LEET[ch] ?? ch);
}

/** Kusy jména: mezi tečkou/podtržítkem a na hranici písmen a číslic. */
function usernameWords(lower: string): string[] {
  return lower
    .split(/[._]+/)
    .flatMap((part) => part.match(/[a-z]+|[0-9]+/g) ?? [])
    .filter(Boolean);
}

/** Obsahuje jméno nadávku (i s číslicemi místo písmen)? */
export function usernameContainsSlur(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  const joined = lower.replace(/[._]/g, '');
  const forms = new Set([joined, unleet(joined)]);

  for (const form of forms) {
    for (const bad of BLOCKED_ANYWHERE) {
      if (form.includes(bad)) return true;
    }
  }

  const words = new Set<string>();
  for (const w of usernameWords(lower)) {
    words.add(w);
    words.add(unleet(w));
  }
  // Číslice mezi písmeny (n1gg3r) se převedou až v celku, tak ještě jednou
  // na kusech jména po převodu.
  for (const w of usernameWords(unleet(lower))) words.add(w);

  for (const w of words) {
    if (BLOCKED_AS_WORD.includes(w)) return true;
  }
  return false;
}

/** Vrátí překladový klíč problému, nebo null když je jméno v pořádku. */
export function validateUsername(raw: string): UsernameProblem | null {
  const name = raw.trim();

  if (name.length < USERNAME_MIN) return 'usernameTooShort';
  if (name.length > USERNAME_MAX) return 'usernameTooLong';
  if (!USERNAME_PATTERN.test(name) || DOUBLE_SEPARATOR.test(name)) return 'usernameBadCharacters';
  if (RESERVED.has(name.toLowerCase())) return 'usernameReserved';
  if (usernameContainsSlur(name)) return 'usernameBlocked';

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
