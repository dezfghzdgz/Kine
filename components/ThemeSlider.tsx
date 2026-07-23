'use client';

import { useRef, useState } from 'react';

type Theme = 'dark' | 'gray' | 'light';
const POSITIONS: Theme[] = ['dark', 'gray', 'light'];
const TRACK_WIDTH = 72;
const KNOB_SIZE = 18;
const MAX_LEFT = TRACK_WIDTH - KNOB_SIZE - 4; // padding 2px each side

function themeToLeft(theme: Theme) {
  const index = POSITIONS.indexOf(theme);
  return (index / (POSITIONS.length - 1)) * MAX_LEFT + 2;
}

function leftToTheme(left: number): Theme {
  const ratio = (left - 2) / MAX_LEFT;
  const index = Math.round(ratio * (POSITIONS.length - 1));
  return POSITIONS[Math.min(Math.max(index, 0), POSITIONS.length - 1)];
}

export default function ThemeSlider({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (t: Theme) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragLeft, setDragLeft] = useState<number | null>(null);

  const currentLeft = dragLeft !== null ? dragLeft : themeToLeft(theme);

  function updateFromClientX(clientX: number) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    let left = clientX - rect.left - KNOB_SIZE / 2;
    left = Math.min(Math.max(left, 2), MAX_LEFT + 2);
    setDragLeft(left);
  }

  function handlePointerDown(e: React.PointerEvent) {
    setDragging(true);
    (e.target as Element).setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    updateFromClientX(e.clientX);
  }

  function handlePointerUp() {
    if (dragLeft !== null) {
      const nextTheme = leftToTheme(dragLeft);
      onChange(nextTheme);
    }
    setDragging(false);
    setDragLeft(null);
  }

  return (
    <div
      ref={trackRef}
      className="theme-slider-track"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => dragging && handlePointerUp()}
    >
      <div className="theme-slider-knob" style={{ left: currentLeft }} />
    </div>
  );
}
