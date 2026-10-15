/**
 * Pravidla chatu živého vysílání - čistá logika bez databáze (tests/liveChatRules.test.mjs).
 *
 * Z průzkumu, co streamerům na Twitchi a spol. vadí nejvíc: nájezdy botů
 * a spam ("hate raids") a že moderovat musí sami uprostřed hry. Proto:
 * pomalý režim, jen odběratelé (i "odebírá aspoň X minut" - nový účet
 * vytvořený na nájezd neprojde), zákaz odkazů, zakázaná slova, minimální
 * stáří účtu, ztlumení / zákaz psaní a jedním klikem "štít", který to
 * všechno zapne naráz. Majitel kanálu, jeho moderátoři a moderátoři Kine
 * pravidla nemají.
 */

export type ChatSettings = {
  /** Mezi zprávami jednoho člověka aspoň tolik vteřin (0 = vypnuto). */
  slowSeconds: number;
  /** Psát smí jen odběratelé kanálu... */
  followersOnly: boolean;
  /** ...kteří odebírají aspoň tolik minut (0 = hned). */
  followMinutes: number;
  /** Zprávy s odkazem neprojdou. */
  blockLinks: boolean;
  /** Zakázaná slova / fráze (bez ohledu na velikost písmen a diakritiku). */
  blockedTerms: string[];
  /** Účet musí být starý aspoň tolik minut (0 = jakýkoli). */
  minAccountMinutes: number;
  /** Štít zapnutý (jen pro přehled - hodnoty výš už jsou nastavené). */
  shield: boolean;
  /** Jen emoty a emoji (jako "emote-only" na Twitchi) - zprávy se slovy neprojdou. */
  emoteOnly: boolean;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  slowSeconds: 0,
  followersOnly: false,
  followMinutes: 0,
  blockLinks: false,
  blockedTerms: [],
  minAccountMinutes: 0,
  shield: false,
  emoteOnly: false,
};

/** Štít: co se zapne jedním klikem, když na chat přijde nájezd. */
export const SHIELD_SETTINGS: Omit<ChatSettings, 'blockedTerms' | 'shield' | 'emoteOnly'> = {
  slowSeconds: 30,
  followersOnly: true,
  followMinutes: 10,
  blockLinks: true,
  minAccountMinutes: 24 * 60,
};

export const SLOW_MODE_OPTIONS = [0, 3, 10, 30, 60, 120];
export const FOLLOW_MINUTES_OPTIONS = [0, 10, 60, 24 * 60];
export const TIMEOUT_MINUTES = [1, 10, 60, 24 * 60];
export const MAX_BLOCKED_TERMS = 100;

/** Bezpečné hodnoty z čehokoli (z databáze i od klienta). */
export function sanitizeChatSettings(raw: unknown): ChatSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  };
  const termsRaw = Array.isArray(r.blockedTerms ?? r.blocked_terms) ? ((r.blockedTerms ?? r.blocked_terms) as unknown[]) : [];
  const terms = Array.from(
    new Set(
      termsRaw
        .map((t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 60))
        .filter((t) => t.length >= 2)
    )
  ).slice(0, MAX_BLOCKED_TERMS);
  return {
    slowSeconds: int(r.slowSeconds ?? r.slow_seconds, 0, 600),
    followersOnly: (r.followersOnly ?? r.followers_only) === true,
    followMinutes: int(r.followMinutes ?? r.follow_minutes, 0, 43200),
    blockLinks: (r.blockLinks ?? r.block_links) === true,
    blockedTerms: terms,
    minAccountMinutes: int(r.minAccountMinutes ?? r.min_account_minutes, 0, 43200),
    shield: r.shield === true,
    emoteOnly: (r.emoteOnly ?? r.emote_only) === true,
  };
}

/** Připnutá zpráva nahoře v chatu (kopie - po smazání původní zprávy zůstane). */
export type ChatPinned = { id: number; uid: string; u: string; t: string; at: string };

export function readPinned(raw: unknown): ChatPinned | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isFinite(id) || typeof r.t !== 'string' || !r.t) return null;
  return {
    id,
    uid: typeof r.uid === 'string' ? r.uid : '',
    u: typeof r.u === 'string' ? r.u.slice(0, 40) : '',
    t: r.t.slice(0, 300),
    at: typeof r.at === 'string' ? r.at : new Date(0).toISOString(),
  };
}

/** Na porovnávání: malá písmena, bez diakritiky, číslice za podobná písmena (h4t3 -> hate). */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$]/g, (c) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's' })[c] ?? c)
    .replace(/[^a-zЀ-ӿ]+/g, ' ')
    .trim();
}

