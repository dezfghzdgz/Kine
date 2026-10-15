'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { EMOJI_CATEGORIES, EMOJI_SHORTCODES, KINE_EMOTES, type ChatEmote, type EmojiCategoryId } from '@/lib/chatEmotes';
import type { DictKey } from '@/lib/i18n/cs';
import UiIcon from './UiIcon';

const RECENT_KEY = 'kine-chat-recent';
const RECENT_MAX = 24;

/** Naposledy použité emoty / emoji (v tomhle prohlížeči). */
function readRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(item: string): void {
  try {
    const next = [item, ...readRecent().filter((x) => x !== item)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // bez úložiště se jen nepamatuje
  }
}

const CATEGORY_LABEL: Record<EmojiCategoryId, DictKey> = {
  smileys: 'liveChatEmojiSmileys',
  people: 'liveChatEmojiPeople',
  hearts: 'liveChatEmojiHearts',
  gaming: 'liveChatEmojiGaming',
  animals: 'liveChatEmojiAnimals',
  food: 'liveChatEmojiFood',
  objects: 'liveChatEmojiObjects',
  flags: 'liveChatEmojiFlags',
};

/** Emoji -> anglický název (":fire:"), pro popisek a hledání. */
const EMOJI_NAME = new Map<string, string>();
for (const [name, emoji] of Object.entries(EMOJI_SHORTCODES)) if (!EMOJI_NAME.has(emoji)) EMOJI_NAME.set(emoji, name);

type Tab = 'recent' | 'kine' | 'channel' | EmojiCategoryId;

/**
 * Výběr emotů a emoji u chatu (jako na Twitchi / Kicku): naposledy použité,
 * emoty Kine, emoty kanálu, emoji po skupinách a hledání. Klik vloží do
 * zprávy; výběr zůstane otevřený (jde jich přidat víc), zavře ho Esc nebo
 * klik vedle.
 */
export default function ChatEmotePicker({
  channelEmotes,
  onPick,
  onClose,
}: {
  channelEmotes: ChatEmote[];
  onPick: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [recent, setRecent] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('kine');
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const list = readRecent();
    setRecent(list);
    if (list.length > 0) setTab('recent');
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      const box = boxRef.current;
      const target = e.target as HTMLElement | null;
      // Tlačítko, které výběr otevírá, si zavření řeší samo.
      if (box && target && !box.contains(target) && !target.closest('.chat-emote-toggle')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  const allEmotes = useMemo(() => [...KINE_EMOTES, ...channelEmotes], [channelEmotes]);
  const byCode = useMemo(() => new Map(allEmotes.map((e) => [e.code, e])), [allEmotes]);

  function pick(item: string) {
    rememberRecent(item);
    setRecent(readRecent());
    onPick(item);
  }

  const q = query.trim().toLowerCase().replace(/^:/, '');
  const results = useMemo(() => {
    if (!q) return null;
    const emotes = allEmotes.filter((e) => e.code.toLowerCase().includes(q));
    const seen = new Set<string>();
    const emoji: string[] = [];
    for (const [name, char] of Object.entries(EMOJI_SHORTCODES)) {
      if (name.includes(q) && !seen.has(char)) {
        seen.add(char);
        emoji.push(char);
      }
    }
    return { emotes, emoji };
  }, [q, allEmotes]);

  const renderItem = (item: string) => {
    const emote = byCode.get(item);
    if (emote) {
      return (
        <button key={`e:${item}`} type="button" className="chat-picker-item" onClick={() => pick(item)} title={item} aria-label={item}>
          <img src={emote.url} alt="" loading="lazy" decoding="async" draggable={false} />
        </button>
      );
    }
    const name = EMOJI_NAME.get(item);
    return (
      <button key={`j:${item}`} type="button" className="chat-picker-item emoji" onClick={() => pick(item)} title={name ? `:${name}:` : item} aria-label={name ?? item}>
        {item}
      </button>
    );
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    ...(recent.length ? [{ id: 'recent' as Tab, label: t('liveChatEmotesRecent'), icon: <UiIcon name="timer" size={16} /> }] : []),
    { id: 'kine', label: t('liveChatEmotesKine'), icon: <img src="/emotes/kinePlay.svg" alt="" /> },
    ...(channelEmotes.length ? [{ id: 'channel' as Tab, label: t('liveChatChannelEmotes'), icon: <img src={channelEmotes[0].url} alt="" /> }] : []),
    ...EMOJI_CATEGORIES.map((c) => ({ id: c.id as Tab, label: t(CATEGORY_LABEL[c.id]), icon: <span className="chat-picker-tab-emoji">{c.emoji[0]}</span> })),
  ];
  const active = tabs.some((x) => x.id === tab) ? tab : 'kine';
  let items: string[];
  if (active === 'recent') items = recent.filter((x) => byCode.has(x) || !/^[A-Za-z]/.test(x));
  else if (active === 'kine') items = KINE_EMOTES.map((e) => e.code);
  else if (active === 'channel') items = channelEmotes.map((e) => e.code);
  else items = EMOJI_CATEGORIES.find((c) => c.id === active)?.emoji ?? [];

  return (
    <div ref={boxRef} className="chat-picker" role="dialog" aria-label={t('liveChatEmotePicker')}>
      <input
        ref={searchRef}
        type="search"
        className="chat-picker-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('liveChatEmoteSearch')}
        aria-label={t('liveChatEmoteSearch')}
      />
      {!results && (
        <div className="chat-picker-tabs" role="tablist">
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={active === x.id} className={`chat-picker-tab ${active === x.id ? 'active' : ''}`} onClick={() => setTab(x.id)} title={x.label} aria-label={x.label}>
              {x.icon}
            </button>
          ))}
        </div>
      )}
      <div className="chat-picker-grid-wrap">
        {results ? (
          results.emotes.length + results.emoji.length === 0 ? (
            <p className="chat-picker-empty">{t('liveChatEmoteNone')}</p>
          ) : (
            <div className="chat-picker-grid">
              {results.emotes.map((e) => renderItem(e.code))}
              {results.emoji.map((e) => renderItem(e))}
            </div>
          )
        ) : (
          <>
            <p className="chat-picker-heading">{tabs.find((x) => x.id === active)?.label}</p>
            <div className={`chat-picker-grid ${active === 'kine' || active === 'channel' ? 'emotes' : ''}`}>{items.map((item) => renderItem(item))}</div>
          </>
        )}
      </div>
    </div>
  );
}
