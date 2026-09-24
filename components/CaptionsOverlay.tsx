'use client';

import { useEffect, useState } from 'react';
import { captionAt, type Caption } from '@/lib/captions';

/**
 * Titulky přes video. Řádek s koncem (import .srt/.vtt, automatické
 * titulky) platí do svého konce, starší ručně psané do dalšího řádku
 * (nejvýš 4 s) - lib/captions.ts.
 */
export default function CaptionsOverlay({ captions, player }: { captions: Caption[]; player: any }) {
  const [activeText, setActiveText] = useState<string | null>(null);

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
    <div
      style={{
        position: 'absolute', left: '10%', right: '10%', bottom: 64, zIndex: 4,
        textAlign: 'center', pointerEvents: 'none',
      }}
    >
      <span
        style={{
          background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: 'clamp(13px, 1.6vw, 20px)', fontWeight: 500,
          padding: '4px 10px', borderRadius: 4, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
          whiteSpace: 'pre-line', lineHeight: 1.45,
        }}
      >
        {activeText}
      </span>
    </div>
  );
}
