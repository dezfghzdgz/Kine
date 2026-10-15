/**
 * Emoty, emoji a další věci do chatu (jako na Twitchi a Kicku) - čistá
 * logika bez Reactu a databáze (tests/chatEmotes.test.mjs).
 *
 * Emote = obrázek, který se do zprávy píše kódem: celé slovo "kineHype"
 * (nebo ":kineHype:"). Kódy rozlišují velká a malá písmena (jako na
 * Twitchi), takže běžné slovo se omylem obrázkem nestane. Dva druhy:
 *   - emoty Kine (vlastní kresba, public/emotes/) - fungují v každém chatu,
 *   - emoty kanálu - nahraje si je tvůrce (tabulka channel_emotes) a jdou
 *     v chatu jeho kanálu (přenos i premiéry).
 * Emoji jsou obyčejné znaky Unicode; ":fire:" se při odeslání změní na 🔥.
 */

export type ChatEmote = {
  code: string;
  url: string;
  /** Emote kanálu (ne Kine). */
  channel?: boolean;
  animated?: boolean;
  /** Id v tabulce channel_emotes (jen emoty kanálu). */
  id?: string;
};

/** Emoty Kine - soubory public/emotes/<kód>.svg. */
export const KINE_EMOTE_CODES = [
  'kineHi',
  'kineLol',
  'kineRofl',
  'kineWow',
  'kineHype',
  'kineLove',
  'kineCool',
  'kineGG',
  'kineW',
  'kineL',
  'kineF',
  'kineFire',
  'kineHeart',
  'kineClap',
  'kineCrown',
  'kineSad',
  'kineCry',
  'kineRage',
  'kineThink',
  'kineSus',
  'kineSweat',
  'kineFacepalm',
  'kineSleep',
  'kineDead',
  'kineSkull',
  'kinePlay',
] as const;

export const KINE_EMOTES: ChatEmote[] = KINE_EMOTE_CODES.map((code) => ({ code, url: `/emotes/${code}.svg` }));

/** Kód emotu kanálu: písmeno na začátku, pak písmena, číslice a podtržítko, 2-24 znaků. */
export const EMOTE_CODE_RE = /^[A-Za-z][A-Za-z0-9_]{1,23}$/;
/** Kolik emotů může mít jeden kanál. */
export const MAX_CHANNEL_EMOTES = 50;
/** Největší soubor emotu (animovaný GIF / WebP se nezmenšuje). */
export const EMOTE_MAX_BYTES = 512 * 1024;
/** Na tuhle velikost (px) se statický emote před nahráním zmenší. */
export const EMOTE_SIZE = 112;

/** Platný a volný kód emotu kanálu (nesmí se plést s emoty Kine). */
export function validChannelEmoteCode(code: string): boolean {
  if (!EMOTE_CODE_RE.test(code)) return false;
  const lower = code.toLowerCase();
  return !KINE_EMOTE_CODES.some((c) => c.toLowerCase() === lower);
}

/** Emoty Kine + kanálu do mapy podle kódu (kanál nepřepíše Kine). */
export function emoteMap(channel: ChatEmote[] = []): Map<string, ChatEmote> {
  const map = new Map<string, ChatEmote>();
  for (const e of channel) if (EMOTE_CODE_RE.test(e.code)) map.set(e.code, { ...e, channel: true });
  for (const e of KINE_EMOTES) map.set(e.code, e);
  return map;
}

// ---- emoji -------------------------------------------------------------------------------

