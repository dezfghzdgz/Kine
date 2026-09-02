'use client';

/**
 * Kostra obsahu, který se právě načítá.
 *
 * Místo nápisu "Načítám…" se ukáže obrys toho, co za chvíli přijde.
 * Není to jen kosmetika: stránka se pod rukama nepřeskládá, protože
 * kostra zabírá zhruba stejné místo jako hotový obsah, a čekání působí
 * kratší, protože je vidět, že se něco děje.
 *
 * Třídy skeleton-line a skeleton-shimmer už v appce byly (používá je
 * hlavní stránka) - tady jsou jen posbírané do hotových tvarů, ať se
 * nemusí na každé stránce skládat znovu.
 */

export function SkeletonLine({ width = '100%', height = 12 }: { width?: string | number; height?: number }) {
  return <div className="skeleton-line skeleton-shimmer" style={{ width, height }} />;
}

/** Karta videa v mřížce - náhled, název, popisek. */
export function SkeletonVideoCard() {
  return (
    <div className="video-card-skeleton">
      <div className="video-thumb skeleton-shimmer" />
      <SkeletonLine width="85%" />
      <SkeletonLine width="50%" />
    </div>
  );
}

export function SkeletonVideoGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="video-grid">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonVideoCard key={i} />
      ))}
    </div>
  );
}

/** Řádek se čtvercovým náhledem vlevo a textem vpravo (fronta hlášení). */
export function SkeletonRow() {
  return (
    <div className="skeleton-row">
      <div className="skeleton-row-thumb skeleton-shimmer" />
      <div className="skeleton-row-text">
        <SkeletonLine width="60%" height={14} />
        <SkeletonLine width="35%" />
        <SkeletonLine width="45%" />
      </div>
    </div>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="skeleton-rows">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
