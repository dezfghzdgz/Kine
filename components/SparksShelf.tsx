'use client';

import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { sparksShelfColumns } from '@/lib/sparksShelf';

/**
 * Pruh Sparks mezi videi (hlavní stránka, Prozkoumat, kanál, hashtag...).
 *
 * Dřív to byla mřížka s kartami nejvýš 220 px: na širokém monitoru pruh
 * skončil daleko od pravého kraje (6 karet a za nimi prázdno). Teď se
 * spočítá, kolik karet se do řádku vejde (lib/sparksShelf.ts), řádek je
 * vyplní celý a zbytek schová za "Zobrazit víc". Bez vodorovného
 * posouvání - nabídka ⋮ u karty by se v posuvném pruhu ořízla.
 */
export default function SparksShelf({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { t } = useLanguage();
  const wrapRef = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children);
  const [layout, setLayout] = useState<{ cols: number; rows: number } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const next = sparksShelfColumns(el.clientWidth, items.length);
      setLayout((prev) => (prev && prev.cols === next.cols && prev.rows === next.rows ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  // Do změření (první vykreslení) se ukáže všechno v běžné mřížce - nic neposkočí víc než o řádek.
  const visible = !layout || expanded ? items : items.slice(0, layout.cols * layout.rows);
  const hidden = items.length - visible.length;

  return (
    <section className="sparks-shelf" style={style} aria-label="Sparks">
      <div className="sparks-shelf-head">
        <Link href="/sparks" className="sparks-shelf-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
          </svg>
          Sparks
        </Link>
        <Link href="/sparks" className="sparks-shelf-all">
          {t('sparksSeeAll')} →
        </Link>
      </div>
      <div
        ref={wrapRef}
        className={layout ? 'sparks-shelf-grid' : 'shorts-grid'}
        style={layout ? { gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))` } : undefined}
      >
        {visible}
      </div>
      {(hidden > 0 || expanded) && layout && items.length > layout.cols * layout.rows && (
        <button type="button" className="sparks-shelf-more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? t('sparksShowLess') : t('sparksShowMore').replace('{count}', String(hidden))}
        </button>
      )}
    </section>
  );
}

/** Dávka videí (lib/videoBlocks.ts): Sparks jako pruh, dlouhá videa jako mřížka. */
export function VideoBlockRow({ type, children, style }: { type: 'long' | 'sparks'; children: ReactNode; style?: CSSProperties }) {
  if (type === 'sparks') return <SparksShelf style={style}>{children}</SparksShelf>;
  return (
    <div className="video-grid" style={style}>
      {children}
    </div>
  );
}
