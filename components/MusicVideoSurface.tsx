'use client';

import { useEffect, useRef } from 'react';
import { useMusicCommands } from '@/lib/musicPlayer';

/**
 * Místo, kam se promítne obraz hudebního přehrávače.
 *
 * Sama o sobě je to prázdná krabice se správným poměrem stran. Skutečný
 * iframe žije v kostře appky (lib/musicPlayer.tsx) a jen se sem přesune -
 * díky tomu se při přepnutí z obalu na video nic nenačítá znovu, zvuk
 * nepřeskočí a přepnutí je okamžité.
 *
 * Dřív si tu stránka videa zakládala vlastní iframe se stejným videem,
 * jaké hrálo na pozadí. Dva přehrávače téhož videa na jedné stránce si
 * ale lezou do zelí - appka se na ten druhý napojila, poslala mu "hraj"
 * a nic. Právě proto se video po přepnutí nikdy nenačetlo.
 */
export default function MusicVideoSurface({ vertical }: { vertical?: boolean }) {
  const commands = useMusicCommands();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    let frame = 0;

    function report() {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      commands.showEngineOver({ top: r.top, left: r.left, width: r.width, height: r.height });
    }

    /** Při rolování a zvětšování okna se obdélník mění - jinak by obraz zůstal viset. */
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    }

    report();

    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      // Odchod ze stránky (nebo přepnutí zpátky na obal) obraz schová.
      // Zvuk hraje dál - iframe se nikam neodpojuje.
      commands.showEngineOver(null);
    };
  }, [commands]);

  return (
    <div
      ref={boxRef}
      className="music-video-surface"
      style={vertical ? { aspectRatio: '9 / 16', maxHeight: '78vh', margin: '0 auto' } : { aspectRatio: '16 / 9' }}
      aria-hidden="true"
    />
  );
}
