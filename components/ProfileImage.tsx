'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { APPEARANCE_EVENT } from '@/lib/appearance';
import { shouldAnimate, stillUrlFor, type AvatarAnimation } from '@/lib/animatedImage';
import { trustedImageUrl } from '@/lib/trustedMedia';

/** Průhledný bod místo obrázku z neznámého serveru (lib/trustedMedia.ts) - rozložení stránky zůstane. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Nastavení animací z <html data-anim> (Nastavení -> Vzhled) a jestli si člověk přeje méně pohybu. */
function readMotion(): { setting: AvatarAnimation; reduced: boolean } {
  if (typeof document === 'undefined') return { setting: 'hover', reduced: false };
  const root = document.documentElement;
  const raw = root.getAttribute('data-anim');
  const setting: AvatarAnimation = raw === 'always' || raw === 'never' ? raw : 'hover';
  let reduced = root.getAttribute('data-calm') === '1';
  try {
    reduced = reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // starý prohlížeč
  }
  return { setting, reduced };
}

/**
 * Profilovka nebo banner, které můžou být animované (lib/animatedImage.ts).
 *
 * Obyčejný obrázek se vykreslí jako dřív. U animace se v seznamech ukazuje
 * první snímek a animace hraje po najetí myší na řádek / kartu (nejbližší
 * předek s data-anim-scope, jinak rodič obrázku); `animate="always"` =
 * hraje pořád (kanál, náhled v nastavení). Když statický snímek chybí,
 * ukáže se rovnou animace.
 */
export default function ProfileImage({
  src,
  alt = '',
  animate = 'hover',
  className,
  style,
  eager = false,
}: {
  src: string;
  alt?: string;
  animate?: 'always' | 'hover';
  className?: string;
  style?: CSSProperties;
  /** Načíst hned (hlavička kanálu) místo líného načítání. */
  eager?: boolean;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const trusted = trustedImageUrl(src);
  src = trusted ?? BLANK;
  const still = trusted ? stillUrlFor(src) : null;
  const [motion, setMotion] = useState<{ setting: AvatarAnimation; reduced: boolean }>({ setting: 'hover', reduced: false });
  const [hovered, setHovered] = useState(false);
  const [stillFailed, setStillFailed] = useState(false);

  useEffect(() => {
    if (!still) return;
    const sync = () => setMotion(readMotion());
    sync();
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, [still]);

  useEffect(() => {
    if (!still || animate === 'always') return;
    const img = ref.current;
    const scope = (img?.closest('[data-anim-scope]') as HTMLElement | null) ?? img?.parentElement ?? null;
    if (!scope) return;
    const on = () => setHovered(true);
    const off = () => setHovered(false);
    scope.addEventListener('mouseenter', on);
    scope.addEventListener('mouseleave', off);
    scope.addEventListener('focusin', on);
    scope.addEventListener('focusout', off);
    return () => {
      scope.removeEventListener('mouseenter', on);
      scope.removeEventListener('mouseleave', off);
      scope.removeEventListener('focusin', on);
      scope.removeEventListener('focusout', off);
    };
  }, [still, animate]);

  useEffect(() => setStillFailed(false), [src]);

  const play = !still || stillFailed || shouldAnimate(motion.setting, animate, hovered, motion.reduced);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={play ? src : (still as string)}
      alt={alt}
      className={className}
      style={style}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => {
        if (!play) setStillFailed(true);
      }}
    />
  );
}
