/**
 * Video na mobilních datech: napřed lehčí, při dobrém připojení plná kvalita.
 *
 * Režim "light" (šetřit data): přehrávač začíná a zůstává v nižší kvalitě,
 * přednačítá se jen jedno další video, náhledy po najetí se nestahují.
 * Režim "full": kvalitu volí přehrávač podle připojení jako dřív.
 *
 * Kdy light:
 *  - člověk si to vybral (Nastavení -> Přehrávání -> Šetřit data),
 *  - prohlížeč řekne, že je připojení pomalé nebo že se mají šetřit data
 *    (Android, Chrome: navigator.connection - iPhone to neprozradí),
 *  - nebo to Kine změří: poslední videa se rozjížděla dlouho / zasekávala.
 *    Když se pak videa rozjíždějí rychle a bez zaseknutí, vrátí se plná
 *    kvalita ("když bude internet OK, tak bez komprese").
 *
 * Čistá rozhodnutí (bez prohlížeče) mají test: tests/netQuality.test.mjs.
 */

export type DataSaverPref = 'auto' | 'save' | 'best';
export type PlaybackMode = 'light' | 'full';

export const DATA_SAVER_KEY = 'kine-data-saver';
const SAMPLES_KEY = 'kine-net-samples';
const MODE_KEY = 'kine-net-mode';

/** Rozjezdy starší než tohle se nepočítají (připojení se mění - doma wifi, venku data). */
export const SAMPLE_MAX_AGE_MS = 30 * 60 * 1000;
/** Rozjezd delší než tohle = pomalé připojení (medián posledních tří). */
export const SLOW_START_MS = 3000;
/** Rozjezd kratší než tohle (a bez zaseknutí) = připojení stačí na plnou kvalitu. */
export const FAST_START_MS = 1200;
/**
 * V lehkém režimu je rozjezd rychlejší už tím, že je video menší - na návrat
 * k plné kvalitě musí být rychlý víc (jinak by se režim přepínal tam a zpět).
 */
export const FAST_START_LIGHT_MS = 700;
/** Lehký režim: kvalita kolem 480p (Cloudflare vrátí nejbližší kvalitu - clientBandwidthHint, Mb/s). */
export const LIGHT_BANDWIDTH_HINT_MBPS = 1.2;
/** Lehký režim v hls.js: strop datového toku (b/s) a odhad připojení, se kterým začíná. */
export const LIGHT_MAX_BITRATE = 1_600_000;
export const LIGHT_START_ESTIMATE = 600_000;
/** Lehký režim v hls.js se sám zvedne, když odhad připojení vydrží nad tímhle (b/s). */
export const LIGHT_UPGRADE_BANDWIDTH = 6_000_000;

export type ConnectionInfo = { saveData?: boolean; effectiveType?: string; downlink?: number } | null | undefined;

/** Co o připojení řekl prohlížeč: true = pomalé / šetřit data, false = rychlé, null = nevíme (iPhone, Firefox). */
export function connectionSlow(conn: ConnectionInfo): boolean | null {
  if (!conn) return null;
  if (conn.saveData) return true;
  const type = typeof conn.effectiveType === 'string' ? conn.effectiveType : '';
  if (type === 'slow-2g' || type === '2g' || type === '3g') return true;
  const down = typeof conn.downlink === 'number' && Number.isFinite(conn.downlink) ? conn.downlink : null;
  if (down !== null && down > 0 && down < 1.5) return true;
  if (type === '4g' && (down === null || down >= 1.5)) return false;
  return null;
}

export type StartSample = { at: number; firstFrameMs: number; stalls: number; /** V jakém režimu video hrálo. */ mode?: PlaybackMode };

/** Ze změřených rozjezdů: pomalé / rychlé / nejde říct. */
export function measuredVerdict(samples: readonly StartSample[], now: number = Date.now()): 'slow' | 'fast' | null {
  const recent = samples.filter((s) => s && now - s.at < SAMPLE_MAX_AGE_MS && Number.isFinite(s.firstFrameMs) && s.firstFrameMs >= 0).slice(-3);
  if (recent.length === 0) return null;
  const sorted = recent.map((s) => s.firstFrameMs).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const stalls = recent.reduce((sum, s) => sum + (Number(s.stalls) || 0), 0);
  if ((recent.length >= 2 && median > SLOW_START_MS) || stalls >= 3) return 'slow';
  const lastTwo = recent.slice(-2);
  const fast = (s: StartSample) => s.firstFrameMs < (s.mode === 'light' ? FAST_START_LIGHT_MS : FAST_START_MS) && (Number(s.stalls) || 0) === 0;
  if (lastTwo.length === 2 && lastTwo.every(fast)) return 'fast';
  return null;
}

