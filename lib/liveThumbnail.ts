/**
 * Vlastní náhled přenosu (obrázek v řadě "Živě", na stránce Živě a v náhledu
 * odkazu). Studio na webu i appka ho před odesláním zmenší na 1280×720
 * (JPEG) - server ověří, že je to opravdu JPEG nejvýš té velikosti.
 * Čistá logika bez databáze (tests/liveThumbnail.test.mjs).
 */

/** Víc server nepřijme (zmenšený náhled má kolem 150-400 kB). */
export const LIVE_THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024;
/** Rozměry, na které náhled zmenšuje studio i appka (16:9). */
export const LIVE_THUMBNAIL_WIDTH = 1280;
export const LIVE_THUMBNAIL_HEIGHT = 720;
const MIN_SIDE = 160;

/** Šířka a výška JPEGu z hlavičky (značka SOF) - bez dekódování obrázku. null = není to JPEG. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1];
    // Výplň (víc 0xFF za sebou) se přeskočí.
    while (marker === 0xff && i + 2 < bytes.length) {
      i += 1;
      marker = bytes[i + 1];
    }
    // Značky bez délky: RSTn, SOI, TEM.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0xd8 || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // konec obrázku / data bez SOF
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 8 >= bytes.length) return null;
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}

export type ThumbnailCheck = { ok: true; width: number; height: number } | { ok: false; code: 'empty' | 'too-big' | 'not-jpeg' | 'size' };

/**
 * Projde nahraný náhled? Větší než 1280×720 ne: tak velký ho studio ani
 * appka nikdy nepošlou a kontrola obsahu (lib/nudityScan.ts) by obří
 * obrázek nedekódovala - zůstal by viset neprověřený.
 */
export function checkLiveThumbnail(bytes: Uint8Array): ThumbnailCheck {
  if (bytes.length === 0) return { ok: false, code: 'empty' };
  if (bytes.length > LIVE_THUMBNAIL_MAX_BYTES) return { ok: false, code: 'too-big' };
  const size = jpegSize(bytes);
  if (!size) return { ok: false, code: 'not-jpeg' };
  if (size.width < MIN_SIDE || size.height < MIN_SIDE / 2 || size.width > LIVE_THUMBNAIL_WIDTH || size.height > LIVE_THUMBNAIL_HEIGHT) {
    return { ok: false, code: 'size' };
  }
  return { ok: true, ...size };
}

/**
 * Kam se náhled uloží (bucket thumbnails): složka live/<kanál>/, kam smí
 * zapisovat jen server - do vlastní složky <kanál>/ může uživatel nahrávat
 * i přímo z prohlížeče (náhledy videí) a obešel by tak kontrolu. Každý
 * náhled má nové jméno, takže mezipaměti nikdy nedrží starý.
 */
export function newLiveThumbnailPath(ownerId: string, id: string): string {
  return `live/${ownerId}/${id}.jpg`;
}

/** Cesta v úložišti z veřejné adresy náhledu - jen náhled přenosu daného kanálu, jinak null. */
export function liveThumbnailPath(url: string | null | undefined, ownerId: string): string | null {
  if (!url || !ownerId) return null;
  const marker = '/storage/v1/object/public/thumbnails/';
  const at = url.indexOf(marker);
  if (at < 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(at + marker.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const prefix = `live/${ownerId}/`;
  return path.startsWith(prefix) && /^[A-Za-z0-9-]{1,64}\.jpg$/.test(path.slice(prefix.length)) ? path : null;
}

/** Výřez zdroje, který vyplní cíl beze změny poměru stran (jako object-fit: cover). */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): { sx: number; sy: number; sw: number; sh: number } {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return { sx: 0, sy: 0, sw: Math.max(0, srcW), sh: Math.max(0, srcH) };
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = Math.min(srcW, dstW / scale);
  const sh = Math.min(srcH, dstH / scale);
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

/**
 * V prohlížeči: obrázek z disku -> JPEG 1280×720 (oříznutý na 16:9 jako
 * na kartách). Vrací null, když ho prohlížeč neumí přečíst.
 */
export async function liveThumbnailJpeg(file: Blob): Promise<Blob | null> {
  let source: CanvasImageSource & { width: number; height: number };
  try {
    source = await createImageBitmap(file);
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = LIVE_THUMBNAIL_WIDTH;
  canvas.height = LIVE_THUMBNAIL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const r = coverRect(source.width, source.height, LIVE_THUMBNAIL_WIDTH, LIVE_THUMBNAIL_HEIGHT);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, 0, 0, LIVE_THUMBNAIL_WIDTH, LIVE_THUMBNAIL_HEIGHT);
  (source as ImageBitmap).close?.();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.86));
}
