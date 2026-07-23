'use client';

import { useEffect, useState } from 'react';

type Caption = { time: number; text: string };

export default function CaptionsOverlay({ captions, player }: { captions: Caption[]; player: any }) {
  const [activeText, setActiveText] = useState<string | null>(null);

  useEffect(() => {
    if (!player || captions.length === 0) return;
    const sorted = [...captions].sort((a, b) => a.time - b.time);

    const interval = setInterval(() => {
      const current = player.currentTime ?? 0;
      let text: string | null = null;
      for (let i = 0; i < sorted.length; i++) {
        const nextTime = sorted[i + 1]?.time ?? sorted[i].time + 4;
        if (current >= sorted[i].time && current < nextTime) {
          text = sorted[i].text;
        }
      }
      setActiveText(text);
    }, 300);

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
          background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: 15, fontWeight: 500,
          padding: '4px 10px', borderRadius: 4, boxDecorationBreak: 'clone',
        }}
      >
        {activeText}
      </span>
    </div>
  );
}