/** ":fire:" -> 🔥 (anglické názvy jako na Discordu + pár českých). */
export const EMOJI_SHORTCODES: Record<string, string> = {
  smile: '😄',
  grin: '😁',
  joy: '😂',
  rofl: '🤣',
  sweat_smile: '😅',
  laughing: '😆',
  wink: '😉',
  blush: '😊',
  innocent: '😇',
  heart_eyes: '😍',
  star_struck: '🤩',
  kiss: '😘',
  yum: '😋',
  tongue: '😛',
  crazy: '🤪',
  money_mouth: '🤑',
  hug: '🤗',
  shush: '🤫',
  thinking: '🤔',
  neutral: '😐',
  expressionless: '😑',
  smirk: '😏',
  unamused: '😒',
  eyeroll: '🙄',
  grimace: '😬',
  relieved: '😌',
  pensive: '😔',
  drool: '🤤',
  sleeping: '😴',
  mask: '😷',
  sick: '🤢',
  vomit: '🤮',
  hot: '🥵',
  cold: '🥶',
  dizzy: '😵',
  mindblown: '🤯',
  cowboy: '🤠',
  party: '🥳',
  sunglasses: '😎',
  cool: '😎',
  nerd: '🤓',
  monocle: '🧐',
  confused: '😕',
  worried: '😟',
  frown: '🙁',
  open_mouth: '😮',
  astonished: '😲',
  flushed: '😳',
  pleading: '🥺',
  fearful: '😨',
  cold_sweat: '😰',
  cry: '😢',
  sob: '😭',
  scream: '😱',
  tired: '😫',
  yawn: '🥱',
  triumph: '😤',
  rage: '😡',
  angry: '😠',
  cursing: '🤬',
  devil: '😈',
  skull: '💀',
  poop: '💩',
  clown: '🤡',
  ghost: '👻',
  alien: '👽',
  robot: '🤖',
  wave: '👋',
  ok: '👌',
  pinch: '🤏',
  v: '✌️',
  crossed_fingers: '🤞',
  metal: '🤘',
  call_me: '🤙',
  point_left: '👈',
  point_right: '👉',
  point_up: '👆',
  point_down: '👇',
  thumbsup: '👍',
  '+1': '👍',
  thumbsdown: '👎',
  '-1': '👎',
  fist: '👊',
  clap: '👏',
  raised_hands: '🙌',
  pray: '🙏',
  muscle: '💪',
  eyes: '👀',
  brain: '🧠',
  heart: '❤️',
  orange_heart: '🧡',
  yellow_heart: '💛',
  green_heart: '💚',
  blue_heart: '💙',
  purple_heart: '💜',
  black_heart: '🖤',
  white_heart: '🤍',
  broken_heart: '💔',
  sparkling_heart: '💖',
  '100': '💯',
  boom: '💥',
  sparkles: '✨',
  star: '⭐',
  fire: '🔥',
  zap: '⚡',
  tada: '🎉',
  confetti: '🎊',
  trophy: '🏆',
  medal: '🥇',
  goat: '🐐',
  dart: '🎯',
  video_game: '🎮',
  joystick: '🕹️',
  game_die: '🎲',
  crown: '👑',
  gem: '💎',
  moneybag: '💰',
  rocket: '🚀',
  popcorn: '🍿',
  pizza: '🍕',
  beer: '🍺',
  coffee: '☕',
  cake: '🎂',
  gift: '🎁',
  rainbow: '🌈',
  sun: '☀️',
  moon: '🌙',
  snowflake: '❄️',
  ocean: '🌊',
  dog: '🐶',
  cat: '🐱',
  frog: '🐸',
  see_no_evil: '🙈',
  hear_no_evil: '🙉',
  speak_no_evil: '🙊',
  unicorn: '🦄',
  snake: '🐍',
  sloth: '🦥',
  sweat_drops: '💦',
  zzz: '💤',
  speech: '💬',
  warning: '⚠️',
  check: '✅',
  x: '❌',
  question: '❓',
  exclamation: '❗',
  // Česky
  srdce: '❤️',
  ohen: '🔥',
  smich: '😂',
  palec: '👍',
  potlesk: '👏',
  lebka: '💀',
  pohar: '🏆',
  koruna: '👑',
  raketa: '🚀',
  pivo: '🍺',
};

export type EmojiCategoryId = 'smileys' | 'people' | 'hearts' | 'gaming' | 'animals' | 'food' | 'objects' | 'flags';

/**
 * Znaky, které mají i textovou podobu (☀, ❤, ✌…), dostanou značku "jako
 * emoji" (U+FE0F) - jinak by se někde ukázaly černobíle.
 */
function emojiList(chars: string): string[] {
  return Array.from(chars).map((c) => (/\p{Emoji_Presentation}/u.test(c) ? c : `${c}\uFE0F`));
}

