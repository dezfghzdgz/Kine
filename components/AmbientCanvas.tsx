'use client';

import { useEffect, useRef } from 'react';

/**
 * Barvy z obrazu, které se plynule přelévají (pozadí skla a světlo kolem
 * přehrávače). Přehrávač Cloudflare je v rámu z jiné domény - pixely videa
 * číst nejde, proto stránka každou sekundu (živě každé 2 s) podá malý
 * snímek z místa přehrávání (lib/appearance.ts) a tohle plátno se k němu
 * pořád pomalu přelévá: každý snímek se přes předchozí kreslí s malou
 * průhledností (exponenciální průměr), takže barvy tečou, neskáčou.
 *
 * Plátno je maličké (64 × 36) - roztažené přes celé okno a rozmazané
 * z něj zůstanou jen barvy. Kreslí se jen během přelévání (nejvýš ~20×
 * za sekundu), pak stojí; v kartě na pozadí prohlížeč kreslení sám
 * zastaví. Obrázek z jiné domény plátno "zamkne" pro čtení - to nevadí,
 * nic se z něj nečte, jen se ukazuje.
 */
const WIDTH = 64;
const HEIGHT = 36;
/** Časová konstanta přelévání: za ~1,2 s je nový snímek skoro celý (95 %). */
const TAU_SECONDS = 0.4;
/** Po změně se kreslí ještě tak dlouho, než barvy doběhnou (5 τ ≈ 99 %). */
const SETTLE_MS = TAU_SECONDS * 5 * 1000;
const FRAME_MS = 50;

type State = {
  target: HTMLImageElement | null;
  raf: number;
  last: number;
  settleUntil: number;
  painted: boolean;
};

/** Obrázek na plátno "cover" - vyplní celé, přesahy se odříznou (střed zůstane). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  const iw = img.naturalWidth || WIDTH;
  const ih = img.naturalHeight || HEIGHT;
  const target = WIDTH / HEIGHT;
  let sw = iw;
  let sh = ih;
  let sx = 0;
  let sy = 0;
  if (iw / ih > target) {
    sw = ih * target;
    sx = (iw - sw) / 2;
  } else {
    sh = iw / target;
    sy = (ih - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, WIDTH, HEIGHT);
}

export default function AmbientCanvas({ src, className }: { src: string | null; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<State>({ target: null, raf: 0, last: 0, settleUntil: 0, painted: false });

  // Jedna smyčka kreslení na plátno, dokud barvy nedoběhnou k poslednímu snímku.
  useEffect(() => {
    const state = stateRef.current;
    return () => {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const state = stateRef.current;
    let cancelled = false;

    const frame = (now: number) => {
      state.raf = 0;
      const img = state.target;
      if (!img || cancelled) return;
      if (state.last && now - state.last < FRAME_MS) {
        state.raf = requestAnimationFrame(frame);
        return;
      }
      const dt = state.last ? Math.min(0.25, (now - state.last) / 1000) : FRAME_MS / 1000;
      state.last = now;
      // První snímek celý (jinak by se barvy pomalu vynořovaly z černé); další se přelévají.
      ctx.globalAlpha = state.painted ? 1 - Math.exp(-dt / TAU_SECONDS) : 1;
      drawCover(ctx, img);
      if (!state.painted) {
        state.painted = true;
        canvas.dataset.ready = '1';
      }
      if (now < state.settleUntil) {
        state.raf = requestAnimationFrame(frame);
      } else {
        // Doběhlo: poslední snímek přesně (bez zbytku předchozích), smyčka stojí.
        ctx.globalAlpha = 1;
        drawCover(ctx, img);
        state.last = 0;
      }
    };

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (cancelled) return;
      state.target = img;
      state.settleUntil = performance.now() + SETTLE_MS;
      if (!state.raf) state.raf = requestAnimationFrame(frame);
    };
    img.src = src;
    return () => {
      cancelled = true;
      img.onload = null;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      state.last = 0;
    };
  }, [src]);

  return <canvas ref={canvasRef} className={`ambient-canvas ${className ?? ''}`} width={WIDTH} height={HEIGHT} aria-hidden="true" />;
}
