'use client';

import { useEffect, useState } from 'react';
import { captionAt, type Caption } from '@/lib/captions';

/** Velikost titulků (nabídka ⋮ přehrávače -> Titulky -> velikost); pamatuje se v prohlížeči. */
export type CaptionSize = 's' | 'm' | 'l';
export const CAPTION_SIZE_KEY = 'kine-caption-size';
export const CAPTION_SIZE_EVENT = 'kine-caption-size';

export function readCaptionSize(): CaptionSize {
  try {
    const v = localStorage.getItem(CAPTION_SIZE_KEY);
    return v === 's' || v === 'l' ? v : 'm';
  } catch {
    return 'm';
  }
}

export function saveCaptionSize(size: CaptionSize): void {
  try {
    localStorage.setItem(CAPTION_SIZE_KEY, size);
  } catch {
    // soukromé okno apod. - platí jen do obnovení stránky
  }
  window.dispatchEvent(new CustomEvent(CAPTION_SIZE_EVENT, { detail: size }));
}

/**
 * Titulky přes video. Řádek s koncem (import .srt/.vtt, automatické
 * titulky) platí do svého konce, starší ručně psané do dalšího řádku
 * (nejvýš 4 s) - lib/captions.ts. Velikost písma podle volby (S/M/L) a
 * přes celou obrazovku větší (app/globals.css .player-captions).
 */
export default function CaptionsOverlay({ captions, player }: { captions: Caption[]; player: any }) {
  const [activeText, setActiveText] = useState<string | null>(null);
  const [size, setSize] = useState<CaptionSize>('m');

  useEffect(() => {
    setSize(readCaptionSize());
    const onSize = (e: Event) => setSize(((e as CustomEvent).detail as CaptionSize) ?? readCaptionSize());
    window.addEventListener(CAPTION_SIZE_EVENT, onSize);
    return () => window.removeEventListener(CAPTION_SIZE_EVENT, onSize);
  }, []);

  useEffect(() => {
    if (!player || captions.length === 0) return;
    const sorted = [...captions].sort((a, b) => a.time - b.time);

    const interval = setInterval(() => {
      setActiveText(captionAt(sorted, player.currentTime ?? 0));
    }, 250);

    return () => clearInterval(interval);
  }, [player, captions]);

  if (!activeText) return null;

  return (
    <div className={`player-captions player-captions-${size}`} aria-live="polite">
      <span>{activeText}</span>
    </div>
  );
}
