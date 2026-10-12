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
 *  - ambientní světlo kolem přehrávače (funguje v obou stylech).
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
 *   data-ambient="1|0" a proměnná --glass-k (síla skla 0-1).
 */

export type Theme = 'dark' | 'gray' | 'light';
export type Look = 'classic' | 'glass';
export type Backdrop = 'auto' | 'brand' | 'night' | 'sunset' | 'forest' | 'ocean' | 'neon';

export type Appearance = {
  look: Look;
  backdrop: Backdrop;
  /** Síla skla 0-100: čím víc, tím průhlednější plochy a výraznější pozadí. */
  strength: number;
  /** Ambientní světlo kolem přehrávače (barvy videa prosvítají kolem něj). */
  ambient: boolean;
};

export const THEMES: readonly Theme[] = ['dark', 'gray', 'light'];
export const LOOKS: readonly Look[] = ['classic', 'glass'];
export const BACKDROPS: readonly Backdrop[] = ['auto', 'brand', 'night', 'sunset', 'forest', 'ocean', 'neon'];

export const THEME_KEY = 'kine-theme';
export const APPEARANCE_KEY = 'kine-appearance';
/** Událost na window, když se vzhled změní (nabídka profilu, pozadí, nastavení). */
export const APPEARANCE_EVENT = 'kine-appearance';

export const DEFAULT_APPEARANCE: Appearance = { look: 'classic', backdrop: 'auto', strength: 55, ambient: true };

export function parseTheme(value: unknown): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : 'dark';
}

/** Cokoli z localStorage (i rozbité / starší) -> platný vzhled. */
export function sanitizeAppearance(raw: unknown): Appearance {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const strength = Number(r.strength);
  return {
    look: LOOKS.includes(r.look as Look) ? (r.look as Look) : DEFAULT_APPEARANCE.look,
    backdrop: BACKDROPS.includes(r.backdrop as Backdrop) ? (r.backdrop as Backdrop) : DEFAULT_APPEARANCE.backdrop,
    strength: Number.isFinite(strength) ? Math.round(Math.max(0, Math.min(100, strength))) : DEFAULT_APPEARANCE.strength,
    ambient: typeof r.ambient === 'boolean' ? r.ambient : DEFAULT_APPEARANCE.ambient,
  };
}

/** Atributy a proměnné pro <html> - jediné místo, které říká, jak se vzhled projeví. */
export function appearanceAttributes(theme: Theme, a: Appearance): { attrs: Record<string, string | null>; glassK: string } {
  return {
    attrs: {
      // Tmavý je výchozí (bez atributu); CSS zná html[data-theme="gray|light"].
      'data-theme': theme,
      'data-look': a.look === 'glass' ? 'glass' : null,
      'data-backdrop': a.backdrop,
      'data-ambient': a.ambient ? '1' : '0',
    },
    glassK: String(a.strength / 100),
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
  const { attrs, glassK } = appearanceAttributes(theme, a);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
  root.style.setProperty('--glass-k', glassK);
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
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=window.localStorage;var t=s.getItem('${THEME_KEY}');if(t==='gray'||t==='light'||t==='dark')d.setAttribute('data-theme',t);var a=null;try{a=JSON.parse(s.getItem('${APPEARANCE_KEY}')||'null')}catch(e){}a=a&&typeof a==='object'?a:{};if(a.look==='glass')d.setAttribute('data-look','glass');var b=${JSON.stringify(BACKDROPS)};d.setAttribute('data-backdrop',b.indexOf(a.backdrop)>=0?a.backdrop:'auto');d.setAttribute('data-ambient',a.ambient===false?'0':'1');var k=Number(a.strength);d.style.setProperty('--glass-k',String((isFinite(k)?Math.max(0,Math.min(100,k)):${DEFAULT_APPEARANCE.strength})/100))}catch(e){}})();`;