/** Emoji ve výběru po skupinách (první znak = ikona záložky). */
export const EMOJI_CATEGORIES: { id: EmojiCategoryId; emoji: string[] }[] = [
  {
    id: 'smileys',
    emoji: emojiList('😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀💩🤡👹👺👻👽👾🤖'),
  },
  {
    id: 'people',
    emoji: emojiList('👋🤚🖐✋🖖👌🤌🤏✌🤞🤟🤘🤙👈👉👆👇☝👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏💪🦾👀🧠🗣👤👥🧑👶🧒👦👧👨👩🧔👴👵🙋🙅🙆🤷🤦🙇💁🕺💃🧙🧛🧟🦸🦹'),
  },
  {
    id: 'hearts',
    emoji: emojiList('❤🧡💛💚💙💜🖤🤍🤎💔💕💞💓💗💖💘💝💟💯💢💥💫💦💨💬💭💤✨⭐🌟⚡🔥🎉🎊🎈✅❌❗❓⚠🆗🆒🆕🔝'),
  },
  {
    id: 'gaming',
    emoji: emojiList('🎮🕹👾🎲♟🎯🏆🥇🥈🥉🏅🎖⚽🏀🏈⚾🎾🏐🏉🎱🏓🏸🥊🥋⛳🏁🚩🎳🛹🏹🗡⚔🛡💣🧨💎👑💰🎰🃏🀄🧩🪀🎧🎤📺💻⌨🖱🖥'),
  },
  {
    id: 'animals',
    emoji: emojiList('🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐢🐍🦖🦕🐙🦑🦀🐠🐬🐳🦈🐊🦥🐐🐀🌵🌲🌴🍀🍁🌸🌹🌻🌈☀🌙🌍☁❄🌊'),
  },
  {
    id: 'food',
    emoji: emojiList('🍎🍊🍋🍌🍉🍇🍓🍒🍑🥭🍍🥥🥝🍅🥑🍆🥔🥕🌽🌶🥒🥦🧄🍄🥜🍞🥐🥖🧀🥚🍳🥓🥩🍗🍖🌭🍔🍟🍕🥪🌮🌯🥗🍝🍜🍣🍤🍙🍦🍩🍪🎂🍰🧁🍫🍬🍭🍿☕🍵🥤🍺🍻🥂🍷🥃'),
  },
  {
    id: 'objects',
    emoji: emojiList('🚗🏎🚓🚑🚒🚀✈🚁⛵🚂🏠🏰🗽🎡🎢⏰⌛📱📷📸🎬📢🔔🔊💡🔦📚✏📌📎🔑🔒🧲🧪💊🎁🧸🔮💸💵📈📉🗓📝🎵🎶'),
  },
  {
    id: 'flags',
    // Vlajky jsou dvojice znaků (a pár sekvencí) - proto výčet, ne rozdělení po znacích.
    emoji: ['🇨🇿', '🇸🇰', '🇩🇪', '🇦🇹', '🇵🇱', '🇺🇦', '🇬🇧', '🇺🇸', '🇫🇷', '🇪🇸', '🇮🇹', '🇭🇺', '🇳🇱', '🇧🇪', '🇨🇭', '🇸🇪', '🇳🇴', '🇩🇰', '🇫🇮', '🇵🇹', '🇧🇷', '🇨🇦', '🇯🇵', '🇰🇷', '🏁', '🚩', '🏳\uFE0F', '🏴', '🏴\u200D\u2620\uFE0F', '🏳\uFE0F\u200D🌈'],
  },
];

const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const EMOJI_JOINERS = /[\s\u200D\uFE0F\uFE0E\u20E3\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic}|\p{Regional_Indicator}/gu;

/** Je to jen emoji (a mezery)? "🔥🔥" ano, "gg 🔥" ne, "123" ne. */
export function isEmojiOnly(text: string): boolean {
  if (!PICTO.test(text)) return false;
  return text.replace(EMOJI_JOINERS, '') === '';
}

// ---- zprávy na kousky (emoty, zmínky, odkazy) -----------------------------------------------

export type ChatToken =
  | { kind: 'text'; text: string }
  | { kind: 'emote'; code: string; url: string; animated?: boolean }
  | { kind: 'mention'; name: string; self: boolean }
  | { kind: 'link'; href: string; text: string };

const MENTION_RE = /^@([\p{L}\p{N}_.-]{2,30}?)([.,!?:;)]*)$/u;
const LINK_RE = /^(https?:\/\/[^\s<>"']{2,300}|www\.[^\s<>"']{2,300})$/i;
const COLON_CODE_RE = /^:([A-Za-z0-9_]{2,24}):$/;

/** Odkaz bez interpunkce na konci ("viz www.kine.cz." -> odkaz bez tečky). */
function splitLink(word: string): { link: string; rest: string } | null {
  const m = /^(.*?)([.,!?:;)\]]*)$/.exec(word);
  const core = m ? m[1] : word;
  if (!LINK_RE.test(core)) return null;
  return { link: core, rest: m ? m[2] : '' };
}

