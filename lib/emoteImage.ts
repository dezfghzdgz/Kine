/**
 * Obrázek emotu kanálu - čistá logika bez databáze (tests/chatEmotes.test.mjs).
 *
 * Bere se PNG, GIF a WebP (i animované). Druh a rozměry se čtou z obsahu
 * souboru, ne z přípony: PNG z hlavičky IHDR, GIF z "logical screen", WebP
 * z bloku VP8 / VP8L / VP8X. Animace: GIF s víc snímky, WebP s příznakem
 * animace, PNG s blokem acTL (APNG).
 */

export type EmoteImageInfo = { ext: 'png' | 'gif' | 'webp'; type: string; width: number; height: number; animated: boolean };

/** Nejmenší a největší rozměr emotu (px) - v chatu se kreslí 28 px, zvětšený 56 px. */
export const EMOTE_MIN_PX = 18;
export const EMOTE_MAX_PX = 512;

function u16le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

function u24le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
}

function ascii(b: Uint8Array, i: number, n: number): string {
  let s = '';
  for (let k = 0; k < n && i + k < b.length; k++) s += String.fromCharCode(b[i + k]);
  return s;
}

/** Kolik snímků má GIF (bez dekódování - prochází bloky). Víc než 1 = animace. */
function gifFrames(b: Uint8Array): number {
  let i = 13;
  // Globální tabulka barev.
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 0x07) + 1));
  let frames = 0;
  while (i < b.length) {
    const block = b[i];
    if (block === 0x3b) break; // konec
    if (block === 0x21) {
      // Rozšíření: přeskočit podbloky.
      i += 2;
      while (i < b.length && b[i] !== 0) i += b[i] + 1;
      i += 1;
      continue;
    }
    if (block === 0x2c) {
      frames += 1;
      if (frames > 1) return frames;
      const packed = b[i + 9];
      i += 10;
      if (packed & 0x80) i += 3 * (1 << ((packed & 0x07) + 1));
      i += 1; // LZW min code size
      while (i < b.length && b[i] !== 0) i += b[i] + 1;
      i += 1;
      continue;
    }
    break; // neznámý blok - dál nečíst
  }
  return frames;
}

/** Druh, rozměry a animace obrázku; null = není to PNG / GIF / WebP, nebo je poškozený. */
export function emoteImageInfo(bytes: Uint8Array): EmoteImageInfo | null {
  const b = bytes;
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') {
    const width = u32be(b, 16);
    const height = u32be(b, 20);
    // APNG: blok acTL před prvními daty obrázku.
    let animated = false;
    for (let i = 8; i + 8 <= b.length; ) {
      const len = u32be(b, i);
      const type = ascii(b, i + 4, 4);
      if (type === 'acTL') {
        animated = true;
        break;
      }
      if (type === 'IDAT' || type === 'IEND' || len > b.length) break;
      i += 12 + len;
    }
    return { ext: 'png', type: 'image/png', width, height, animated };
  }
  if (b.length >= 13 && ascii(b, 0, 4) === 'GIF8') {
    return { ext: 'gif', type: 'image/gif', width: u16le(b, 6), height: u16le(b, 8), animated: gifFrames(b) > 1 };
  }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') {
      return { ext: 'webp', type: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, animated: (b[20] & 0x02) !== 0 };
    }
    if (chunk === 'VP8 ' && b.length >= 30) {
      return { ext: 'webp', type: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, animated: false };
    }
    if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { ext: 'webp', type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, animated: false };
    }
  }
  return null;
}

/** Je obrázek použitelný jako emote? Vrací kód chyby, nebo null = v pořádku. */
export function checkEmoteImage(info: EmoteImageInfo | null, size: number, maxBytes: number): 'not-image' | 'too-big' | 'size' | null {
  if (!info) return 'not-image';
  if (size > maxBytes) return 'too-big';
  if (info.width < EMOTE_MIN_PX || info.height < EMOTE_MIN_PX || info.width > EMOTE_MAX_PX || info.height > EMOTE_MAX_PX) return 'size';
  // Emote má být zhruba čtverec (široký nápis do 3:1 projde).
  const ratio = info.width / info.height;
  if (ratio > 3 || ratio < 1 / 3) return 'size';
  return null;
}

/** Cesta souboru emotu v úložišti (bucket thumbnails), kam zapisuje jen server. */
export function emoteStoragePath(channelId: string, id: string, ext: string): string {
  return `emotes/${channelId}/${id}.${ext}`;
}

/** Z veřejné adresy emotu zpátky cesta v úložišti - jen soubory emotů tohohle kanálu. */
export function emotePathFromUrl(url: string | null | undefined, channelId: string): string | null {
  if (!url || !channelId) return null;
  const marker = '/storage/v1/object/public/thumbnails/';
  const at = url.indexOf(marker);
  if (at < 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(at + marker.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const prefix = `emotes/${channelId}/`;
  return path.startsWith(prefix) && /^[A-Za-z0-9-]{1,64}\.(png|gif|webp)$/.test(path.slice(prefix.length)) ? path : null;
}