/**
 * Režim přehrávání. Volba člověka má přednost; v "auto" rozhoduje prohlížeč
 * (když něco ví) a změřené rozjezdy - s pamětí, ať režim neskáče u každého
 * videa (`previous` = co platilo minule).
 */
export function decideMode(pref: DataSaverPref, hint: boolean | null, measured: 'slow' | 'fast' | null, previous: PlaybackMode | null = null): PlaybackMode {
  if (pref === 'save') return 'light';
  if (pref === 'best') return 'full';
  if (hint === true) return 'light';
  if (measured === 'slow') return 'light';
  if (measured === 'fast') return 'full';
  return previous ?? 'full';
}

/** Adresa HLS v lehkém režimu: Cloudflare pošle jen kvalitu nejbližší zadanému toku (jen pro Safari - hls.js si kvalitu omezí sám). */
export function lightManifestUrl(url: string, mbps: number = LIGHT_BANDWIDTH_HINT_MBPS): string {
  if (!/\/manifest\/video\.m3u8/.test(url) || /[?&]clientBandwidthHint=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}clientBandwidthHint=${mbps}`;
}

/** Index nejvyšší kvality hls.js do stropu datového toku (lehký režim); -1 = bez stropu (nic se nevešlo). */
export function lightLevelCap(levels: ReadonlyArray<{ bitrate?: number } | null | undefined>, maxBitrate: number = LIGHT_MAX_BITRATE): number {
  let best = -1;
  let bestRate = -1;
  levels.forEach((level, index) => {
    const rate = Number(level?.bitrate) || 0;
    if (rate > 0 && rate <= maxBitrate && rate > bestRate) {
      best = index;
      bestRate = rate;
    }
  });
  return best;
}

// ---- prohlížeč ----------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function dataSaverPref(): DataSaverPref {
  const v = storage()?.getItem(DATA_SAVER_KEY);
  return v === 'save' || v === 'best' ? v : 'auto';
}

export function setDataSaverPref(pref: DataSaverPref): void {
  try {
    if (pref === 'auto') storage()?.removeItem(DATA_SAVER_KEY);
    else storage()?.setItem(DATA_SAVER_KEY, pref);
  } catch {
    // bez úložiště platí jen do zavření
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('kine-net-mode'));
}

function browserConnection(): ConnectionInfo {
  if (typeof navigator === 'undefined') return null;
  return ((navigator as any).connection ?? null) as ConnectionInfo;
}

function readSamples(): StartSample[] {
  try {
    const raw = JSON.parse(storage()?.getItem(SAMPLES_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((s) => s && typeof s.at === 'number').slice(-6) : [];
  } catch {
    return [];
  }
}

function previousMode(): PlaybackMode | null {
  const v = storage()?.getItem(MODE_KEY);
  return v === 'light' || v === 'full' ? v : null;
}

/** Režim pro další video (a přednačítání, náhledy). */
export function playbackMode(now: number = Date.now()): PlaybackMode {
  const mode = decideMode(dataSaverPref(), connectionSlow(browserConnection()), measuredVerdict(readSamples(), now), previousMode());
  return mode;
}

/** Zapíše rozjezd videa (lib/vodPlayer.ts) - podle něj se příště rozhodne režim. */
export function recordStart(firstFrameMs: number, stalls = 0, mode: PlaybackMode = 'full'): void {
  if (!Number.isFinite(firstFrameMs) || firstFrameMs < 0) return;
  const samples = [...readSamples(), { at: Date.now(), firstFrameMs: Math.round(firstFrameMs), stalls: Math.max(0, Math.round(stalls)), mode }].slice(-6);
  try {
    storage()?.setItem(SAMPLES_KEY, JSON.stringify(samples));
    const mode = decideMode(dataSaverPref(), connectionSlow(browserConnection()), measuredVerdict(samples), previousMode());
    storage()?.setItem(MODE_KEY, mode);
  } catch {
    // bez úložiště se měří jen v paměti prohlížeče - příště od začátku
  }
}

/** Zaseknutí během přehrávání - přičte se k poslednímu rozjezdu. */
export function recordStall(): void {
  const samples = readSamples();
  const last = samples[samples.length - 1];
  if (!last || Date.now() - last.at > 10 * 60 * 1000) return;
  last.stalls = (Number(last.stalls) || 0) + 1;
  try {
    storage()?.setItem(SAMPLES_KEY, JSON.stringify(samples));
    storage()?.setItem(MODE_KEY, decideMode(dataSaverPref(), connectionSlow(browserConnection()), measuredVerdict(samples), previousMode()));
  } catch {
    // nic
  }
}

/** Náhledy videa po najetí myší: ne při šetření dat / pomalém připojení. */
export function previewsAllowed(): boolean {
  return playbackMode() === 'full';
}