/**
 * Zpráva na kousky pro vykreslení: emote (podle kódu), @zmínka (self =
 * zmiňuje mě), odkaz (jen http/https) a text. Mezery zůstanou v textu.
 */
export function tokenizeChat(body: string, emotes: ReadonlyMap<string, ChatEmote>, me?: string | null): ChatToken[] {
  const out: ChatToken[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === 'text') last.text += text;
    else out.push({ kind: 'text', text });
  };
  const myName = me ? me.toLowerCase() : null;
  for (const part of body.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      pushText(part);
      continue;
    }
    const emote = emotes.get(part) ?? (COLON_CODE_RE.test(part) ? emotes.get(part.slice(1, -1)) : undefined);
    if (emote) {
      out.push({ kind: 'emote', code: emote.code, url: emote.url, ...(emote.animated ? { animated: true } : {}) });
      continue;
    }
    if (part.startsWith('@')) {
      const m = MENTION_RE.exec(part);
      if (m) {
        out.push({ kind: 'mention', name: m[1], self: !!myName && m[1].toLowerCase() === myName });
        pushText(m[2]);
        continue;
      }
    }
    const link = splitLink(part);
    if (link) {
      out.push({ kind: 'link', href: /^https?:\/\//i.test(link.link) ? link.link : `https://${link.link}`, text: link.link });
      pushText(link.rest);
      continue;
    }
    pushText(part);
  }
  return out;
}

/** Zmiňuje zpráva tohohle člověka (@jméno, bez ohledu na velikost písmen)? */
export function mentions(body: string, username: string | null | undefined): boolean {
  if (!username) return false;
  const name = username.toLowerCase();
  return body.split(/\s+/).some((w) => {
    const m = MENTION_RE.exec(w);
    return !!m && m[1].toLowerCase() === name;
  });
}

/** Jen emoty a emoji (bez slov)? Takové zprávy jsou v chatu větší - a jen ty projdou režimem "jen emoty". */
export function isEmoteOnlyMessage(body: string, emotes: ReadonlyMap<string, ChatEmote>): boolean {
  const words = body.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.every((w) => emotes.has(w) || (COLON_CODE_RE.test(w) && emotes.has(w.slice(1, -1))) || isEmojiOnly(w));
}

/**
 * Před odesláním: ":fire:" -> 🔥 a ":kineHype:" -> kineHype (kód emotu se
 * ukládá jako slovo). Neznámé :něco: zůstane, jak je.
 */
export function normalizeOutgoing(body: string, emotes: ReadonlyMap<string, ChatEmote>): string {
  return body.replace(/:([A-Za-z0-9_+-]{1,32}):/g, (whole, name: string) => {
    if (emotes.has(name)) return name;
    const emoji = EMOJI_SHORTCODES[name] ?? EMOJI_SHORTCODES[name.toLowerCase()];
    return emoji ?? whole;
  });
}

// ---- našeptávání ------------------------------------------------------------------------------

export type Suggestion = { kind: 'emote'; code: string; url: string } | { kind: 'emoji'; name: string; emoji: string } | { kind: 'user'; name: string };

/** Co je rozepsané u kurzoru: "@pe" (jméno) nebo ":fi" (emote / emoji, aspoň 2 znaky). */
export function draftQuery(draft: string, caret: number): { kind: 'user' | 'emote'; query: string; start: number } | null {
  const before = draft.slice(0, caret);
  const m = /(^|\s)([@:])([\p{L}\p{N}_.+-]*)$/u.exec(before);
  if (!m) return null;
  const start = before.length - m[2].length - m[3].length;
  if (m[2] === '@') return { kind: 'user', query: m[3], start };
  if (m[3].length < 2) return null;
  return { kind: 'emote', query: m[3], start };
}

