/**
 * Vzhled webu, který si každý nastaví sám (Nastavení -> Vzhled):
 *
 *  - motiv: tmavý / šedý / světlý (dřív jen v nabídce profilu),
 *  - styl: klasický (plné tmavé plochy) nebo SKLO - průhledné plochy nad
 *    barevným rozmazaným pozadím (jako upravený Spotify nebo YouTube
 *    s ambientním světlem),
 *  - pozadí skla: podle videa (barvy toho, na co se díváš), moje barva
 *    (barva u loga), nebo předvolba (Noc, Západ slunce, Les, Oceán, Neon),
 *  - síla skla (jak moc je vidět pozadí),
 *  - ambientní světlo kolem přehrávače (funguje v obou stylech),
 *  - "sleduje obraz": pozadí a světlo se mění s tím, co je ve videu nebo
 *    přenosu právě vidět (snímky z místa přehrávání, ne jen náhled),
 *  - pohyb barev: barevné pozadí skla se pomalu přelévá,
 *  - vlastní obrázek za sklem (jako tapeta) a jak moc ho rozmazat,
 *  - velikost písma, zaoblení rohů, velikost karet videí a klidný režim
 *    (bez animací),
 *  - písmo (Inter, systémové, zaoblené, patkové, strojové), rozestupy
 *    (úsporné / normální / vzdušné), vysoký kontrast, náhledy videí po
 *    najetí myší a kdy hrají animované profilovky (vždy / po najetí / nikdy).
 *
 * Ukládá se do zařízení (localStorage), ne k účtu - jako na YouTube: na
 * televizi chceš možná jiný vzhled než na telefonu. Kine do PC má web
 * v okně se stejnou pamětí, takže tam platí totéž.
 *
 * Aby stránka po načtení "nepřeblikla" z výchozího vzhledu do zvoleného,
 * nastaví <html> ještě před vykreslením malý skript v app/layout.tsx
 * (APPEARANCE_BOOT_SCRIPT). Všechno ostatní dělají atributy na <html>
 * a CSS (app/globals.css, oddíl VZHLED):
 *   data-theme="gray|light", data-look="glass", data-backdrop="...",
 *   data-ambient="1|0", data-motion="1", data-text="s|l",
 *   data-corners="sharp|round", data-cards="s|l", data-calm="1",
 *   data-font="system|rounded|serif|mono", data-density="compact|comfy",
 *   data-contrast="1", data-previews="0", data-anim="always|never"
 *   a proměnné --glass-k (síla skla 0-1) a --blur-k (rozmazání obrázku 0-1).
 */

export type Theme = 'dark' | 'gray' | 'light';
export type Look = 'classic' | 'glass';
export type Backdrop = 'auto' | 'brand' | 'night' | 'sunset' | 'forest' | 'ocean' | 'neon' | 'aurora' | 'candy' | 'ember' | 'mono' | 'image';
export type TextSize = 's' | 'm' | 'l';
export type Corners = 'sharp' | 'normal' | 'round';
export type CardSize = 's' | 'm' | 'l';
export type FontChoice = 'inter' | 'system' | 'rounded' | 'serif' | 'mono';
export type Density = 'compact' | 'normal' | 'comfy';
/** Kdy hrají animované profilovky a bannery (lib/animatedImage.ts). */
export type AvatarMotion = 'always' | 'hover' | 'never';
/** Vzor přes pozadí celé appky (v barvě appky) - nebo vlastní obrázek jako dlaždice. */
export type Pattern = 'none' | 'dots' | 'grid' | 'diagonal' | 'waves' | 'plus' | 'circles' | 'zigzag' | 'custom';

