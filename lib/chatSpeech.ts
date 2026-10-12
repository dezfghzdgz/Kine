/**
 * Čtení chatu nahlas (jako "TTS" u Streamlabs / StreamElements): podpory,
 * nebo všechny nové zprávy, hlasem z prohlížeče (Web Speech API - nic se
 * nikam neposílá). Zapíná se v chatu ikonkou 🔊 a pamatuje si to jen
 * tohle zařízení; průhledný chat pro OBS bere ?tts=tips / ?tts=all.
 *
 * Text ke čtení skládá čistá funkce speechText (tests/chatSpeech.test.mjs):
 * odkazy se nečtou, opakované znaky a emoji spam se zkrátí, dlouhé zprávy
 * se uříznou - aby nikdo nemohl zahltit stream minutovým čtením.
 */

export type TtsMode = 'off' | 'tips' | 'all';
export const TTS_MODES: readonly TtsMode[] = ['off', 'tips', 'all'];
export const TTS_KEY = 'kine-chat-tts';
/** Nejdelší čtený vzkaz (znaky). */
export const TTS_MAX_CHARS = 180;
/** Ve frontě nejvýš tolik zpráv - při rychlém chatu se starší přeskočí. */
export const TTS_QUEUE_MAX = 4;

export function parseTtsMode(value: unknown): TtsMode {
  return value === 'tips' || value === 'all' ? value : 'off';
}

export function readTtsMode(): TtsMode {
  try {
    return parseTtsMode(window.localStorage.getItem(TTS_KEY));
  } catch {
    return 'off';
  }
}

export function saveTtsMode(mode: TtsMode): void {
  try {
    window.localStorage.setItem(TTS_KEY, mode);
  } catch {
    // bez úložiště jen pro tuhle návštěvu
  }
}

/** Jazyk hlasu podle jazyka webu. */
export const SPEECH_LANGS: Record<string, string> = {
  cs: 'cs-CZ',
  sk: 'sk-SK',
  en: 'en-US',
  de: 'de-DE',
  pl: 'pl-PL',
  es: 'es-ES',
  fr: 'fr-FR',
  uk: 'uk-UA',
};

/**
 * Vyčistí zprávu pro čtení: odkazy -> slovo "odkaz" (v jazyce webu),
 * víc než 3 stejné znaky za sebou -> 3, víc než 3 emoji -> 3, zbytečné
 * mezery pryč, nejvýš TTS_MAX_CHARS znaků. Prázdný výsledek = nic nečíst.
 */
export function cleanForSpeech(text: string, linkWord = 'link'): string {
  let s = String(text ?? '');
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ` ${linkWord} `);
  s = s.replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|cz|sk|eu|io|gg|tv|me|ru|de|uk|info|xyz|ly)\b\S*/gi, ` ${linkWord} `);
  // Opakované znaky ("aaaaaaa", "!!!!!!!") a opakovaná slova ("lol lol lol lol").
  s = s.replace(/(.)\1{3,}/gu, '$1$1$1');
  s = s.replace(/\b(\S+)(?:\s+\1\b){3,}/giu, '$1 $1 $1');
  // Emoji spam: po třech dalších nic.
  let emoji = 0;
  s = s.replace(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu, (m) => (++emoji <= 3 ? m : ''));
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > TTS_MAX_CHARS) {
    const cut = s.slice(0, TTS_MAX_CHARS);
    const space = cut.lastIndexOf(' ');
    s = (space > TTS_MAX_CHARS * 0.6 ? cut.slice(0, space) : cut).trim() + '…';
  }
  return s;
}

export type SpeechMessage = {
  kind?: string | null;
  name: string;
  body: string;
  /** Jen u podpory: částka už naformátovaná ("100 Kč"). */
  amount?: string | null;
};

export type SpeechTemplates = {
  /** "{name} posílá {amount}: {message}" */
  tip: string;
  /** "{name} posílá {amount}" - podpora bez vzkazu. */
  tipNoMessage: string;
  /** "{name}: {message}" */
  chat: string;
  /** Slovo místo odkazu. */
  link: string;
};

/** Text, který se přečte, nebo null (prázdná zpráva, v režimu "jen podpory" běžná zpráva...). */
export function speechText(message: SpeechMessage, mode: TtsMode, templates: SpeechTemplates): string | null {
  if (mode === 'off') return null;
  const isTip = message.kind === 'tip';
  if (mode === 'tips' && !isTip) return null;
  const name = cleanForSpeech(message.name, templates.link).slice(0, 40) || '?';
  const body = cleanForSpeech(message.body, templates.link);
  // Podpora bez vzkazu má v chatu jen srdíčko - to se nečte.
  const meaningful = body.replace(/[\p{Extended_Pictographic}️‍\s]/gu, '').length > 0;
  if (isTip) {
    const amount = message.amount ?? '';
    return (meaningful ? templates.tip : templates.tipNoMessage)
      .replace('{name}', name)
      .replace('{amount}', amount)
      .replace('{message}', body);
  }
  if (!meaningful) return null;
  return templates.chat.replace('{name}', name).replace('{message}', body);
}

/**
 * Předčítač v prohlížeči: fronta (nejvýš TTS_QUEUE_MAX, starší se zahodí),
 * jedna zpráva po druhé, "přeskočit" ukončí tu, co se zrovna čte.
 */
export class ChatSpeaker {
  private queue: string[] = [];
  private speaking = false;
  private lang: string;

  constructor(lang: string) {
    this.lang = SPEECH_LANGS[lang] ?? 'en-US';
  }

  static supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  }

  setLang(lang: string): void {
    this.lang = SPEECH_LANGS[lang] ?? 'en-US';
  }

  say(text: string): void {
    if (!ChatSpeaker.supported() || !text) return;
    this.queue.push(text);
    while (this.queue.length > TTS_QUEUE_MAX) this.queue.shift();
    this.next();
  }

  skip(): void {
    if (!ChatSpeaker.supported()) return;
    window.speechSynthesis.cancel();
    this.speaking = false;
    this.next();
  }

  stop(): void {
    this.queue = [];
    this.speaking = false;
    if (ChatSpeaker.supported()) window.speechSynthesis.cancel();
  }

  private next(): void {
    if (this.speaking) return;
    const text = this.queue.shift();
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.lang;
    const voices = window.speechSynthesis.getVoices();
    const base = this.lang.slice(0, 2);
    const voice = voices.find((v) => v.lang === this.lang) ?? voices.find((v) => v.lang?.slice(0, 2) === base);
    if (voice) utterance.voice = voice;
    utterance.rate = 1.02;
    const done = () => {
      this.speaking = false;
      this.next();
    };
    utterance.onend = done;
    utterance.onerror = done;
    this.speaking = true;
    window.speechSynthesis.speak(utterance);
  }
}