/** Emoty a emoji k ":dotazu" - nejdřív ty, co dotazem začínají. */
export function emoteSuggestions(query: string, emotes: ChatEmote[], limit = 8): Suggestion[] {
  const q = query.toLowerCase();
  const score = (name: string) => {
    const n = name.toLowerCase();
    if (n.startsWith(q)) return 0;
    // "hype" najde kineHype (část kódu za předponou)
    if (n.includes(q)) return 1;
    return -1;
  };
  const list: { s: number; item: Suggestion }[] = [];
  for (const e of emotes) {
    const s = score(e.code);
    if (s >= 0) list.push({ s, item: { kind: 'emote', code: e.code, url: e.url } });
  }
  const seen = new Set<string>();
  for (const [name, emoji] of Object.entries(EMOJI_SHORTCODES)) {
    const s = score(name);
    if (s < 0 || seen.has(emoji)) continue;
    seen.add(emoji);
    list.push({ s: s + 0.5, item: { kind: 'emoji', name, emoji } });
  }
  return list
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((x) => x.item);
}

/** Jména k "@dotazu" (z lidí, co v chatu nedávno psali - nejnovější první). */
export function userSuggestions(query: string, names: string[], limit = 6): Suggestion[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key) || !key.startsWith(q)) continue;
    seen.add(key);
    out.push({ kind: 'user', name });
    if (out.length >= limit) break;
  }
  return out;
}

/** Nahradí rozepsaný dotaz vybraným návrhem (+ mezera). Vrací nový text a pozici kurzoru. */
export function applySuggestion(draft: string, caret: number, start: number, s: Suggestion): { text: string; caret: number } {
  const insert = s.kind === 'user' ? `@${s.name} ` : s.kind === 'emote' ? `${s.code} ` : `${s.emoji} `;
  const after = draft.slice(caret).replace(/^\S*/, '');
  const text = draft.slice(0, start) + insert + after.replace(/^\s/, '');
  return { text, caret: start + insert.length };
}

// ---- barvy jmen ---------------------------------------------------------------------------------

/** Barvy, ze kterých si člověk vybere barvu jména (a ze kterých se bere výchozí). */
export const CHAT_COLORS = [
  '#ff6b6b',
  '#ff9f43',
  '#feca57',
  '#a3e635',
  '#2ed573',
  '#1dd1a1',
  '#22d3ee',
  '#54a0ff',
  '#818cf8',
  '#a55eea',
  '#f368e0',
  '#ff9ff3',
];

export function validChatColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/** Výchozí barva jména podle id (každý má pořád stejnou, sousedi se liší). */
export function chatNameColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return CHAT_COLORS[h % CHAT_COLORS.length];
}

// ---- údaje u zprávy (odznaky, barva, odpověď) ---------------------------------------------------

export type ChatBadge = 'broadcaster' | 'moderator' | 'staff' | 'verified' | 'follower';
export const CHAT_BADGES: readonly ChatBadge[] = ['broadcaster', 'staff', 'moderator', 'verified', 'follower'];

/**
 * Co server ke zprávě uloží (sloupec meta): odznaky, barva jména, /me,
 * první zpráva v chatu kanálu, jak dlouho odebírá (měsíce) a na co
 * odpovídá (kopie - po smazání původní zprávy zůstane čitelná).
 */
export type ChatMeta = {
  b?: ChatBadge[];
  c?: string;
  me?: boolean;
  first?: boolean;
  fm?: number;
  r?: { id: number; uid: string; u: string; t: string };
};

/** Bezpečné čtení meta z databáze (cokoli divného se zahodí). */
export function readChatMeta(raw: unknown): ChatMeta {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: ChatMeta = {};
  if (Array.isArray(r.b)) {
    const b = r.b.filter((x): x is ChatBadge => typeof x === 'string' && (CHAT_BADGES as readonly string[]).includes(x));
    if (b.length) out.b = Array.from(new Set(b));
  }
  if (validChatColor(r.c)) out.c = r.c;
  if (r.me === true) out.me = true;
  if (r.first === true) out.first = true;
  if (typeof r.fm === 'number' && Number.isFinite(r.fm) && r.fm >= 0) out.fm = Math.min(600, Math.floor(r.fm));
  const reply = r.r as Record<string, unknown> | undefined;
  if (reply && typeof reply === 'object' && Number.isFinite(Number(reply.id)) && typeof reply.u === 'string') {
    out.r = { id: Number(reply.id), uid: typeof reply.uid === 'string' ? reply.uid : '', u: reply.u.slice(0, 40), t: typeof reply.t === 'string' ? reply.t.slice(0, 120) : '' };
  }
  return out;
}