export type Appearance = {
  look: Look;
  backdrop: Backdrop;
  /** Síla skla 0-100: čím víc, tím průhlednější plochy a výraznější pozadí. */
  strength: number;
  /** Ambientní světlo kolem přehrávače (barvy videa prosvítají kolem něj). */
  ambient: boolean;
  /** Pozadí a světlo sledují obraz: snímky z místa, kde video / přenos právě je (video každou sekundu, přenos každé 2 s), plynule prolnuté. */
  follow: boolean;
  /** Barvy pozadí skla se pomalu přelévají. */
  motion: boolean;
  /** Vlastní obrázek za sklem: jak moc rozmazaný (0 = ostrý jako tapeta, 100 = jen barvy). */
  blur: number;
  /** Velikost písma. */
  text: TextSize;
  /** Zaoblení rohů ploch, tlačítek a karet. */
  corners: Corners;
  /** Velikost karet videí (kolik se jich vejde do řádku). */
  cards: CardSize;
  /** Klidný režim: bez animací a přechodů (i když systém o omezení pohybu neví). */
  calm: boolean;
  /** Písmo celé appky. */
  font: FontChoice;
  /** Rozestupy: úsporné (víc obsahu na obrazovce), normální, vzdušné. */
  density: Density;
  /** Vysoký kontrast: světlejší vedlejší text a výraznější okraje. */
  contrast: boolean;
  /** Náhled videa po najetí myší na kartu. */
  previews: boolean;
  /** Animované profilovky a bannery: vždy / po najetí myší / nikdy. */
  avatars: AvatarMotion;
  /** Vzor přes pozadí (klasický i skleněný vzhled). */
  pattern: Pattern;
  /** Jak výrazný je vzor 0-100. */
  patternStrength: number;
  /** Velikost vzoru 50-200 (%). */
  patternScale: number;
};

export const THEMES: readonly Theme[] = ['dark', 'gray', 'light'];
export const LOOKS: readonly Look[] = ['classic', 'glass'];
export const BACKDROPS: readonly Backdrop[] = ['auto', 'brand', 'night', 'sunset', 'forest', 'ocean', 'neon', 'aurora', 'candy', 'ember', 'mono', 'image'];
export const TEXT_SIZES: readonly TextSize[] = ['s', 'm', 'l'];
export const CORNERS: readonly Corners[] = ['sharp', 'normal', 'round'];
export const CARD_SIZES: readonly CardSize[] = ['s', 'm', 'l'];
export const FONTS: readonly FontChoice[] = ['inter', 'system', 'rounded', 'serif', 'mono'];
export const DENSITIES: readonly Density[] = ['compact', 'normal', 'comfy'];
export const AVATAR_MOTIONS: readonly AvatarMotion[] = ['always', 'hover', 'never'];
export const PATTERNS: readonly Pattern[] = ['none', 'dots', 'grid', 'diagonal', 'waves', 'plus', 'circles', 'zigzag', 'custom'];

export const THEME_KEY = 'kine-theme';
export const APPEARANCE_KEY = 'kine-appearance';
/** Vlastní obrázek za sklem (data URL, zmenšený) - zvlášť, je větší než zbytek vzhledu. */
export const BACKDROP_IMAGE_KEY = 'kine-backdrop-image';
/** Vlastní vzor (dlaždice, data URL) - zvlášť jako obrázek za sklem. */
export const PATTERN_IMAGE_KEY = 'kine-pattern-image';
/** Událost na window, když se vzhled změní (nabídka profilu, pozadí, nastavení). */
export const APPEARANCE_EVENT = 'kine-appearance';

export const DEFAULT_APPEARANCE: Appearance = {
  look: 'classic',
  backdrop: 'auto',
  strength: 55,
  ambient: true,
  follow: false,
  motion: false,
  blur: 40,
  text: 'm',
  corners: 'normal',
  cards: 'm',
  calm: false,
  font: 'inter',
  density: 'normal',
  contrast: false,
  previews: true,
  avatars: 'hover',
  pattern: 'none',
  patternStrength: 40,
  patternScale: 100,
};

export function parseTheme(value: unknown): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : 'dark';
}