/** "h a t e" -> "hate": souvislé řady jednotlivých písmen se slepí (obcházení filtru mezerami). */
function collapseSpelledOut(normalized: string): string {
  const out: string[] = [];
  let run = '';
  for (const token of normalized.split(' ').filter(Boolean)) {
    if (token.length === 1) {
      run += token;
      continue;
    }
    if (run) out.push(run);
    run = '';
    out.push(token);
  }
  if (run) out.push(run);
  return ` ${out.join(' ')} `;
}

/**
 * Obsahuje zpráva zakázané slovo? Krátká slova (do 4 písmen) jen celá -
 * jinak by "ass" zablokovalo i "class". Delší i uvnitř slova (idiot ->
 * idioti). Obcházení diakritikou, velkými písmeny, číslicemi (1d10t) ani
 * mezerami mezi písmeny (i d i o t) nepomůže.
 */
export function matchBlockedTerm(text: string, terms: string[]): string | null {
  if (terms.length === 0) return null;
  const normalized = normalizeForMatch(text);
  const variants = [` ${normalized} `, collapseSpelledOut(normalized)];
  for (const term of terms) {
    const needle = normalizeForMatch(term);
    if (!needle) continue;
    for (const hay of variants) {
      if (hay.includes(` ${needle} `)) return term;
      if (needle.length >= 5 && hay.includes(needle)) return term;
    }
  }
  return null;
}

/** Odkaz ve zprávě: http(s)://, www., nebo doména typu neco.cz / neco.com/cesta. */
export function containsLink(text: string): boolean {
  if (/https?:\/\/|www\.|discord\.gg|t\.me\//i.test(text)) return true;
  return /\b[a-z0-9-]{2,63}\s?\.\s?(com|net|org|io|gg|tv|cz|sk|de|pl|ru|ua|xyz|me|co|app|link|ly|to|info|site|online|shop|live|fr|es|uk|eu)\b/i.test(text);
}

export type ChatRejection =
  | { code: 'banned' }
  | { code: 'timeout'; until: string }
  | { code: 'slow'; seconds: number }
  | { code: 'followers'; minutes: number }
  | { code: 'newAccount'; minutes: number }
  | { code: 'links' }
  | { code: 'blocked' }
  | { code: 'emoteOnly' };

/**
 * Smí tahle zpráva do chatu? null = ano. Kontroly v pořadí od nejlevnější
 * a nejdůležitější: zákaz, ztlumení, tempo, odběr, stáří účtu, jen emoty,
 * odkazy, zakázaná slova. Moderátoři (exempt) mají jen zákaz a ztlumení navíc - ty
 * na ně nikdo dát nemůže, takže prakticky nic.
 */
export function checkChatMessage(input: {
  text: string;
  settings: ChatSettings;
  exempt: boolean;
  now: number;
  /** Poslední zpráva tohohle člověka v tomhle chatu (ms), nebo null. */
  lastMessageAt: number | null;
  /** Odebírá kanál od (ms), nebo null = neodebírá. */
  followingSince: number | null;
  /** Účet založen (ms), nebo null = nevíme. */
  accountCreatedAt: number | null;
  /** Zákaz / ztlumení: until null = napořád. */
  ban: { until: number | null } | null;
  /** Je zpráva jen z emotů a emoji (lib/chatEmotes.ts - isEmoteOnlyMessage)? Pro režim "jen emoty". */
  emoteOnlyMessage?: boolean;
}): ChatRejection | null {
  const { settings: s, now } = input;
  if (input.ban) {
    if (input.ban.until === null) return { code: 'banned' };
    if (input.ban.until > now) return { code: 'timeout', until: new Date(input.ban.until).toISOString() };
  }
  if (input.exempt) return null;
  if (s.slowSeconds > 0 && input.lastMessageAt !== null) {
    const wait = Math.ceil((input.lastMessageAt + s.slowSeconds * 1000 - now) / 1000);
    if (wait > 0) return { code: 'slow', seconds: wait };
  }
  if (s.followersOnly) {
    if (input.followingSince === null || now - input.followingSince < s.followMinutes * 60000) return { code: 'followers', minutes: s.followMinutes };
  }
  if (s.minAccountMinutes > 0 && input.accountCreatedAt !== null && now - input.accountCreatedAt < s.minAccountMinutes * 60000) {
    return { code: 'newAccount', minutes: s.minAccountMinutes };
  }
  if (s.emoteOnly && !input.emoteOnlyMessage) return { code: 'emoteOnly' };
  if (s.blockLinks && containsLink(input.text)) return { code: 'links' };
  if (matchBlockedTerm(input.text, s.blockedTerms)) return { code: 'blocked' };
  return null;
}