/** Odznak odběratele podle délky odběru (měsíce): 0, 1, 3, 6, 12, 24. */
export function followTier(months: number | undefined): 0 | 1 | 3 | 6 | 12 | 24 {
  const m = Math.max(0, Math.floor(months ?? 0));
  if (m >= 24) return 24;
  if (m >= 12) return 12;
  if (m >= 6) return 6;
  if (m >= 3) return 3;
  if (m >= 1) return 1;
  return 0;
}

// ---- příkazy (/me, /ban…) ----------------------------------------------------------------------------

export type ChatCommand =
  | { cmd: 'me'; text: string }
  | { cmd: 'ban' | 'unban'; user: string }
  | { cmd: 'timeout'; user: string; minutes: number }
  | { cmd: 'slow'; seconds: number }
  | { cmd: 'followers'; minutes: number | null }
  | { cmd: 'emoteonly'; on: boolean | null }
  | { cmd: 'unpin' }
  | { cmd: 'color'; color: string | null }
  | { cmd: 'help' }
  | { cmd: 'unknown'; name: string }
  | { cmd: 'invalid'; name: string };

const TIMEOUTS = [1, 10, 60, 1440];

/** Délka "10m", "1h", "1d", "30" (min) -> minuty. */
function parseMinutes(value: string | undefined, fallback: number): number | null {
  if (!value) return fallback;
  const m = /^(\d{1,5})\s*(s|m|min|h|d)?$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'm').toLowerCase();
  if (unit === 's') return Math.max(1, Math.round(n / 60));
  if (unit === 'h') return n * 60;
  if (unit === 'd') return n * 1440;
  return n;
}

/**
 * Příkaz v chatu ("/timeout petr 10m"), nebo null = obyčejná zpráva.
 * "//text" pošle text začínající lomítkem.
 */
export function parseChatCommand(input: string): ChatCommand | null {
  const text = input.trim();
  if (!text.startsWith('/') || text.startsWith('//')) return null;
  const [rawName, ...args] = text.slice(1).split(/\s+/);
  const name = (rawName ?? '').toLowerCase();
  const user = (args[0] ?? '').replace(/^@/, '');
  switch (name) {
    case 'me':
      return args.length ? { cmd: 'me', text: text.slice(3).trim() } : { cmd: 'invalid', name };
    case 'ban':
    case 'unban':
      return user ? { cmd: name, user } : { cmd: 'invalid', name };
    case 'timeout':
    case 'mute': {
      if (!user) return { cmd: 'invalid', name };
      const minutes = parseMinutes(args[1], 10);
      if (minutes === null) return { cmd: 'invalid', name };
      // Na nejbližší povolenou délku nahoru (1 min, 10 min, 1 h, 1 den): "5m" = 10 minut.
      const snapped = TIMEOUTS.find((x) => x >= minutes) ?? TIMEOUTS[TIMEOUTS.length - 1];
      return { cmd: 'timeout', user, minutes: snapped };
    }
    case 'slow':
    case 'slowoff': {
      if (name === 'slowoff' || args[0] === 'off' || args[0] === '0') return { cmd: 'slow', seconds: 0 };
      const n = args[0] ? Number(args[0].replace(/s$/i, '')) : 30;
      return Number.isFinite(n) && n >= 0 && n <= 600 ? { cmd: 'slow', seconds: Math.round(n) } : { cmd: 'invalid', name };
    }
    case 'followers':
    case 'followersoff': {
      if (name === 'followersoff' || args[0] === 'off') return { cmd: 'followers', minutes: null };
      const minutes = parseMinutes(args[0], 0);
      return minutes === null ? { cmd: 'invalid', name } : { cmd: 'followers', minutes };
    }
    case 'emoteonly':
    case 'emoteonlyoff':
      return { cmd: 'emoteonly', on: name === 'emoteonlyoff' || args[0] === 'off' ? false : args[0] === 'on' ? true : null };
    case 'unpin':
      return { cmd: 'unpin' };
    case 'color':
    case 'colour': {
      if (!args[0] || args[0] === 'off' || args[0] === 'reset') return { cmd: 'color', color: null };
      const c = args[0].startsWith('#') ? args[0] : `#${args[0]}`;
      return validChatColor(c) ? { cmd: 'color', color: c.toLowerCase() } : { cmd: 'invalid', name };
    }
    case 'help':
    case 'commands':
      return { cmd: 'help' };
    default:
      return { cmd: 'unknown', name };
  }
}