/** Cokoli z localStorage (i rozbité / starší) -> platný vzhled. */
export function sanitizeAppearance(raw: unknown): Appearance {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const strength = Number(r.strength);
  const blur = Number(r.blur);
  return {
    look: LOOKS.includes(r.look as Look) ? (r.look as Look) : DEFAULT_APPEARANCE.look,
    backdrop: BACKDROPS.includes(r.backdrop as Backdrop) ? (r.backdrop as Backdrop) : DEFAULT_APPEARANCE.backdrop,
    strength: Number.isFinite(strength) ? Math.round(Math.max(0, Math.min(100, strength))) : DEFAULT_APPEARANCE.strength,
    ambient: typeof r.ambient === 'boolean' ? r.ambient : DEFAULT_APPEARANCE.ambient,
    follow: typeof r.follow === 'boolean' ? r.follow : DEFAULT_APPEARANCE.follow,
    motion: typeof r.motion === 'boolean' ? r.motion : DEFAULT_APPEARANCE.motion,
    blur: Number.isFinite(blur) ? Math.round(Math.max(0, Math.min(100, blur))) : DEFAULT_APPEARANCE.blur,
    text: TEXT_SIZES.includes(r.text as TextSize) ? (r.text as TextSize) : DEFAULT_APPEARANCE.text,
    corners: CORNERS.includes(r.corners as Corners) ? (r.corners as Corners) : DEFAULT_APPEARANCE.corners,
    cards: CARD_SIZES.includes(r.cards as CardSize) ? (r.cards as CardSize) : DEFAULT_APPEARANCE.cards,
    calm: typeof r.calm === 'boolean' ? r.calm : DEFAULT_APPEARANCE.calm,
    font: FONTS.includes(r.font as FontChoice) ? (r.font as FontChoice) : DEFAULT_APPEARANCE.font,
    density: DENSITIES.includes(r.density as Density) ? (r.density as Density) : DEFAULT_APPEARANCE.density,
    contrast: typeof r.contrast === 'boolean' ? r.contrast : DEFAULT_APPEARANCE.contrast,
    previews: typeof r.previews === 'boolean' ? r.previews : DEFAULT_APPEARANCE.previews,
    avatars: AVATAR_MOTIONS.includes(r.avatars as AvatarMotion) ? (r.avatars as AvatarMotion) : DEFAULT_APPEARANCE.avatars,
    pattern: PATTERNS.includes(r.pattern as Pattern) ? (r.pattern as Pattern) : DEFAULT_APPEARANCE.pattern,
    patternStrength: clampNumber(r.patternStrength, 0, 100, DEFAULT_APPEARANCE.patternStrength),
    patternScale: clampNumber(r.patternScale, 50, 200, DEFAULT_APPEARANCE.patternScale),
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : fallback;
}

/** Atributy a proměnné pro <html> - jediné místo, které říká, jak se vzhled projeví. */
export function appearanceAttributes(
  theme: Theme,
  a: Appearance
): { attrs: Record<string, string | null>; glassK: string; blurK: string; patternK: string; patternScale: string } {
  return {
    attrs: {
      // Tmavý je výchozí (bez atributu); CSS zná html[data-theme="gray|light"].
      'data-theme': theme,
      'data-look': a.look === 'glass' ? 'glass' : null,
      'data-backdrop': a.backdrop,
      'data-ambient': a.ambient ? '1' : '0',
      'data-motion': a.motion ? '1' : null,
      // Výchozí hodnoty bez atributu - CSS řeší jen odchylky.
      'data-text': a.text === 'm' ? null : a.text,
      'data-corners': a.corners === 'normal' ? null : a.corners,
      'data-cards': a.cards === 'm' ? null : a.cards,
      'data-calm': a.calm ? '1' : null,
      'data-font': a.font === 'inter' ? null : a.font,
      'data-density': a.density === 'normal' ? null : a.density,
      'data-contrast': a.contrast ? '1' : null,
      'data-previews': a.previews ? null : '0',
      'data-anim': a.avatars === 'hover' ? null : a.avatars,
      'data-pattern': a.pattern === 'none' ? null : a.pattern,
    },
    glassK: String(a.strength / 100),
    blurK: String(a.blur / 100),
    patternK: String(a.patternStrength / 100),
    patternScale: String(a.patternScale / 100),
  };
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readTheme(): Theme {
  try {
    return parseTheme(storage()?.getItem(THEME_KEY));
  } catch {
    return 'dark';
  }
}

export function readAppearance(): Appearance {
  try {
    const raw = storage()?.getItem(APPEARANCE_KEY);
    return sanitizeAppearance(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** Promítne motiv a vzhled do <html> (bez ukládání). */
export function applyAppearance(theme: Theme, a: Appearance): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { attrs, glassK, blurK, patternK, patternScale } = appearanceAttributes(theme, a);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
  root.style.setProperty('--glass-k', glassK);
  root.style.setProperty('--blur-k', blurK);
  root.style.setProperty('--pattern-k', patternK);
  root.style.setProperty('--pattern-scale', patternScale);
}

// ---- vlastní vzor (dlaždice) -------------------------------------------------------

/** Uložený vlastní vzor (data URL), nebo null. */
export function readPatternImage(): string | null {
  try {
    const value = storage()?.getItem(PATTERN_IMAGE_KEY) ?? null;
    return value && /^data:image\/(jpeg|png|webp);base64,/.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Uloží (nebo smaže, null) vlastní vzor. false = nevešel se do paměti prohlížeče. */
export function savePatternImage(dataUrl: string | null): boolean {
  try {
    const s = storage();
    if (!s) return false;
    if (dataUrl) s.setItem(PATTERN_IMAGE_KEY, dataUrl);
    else s.removeItem(PATTERN_IMAGE_KEY);
  } catch {
    return false;
  }
  announce();
  return true;
}

/**
 * Obrázek z disku -> dlaždice vzoru (nejvýš 480 px, s průhledností jako PNG/WebP),
 * ať se vejde do paměti prohlížeče. null = nejde přečíst.
 */
export async function patternImageFromFile(file: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, 480 / Math.max(1, bitmap.width), 480 / Math.max(1, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // WebP (menší, s průhledností); prohlížeč, který ho neumí, vrátí PNG.
  const url = canvas.toDataURL('image/webp', 0.9);
  return /^data:image\/(webp|png);base64,/.test(url) ? url : null;
}

// ---- vlastní obrázek za sklem ------------------------------------------------------

/** Uložený vlastní obrázek (data URL), nebo null. */
export function readBackdropImage(): string | null {
  try {
    const value = storage()?.getItem(BACKDROP_IMAGE_KEY) ?? null;
    return value && /^data:image\/(jpeg|png|webp);base64,/.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Uloží (nebo smaže, null) vlastní obrázek. Vrací false, když se do paměti prohlížeče nevešel. */
export function saveBackdropImage(dataUrl: string | null): boolean {
  try {
    const s = storage();
    if (!s) return false;
    if (dataUrl) s.setItem(BACKDROP_IMAGE_KEY, dataUrl);
    else s.removeItem(BACKDROP_IMAGE_KEY);
  } catch {
    return false;
  }
  announce();
  return true;
}

/**
 * Obrázek z disku -> menší JPEG jako data URL (nejvýš 1280 px na šířku,
 * ~100-200 kB), ať se vejde do paměti prohlížeče. null = nejde přečíst.
 */
export async function backdropImageFromFile(file: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, 1280 / Math.max(1, bitmap.width), 1280 / Math.max(1, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL('image/jpeg', 0.82);
  return url.startsWith('data:image/jpeg') ? url : null;
}

function announce(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

export function saveTheme(theme: Theme): void {
  try {
    storage()?.setItem(THEME_KEY, theme);
  } catch {
    // Soukromé okno / plná paměť - vzhled platí aspoň do zavření stránky.
  }
  applyAppearance(theme, readAppearance());
  announce();
}

export function saveAppearance(a: Appearance): void {
  const clean = sanitizeAppearance(a);
  try {
    storage()?.setItem(APPEARANCE_KEY, JSON.stringify(clean));
  } catch {
    // viz výš
  }
  applyAppearance(readTheme(), clean);
  announce();
}

// ---- pozadí "podle videa" ---------------------------------------------------------

/**
 * Obrázek, ze kterého se bere barevné pozadí skla (a nic jiného): náhled
 * videa, na které se díváš, snímek přenosu, banner kanálu. Stránka ho
 * nastaví, když se otevře, a uklidí, když se zavře.
 */
let ambientSource: string | null = null;
const ambientListeners = new Set<(url: string | null) => void>();

export function setAmbientSource(url: string | null | undefined): void {
  const next = url && /^(https?:)?\/\//.test(url) ? url : null;
  if (next === ambientSource) return;
  ambientSource = next;
  for (const fn of ambientListeners) fn(next);
}

export function currentAmbientSource(): string | null {
  return ambientSource;
}

export function onAmbientSource(fn: (url: string | null) => void): () => void {
  ambientListeners.add(fn);
  return () => {
    ambientListeners.delete(fn);
  };
}

/**
 * Skript do <head> (app/layout.tsx): nastaví <html> podle uloženého vzhledu
 * ještě před prvním vykreslením. Schválně samostatný a malý - nesmí nic
 * importovat a při jakékoli chybě nechá výchozí vzhled.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=window.localStorage;var t=s.getItem('${THEME_KEY}');if(t==='gray'||t==='light'||t==='dark')d.setAttribute('data-theme',t);var a=null;try{a=JSON.parse(s.getItem('${APPEARANCE_KEY}')||'null')}catch(e){}a=a&&typeof a==='object'?a:{};if(a.look==='glass')d.setAttribute('data-look','glass');var b=${JSON.stringify(BACKDROPS)};d.setAttribute('data-backdrop',b.indexOf(a.backdrop)>=0?a.backdrop:'auto');d.setAttribute('data-ambient',a.ambient===false?'0':'1');if(a.motion===true)d.setAttribute('data-motion','1');if(a.text==='s'||a.text==='l')d.setAttribute('data-text',a.text);if(a.corners==='sharp'||a.corners==='round')d.setAttribute('data-corners',a.corners);if(a.cards==='s'||a.cards==='l')d.setAttribute('data-cards',a.cards);if(a.calm===true)d.setAttribute('data-calm','1');var f=${JSON.stringify(FONTS)};if(a.font!=='inter'&&f.indexOf(a.font)>=0)d.setAttribute('data-font',a.font);if(a.density==='compact'||a.density==='comfy')d.setAttribute('data-density',a.density);if(a.contrast===true)d.setAttribute('data-contrast','1');if(a.previews===false)d.setAttribute('data-previews','0');if(a.avatars==='always'||a.avatars==='never')d.setAttribute('data-anim',a.avatars);var pt=${JSON.stringify(PATTERNS)};if(a.pattern&&a.pattern!=='none'&&pt.indexOf(a.pattern)>=0)d.setAttribute('data-pattern',a.pattern);var pk=Number(a.patternStrength);d.style.setProperty('--pattern-k',String((isFinite(pk)?Math.max(0,Math.min(100,pk)):${DEFAULT_APPEARANCE.patternStrength})/100));var ps=Number(a.patternScale);d.style.setProperty('--pattern-scale',String((isFinite(ps)?Math.max(50,Math.min(200,ps)):${DEFAULT_APPEARANCE.patternScale})/100));var k=Number(a.strength);d.style.setProperty('--glass-k',String((isFinite(k)?Math.max(0,Math.min(100,k)):${DEFAULT_APPEARANCE.strength})/100));var u=Number(a.blur);d.style.setProperty('--blur-k',String((isFinite(u)?Math.max(0,Math.min(100,u)):${DEFAULT_APPEARANCE.blur})/100))}catch(e){}})();`;

/**
 * Snímek z videa v daném čase (Cloudflare umí náhled odkudkoli z videa) -
 * pro pozadí, které sleduje obraz. Malý (výška 72 px): z obrázku zůstanou
 * jen barvy, stahuje se jen pár kB. Po celých sekundách - snímek každou
 * sekundu a plynulé prolínání (components/AmbientCanvas.tsx) dají barvy,
 * které se s obrazem přelévají pořád, ne skokem jednou za čas. Stejná
 * sekunda = stejná adresa, takže se snímek z mezipaměti nestahuje znovu.
 */
export const FOLLOW_VIDEO_MS = 1000;
export const FOLLOW_LIVE_MS = 2000;

export function videoFrameUrl(videoIdOrToken: string, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `https://videodelivery.net/${encodeURIComponent(videoIdOrToken)}/thumbnails/thumbnail.jpg?time=${t}s&height=72`;
}

/** Poslední snímek živého přenosu (adresa se mění po FOLLOW_LIVE_MS, ať ho mezipaměť nedrží). */
export function liveFrameUrl(liveUid: string, now: number): string {
  return `https://videodelivery.net/${encodeURIComponent(liveUid)}/thumbnails/thumbnail.jpg?height=72&t=${Math.floor(now / FOLLOW_LIVE_MS)}`;
}

/** Obrázek se nejdřív načte, pak se ukáže - pozadí nikdy nepřebliká do prázdna. */
export function preloadImage(url: string, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(false);
    const img = new Image();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.src = url;
  });
}
