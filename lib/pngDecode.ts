import { inflateSync } from 'node:zlib';

/**
 * Dekodér PNG pro kontrolu obsahu na serveru (emoty kanálu) - čistá logika,
 * jen vestavěný zlib z Node, žádná další závislost (tests/apiHardening.test.mjs).
 *
 * PROČ: kontrola nahoty (lib/nudityScan.ts) umí číst jen JPEG. U emotů se
 * proto dřív hodnotil náhled, který poslal prohlížeč - a ten si mohl kdokoli
 * vybrat sám (nevinný šedý JPEG k pornografickému GIFu). Teď server přečte
 * přímo nahraný obrázek.
 *
 * Schválně přísné: co by prohlížeč vykreslil jinak než tenhle dekodér
 * (prokládané PNG, animované APNG, neznámé kritické bloky, rozházené IDAT),
 * vrátí null - takový obrázek se pak bere jako neověřený (čeká na moderátora).
 */

export type DecodedImage = { width: number; height: number; rgba: Uint8Array };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Povolené hloubky barev podle typu (PNG specifikace, tabulka 11.1). */
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function u32(b: Uint8Array, i: number): number {
  return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * PNG -> RGBA (8 bitů na kanál). null = není to PNG, které umíme přečíst
 * stejně jako prohlížeč (viz výš), nebo je větší než `maxSide`.
 */
export function decodePng(bytes: Uint8Array, maxSide = 4096): DecodedImage | null {
  if (!bytes || bytes.length < 8 + 25 + 12) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;

  let width = 0;
  let height = 0;
  let depth = 0;
  let color = -1;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let idatClosed = false;
  let ended = false;

  for (let pos = 8; pos + 12 <= bytes.length; ) {
    const len = u32(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const start = pos + 8;
    const end = start + len;
    if (len > bytes.length || end + 4 > bytes.length) return null;
    const data = bytes.subarray(start, end);
    if (width === 0 && type !== 'IHDR') return null;

    if (type === 'IHDR') {
      if (width !== 0 || len !== 13) return null;
      width = u32(data, 0);
      height = u32(data, 4);
      depth = data[8];
      color = data[9];
      // Komprese a filtr mají v PNG jedinou povolenou hodnotu; prokládání (Adam7) neumíme.
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
      if (!DEPTHS[color] || !DEPTHS[color].includes(depth)) return null;
      if (width < 1 || height < 1 || width > maxSide || height > maxSide) return null;
    } else if (type === 'PLTE') {
      if (palette || idat.length > 0 || len === 0 || len % 3 !== 0 || len > 768) return null;
      palette = data;
    } else if (type === 'tRNS') {
      if (trns || idat.length > 0) return null;
      trns = data;
    } else if (type === 'IDAT') {
      if (idatClosed) return null; // IDAT musí jít za sebou
      idat.push(data);
    } else if (type === 'IEND') {
      ended = true;
      break;
    } else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      return null; // APNG - další snímky by kontrola neviděla
    } else if (bytes[pos + 4] >= 0x41 && bytes[pos + 4] <= 0x5a) {
      return null; // neznámý kritický blok
    }
    if (idat.length > 0 && type !== 'IDAT') idatClosed = true;
    pos = end + 4; // + CRC
  }

  if (!ended || width === 0 || idat.length === 0) return null;
  if (color === 3 && !palette) return null;

  const channels = CHANNELS[color];
  const bitsPerPixel = channels * depth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const expected = height * (rowBytes + 1);

  let inflated: Uint8Array;
  try {
    // maxOutputLength: "zip bomba" (malý soubor, obří obraz) se nerozbalí celá.
    inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  } catch {
    return null;
  }
  if (inflated.length !== expected) return null;

  // Odfiltrování řádků (None, Sub, Up, Average, Paeth).
  const raw = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    const prev = y > 0 ? dst - rowBytes : -1;
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? raw[dst + x - bpp] : 0;
      const b = prev >= 0 ? raw[prev + x] : 0;
      const c = prev >= 0 && x >= bpp ? raw[prev + x - bpp] : 0;
      const v = inflated[src + x];
      let out: number;
      switch (filter) {
        case 0:
          out = v;
          break;
        case 1:
          out = v + a;
          break;
        case 2:
          out = v + b;
          break;
        case 3:
          out = v + ((a + b) >> 1);
          break;
        case 4:
          out = v + paeth(a, b, c);
          break;
        default:
          return null;
      }
      raw[dst + x] = out & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  const maxSample = (1 << depth) - 1;
  // Vzorek na pozici (kanál k) pixelu x v řádku - celá hodnota (i 16 bitů).
  const sample = (row: number, x: number, k: number): number => {
    if (depth === 8) return raw[row + x * channels + k];
    if (depth === 16) {
      const i = row + (x * channels + k) * 2;
      return (raw[i] << 8) | raw[i + 1];
    }
    const bit = (x * channels + k) * depth;
    return (raw[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxSample;
  };
  const to8 = (v: number): number => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / maxSample));
  const trnsGray = color === 0 && trns && trns.length >= 2 ? (trns[0] << 8) | trns[1] : -1;
  const trnsRgb = color === 2 && trns && trns.length >= 6 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : null;

  for (let y = 0; y < height; y++) {
    const row = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (color === 0) {
        const g = sample(row, x, 0);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = to8(g);
        rgba[o + 3] = g === trnsGray ? 0 : 255;
      } else if (color === 2) {
        const r = sample(row, x, 0);
        const g = sample(row, x, 1);
        const b = sample(row, x, 2);
        rgba[o] = to8(r);
        rgba[o + 1] = to8(g);
        rgba[o + 2] = to8(b);
        rgba[o + 3] = trnsRgb && r === trnsRgb[0] && g === trnsRgb[1] && b === trnsRgb[2] ? 0 : 255;
      } else if (color === 3) {
        const idx = sample(row, x, 0);
        const p = idx * 3;
        // Index mimo paletu: černá (tak to kreslí i prohlížeče).
        if (palette && p + 2 < palette.length) {
          rgba[o] = palette[p];
          rgba[o + 1] = palette[p + 1];
          rgba[o + 2] = palette[p + 2];
        }
        rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (color === 4) {
        const g = to8(sample(row, x, 0));
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = to8(sample(row, x, 1));
      } else {
        rgba[o] = to8(sample(row, x, 0));
        rgba[o + 1] = to8(sample(row, x, 1));
        rgba[o + 2] = to8(sample(row, x, 2));
        rgba[o + 3] = to8(sample(row, x, 3));
      }
    }
  }
  return { width, height, rgba };
}

/**
 * Průhledný obrázek na šedé pozadí (RGB) - stejně jako náhled, který kontrola
 * dostávala dřív od prohlížeče. Průhlednost se tak nedá použít ke schování obsahu
 * (model by jinak viděl jen barvy pod průhlednými pixely).
 */
export function flattenOnGray(image: DecodedImage, gray = 128): Uint8Array {
  const { width, height, rgba } = image;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3];
    rgb[j] = Math.round((rgba[i] * a + gray * (255 - a)) / 255);
    rgb[j + 1] = Math.round((rgba[i + 1] * a + gray * (255 - a)) / 255);
    rgb[j + 2] = Math.round((rgba[i + 2] * a + gray * (255 - a)) / 255);
  }
  return rgb;
}
