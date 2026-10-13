/**
 * Animované profilovky a bannery (GIF, animovaný WebP, APNG).
 *
 * Obrázek se nahrává tak, jak je (žádné překódování - to by animaci
 * zabilo). Když je animovaný, nahraje se k němu i první snímek jako
 * statický obrázek a soubory dostanou pevná jména:
 *
 *   <uživatel>/avatar-anim.gif     animace
 *   <uživatel>/avatar-still.webp   první snímek
 *
 * Z adresy animace jde tedy adresa statického snímku odvodit (stillUrlFor)
 * bez nového sloupce v databázi. V seznamech (chat, komentáře, postranní
 * panel...) se ukazuje statický snímek a animace jen po najetí myší - jako
 * na Discordu; na kanálu hraje pořád. Nastavení -> Vzhled to umí změnit
 * (vždy / po najetí / nikdy) a klidný režim nebo "omezit pohyb" v systému
 * animace vypne (components/ProfileImage.tsx).
 *
 * Čistá logika bez prohlížeče - má test (tests/animatedImage.test.mjs).
 */

export type ProfileImageKind = 'avatar' | 'banner';

/** Co jde nahrát jako profilovku / banner. */
export const PROFILE_IMAGE_TYPES: Record<string, string> = {
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/png': 'png',
  'image/apng': 'png',
  'image/jpeg': 'jpg',
  'image/avif': 'avif',
};

/** Největší soubor: animace bývají velké, ale v seznamech se jich načítá hodně najednou. */
export const PROFILE_IMAGE_MAX_BYTES: Record<ProfileImageKind, number> = {
  avatar: 4 * 1024 * 1024,
  banner: 8 * 1024 * 1024,
};

/** Statický snímek se zmenší nejvýš na tohle (delší strana). */
export const STILL_MAX_SIDE: Record<ProfileImageKind, number> = { avatar: 512, banner: 1600 };

const ascii = (b: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/** Kolik snímků má GIF (počítá nejvýš do `stopAt` - na "je animovaný?" stačí 2). */
export function gifFrameCount(b: Uint8Array, stopAt = 2): number {
  if (b.length < 13 || !ascii(b, 0, 'GIF8')) return 0;
  let p = 13;
  const screenFlags = b[10];
  if (screenFlags & 0x80) p += 3 * (1 << ((screenFlags & 0x07) + 1));
  let frames = 0;
  const skipSubBlocks = () => {
    while (p < b.length && b[p] !== 0) p += b[p] + 1;
    p += 1;
  };
  while (p < b.length) {
    const block = b[p];
    if (block === 0x3b) break; // konec souboru
    if (block === 0x21) {
      // rozšíření (řízení snímku, komentář, NETSCAPE smyčka...)
      p += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      frames += 1;
      if (frames >= stopAt) return frames;
      const imageFlags = b[p + 9];
      p += 10;
      if (imageFlags & 0x80) p += 3 * (1 << ((imageFlags & 0x07) + 1));
      p += 1; // LZW
      skipSubBlocks();
    } else {
      break; // rozbitý soubor - co se napočítalo, to platí
    }
  }
  return frames;
}

/** Animovaný WebP: kontejner VP8X s příznakem animace. */
function webpAnimated(b: Uint8Array): boolean {
  if (b.length < 21 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP') || !ascii(b, 12, 'VP8X')) return false;
  return (b[20] & 0x02) !== 0;
}

/** APNG: blok acTL (počet snímků > 1) před prvními obrazovými daty. */
function pngAnimated(b: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 8 || sig.some((v, i) => b[i] !== v)) return false;
  let p = 8;
  while (p + 8 <= b.length) {
    const length = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    if (ascii(b, p + 4, 'acTL')) {
      if (p + 12 > b.length) return false;
      const frames = ((b[p + 8] << 24) | (b[p + 9] << 16) | (b[p + 10] << 8) | b[p + 11]) >>> 0;
      return frames > 1;
    }
    if (ascii(b, p + 4, 'IDAT') || ascii(b, p + 4, 'IEND')) return false;
    p += 12 + length;
  }
  return false;
}

/** Je obrázek animovaný? Podle obsahu, ne podle přípony. */
export function isAnimatedImage(bytes: Uint8Array): boolean {
  return gifFrameCount(bytes) > 1 || webpAnimated(bytes) || pngAnimated(bytes);
}

/** Přípona podle typu souboru; null = tenhle typ nahrát nejde. */
export function profileImageExtension(type: string): string | null {
  return PROFILE_IMAGE_TYPES[type.toLowerCase()] ?? null;
}

/** Cesty v úložišti: animace má vedle sebe statický snímek, obyčejný obrázek je jeden soubor. */
export function profileImagePaths(userId: string, kind: ProfileImageKind, extension: string, animated: boolean): { main: string; still: string | null } {
  return animated
    ? { main: `${userId}/${kind}-anim.${extension}`, still: `${userId}/${kind}-still.webp` }
    : { main: `${userId}/${kind}.${extension}`, still: null };
}

const ANIMATED_URL = /\/(avatar|banner)-anim\.[a-z0-9]+(\?[^#]*)?(#.*)?$/i;

/** Adresa statického snímku k animované profilovce / banneru; null = obrázek není animovaný. */
export function stillUrlFor(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = ANIMATED_URL.exec(url);
  if (!m) return null;
  return `${url.slice(0, m.index)}/${m[1].toLowerCase()}-still.webp${m[2] ?? ''}`;
}

/** Kdy animace hraje (Nastavení -> Vzhled). */
export type AvatarAnimation = 'always' | 'hover' | 'never';

/**
 * Hraje animace teď? `place`: 'always' = místo, kde má hrát pořád (kanál,
 * nastavení), 'hover' = seznamy. Klidný režim / omezený pohyb ji vypne,
 * pokud si ji člověk výslovně nezapnul na "vždy".
 */
export function shouldAnimate(setting: AvatarAnimation, place: 'always' | 'hover', hovered: boolean, reducedMotion: boolean): boolean {
  if (setting === 'never') return false;
  if (setting === 'always') return true;
  if (reducedMotion) return false;
  return place === 'always' || hovered;
}
