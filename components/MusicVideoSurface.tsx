'use client';

import { useEffect, useRef } from 'react';
import { useMusicCommands } from '@/lib/musicPlayer';

/**
 * Místo, kam se promítne obraz hudebního přehrávače.
 *
 * Sama o sobě je to prázdná krabice se správným poměrem stran. Skutečný
 * přehrávač žije v kostře appky (lib/musicPlayer.tsx) a jen se sem
 * promítne - díky tomu se při přepnutí z obalu na video nic nenačítá
 * znovu, zvuk nepřeskočí a přepnutí je okamžité.
 *
 * Poloha se hlásí v souřadnicích DOKUMENTU: přehrávač je v <body>
 * s position: absolute, takže při rolování jede se stránkou sám a nic se
 * nepřepočítává. Dřív se poloha posílala při každém pohybu (v souřadnicích
 * okna) - přehrávač se překreslil šedesátkrát za vteřinu, obraz za
 * stránkou cukal a celé rolování bylo sekané. Teď se hlásí jen změna
 * rozvržení: jiná velikost krabice, okna nebo obsahu nad ní.
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
      commands.showEngineOver({ top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height });
    }

    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    }

    report();

    // Velikost krabice, a cokoli nad ní, co změní výšku stránky (načtený obrázek,
    // rozbalený popis) - to krabici posune, i když se sama nezměnila.
    // (body má výšku okna - roste obsah stránky, proto se hlídá ten.)
    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    observer.observe(box.closest('.content-area') ?? document.body);
    window.addEventListener('resize', schedule);
    // Pojistka pro posuny, které velikost stránky nezmění (jednou za 1,5 s - jedno měření, nic víc).
    const timer = setInterval(schedule, 1500);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      // Odchod ze stránky (nebo přepnutí zpátky na obal) obraz schová.
      // Zvuk hraje dál - přehrávač se nikam neodpojuje.
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
