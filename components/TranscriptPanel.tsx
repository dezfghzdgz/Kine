'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import type { Caption } from '@/lib/captions';
import { activeCaptionIndex, filterTranscript, formatCueTime } from '@/lib/transcript';
import UiIcon from './UiIcon';

/**
 * Přepis videa (z titulků): každý řádek s časem, klik = skok na to místo,
 * hledání v textu, právě mluvený řádek zvýrazněný a podle něj se seznam
 * sám posouvá (dokud ho člověk nescrolluje sám). Jako "Zobrazit přepis"
 * na YouTube.
 */
export default function TranscriptPanel({
  captions,
  onSeek,
  getCurrentTime,
}: {
  captions: Caption[];
  onSeek?: (seconds: number) => void;
  getCurrentTime?: () => number;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  // Člověk sám scrolluje seznamem - pár vteřin ho nepřetahovat zpátky.
  const manualUntil = useRef(0);
  // Seřazené podle času a bez prázdných řádků (starší ručně psané titulky můžou být přeházené).
  const cues = useMemo(
    () =>
      (Array.isArray(captions) ? captions : [])
        .filter((c) => c && Number.isFinite(Number(c.time)) && typeof c.text === 'string' && c.text.trim())
        .sort((a, b) => a.time - b.time),
    [captions]
  );
  const shown = useMemo(() => filterTranscript(cues, query), [cues, query]);

  useEffect(() => {
    if (!getCurrentTime) return;
    const timer = setInterval(() => {
      // Skrytá karta - nepočítat zbytečně.
      if (document.hidden) return;
      const now = Number(getCurrentTime()) || 0;
      setActive(activeCaptionIndex(cues, now));
    }, 500);
    return () => clearInterval(timer);
  }, [cues, getCurrentTime]);

  useEffect(() => {
    if (active < 0 || query || Date.now() < manualUntil.current) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-cue="${active}"]`);
    if (!list || !row) return;
    const top = row.offsetTop - list.clientHeight / 3;
    list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [active, query]);

  return (
    <div className="transcript">
      <label className="transcript-search">
        <UiIcon name="search" size={15} />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('transcriptSearch')} aria-label={t('transcriptSearch')} />
      </label>
      <div
        ref={listRef}
        className="transcript-list"
        onWheel={() => (manualUntil.current = Date.now() + 4000)}
        onTouchMove={() => (manualUntil.current = Date.now() + 4000)}
      >
        {shown.length === 0 && <p className="transcript-empty">{t('transcriptNoMatch')}</p>}
        {shown.map(({ cue, index }) => (
          <button
            key={index}
            type="button"
            data-cue={index}
            className={`transcript-row${index === active ? ' active' : ''}`}
            onClick={() => onSeek?.(cue.time)}
          >
            <span className="transcript-time">{formatCueTime(cue.time)}</span>
            <span className="transcript-text">{cue.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
