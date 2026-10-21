/**
 * Kvalita videa podle signálu: plná, a nižší (komprese) jen při slabém připojení.
 *
 * Režim "light" (šetřit data): přehrávač začíná a zůstává v nižší kvalitě,
 * přednačítá se jen jedno další video, náhledy po najetí se nestahují.
 * Režim "full": kvalitu volí přehrávač podle připojení.
 *
 * Výchozí je VŽDYCKY plná kvalita (i na mobilu). Light jen když:
 *  - si to člověk vybral (Nastavení -> Přehrávání -> Šetřit data),
 *  - prohlížeč řekne, že je připojení pomalé nebo že se mají šetřit data
 *    (Android, Chrome: navigator.connection - iPhone to neprozradí),
 *  - nebo to Kine změří: video v plné kvalitě se zasekávalo (2× a víc),
 *    nebo se dvakrát po sobě rozjíždělo přes 5 s.
 * Lehký režim nedrží napořád: po 10 minutách bez potíží (a hned, jak se
 * lehké video rozjede rychle a bez zaseknutí a plná kvalita naposledy potíže
 * neměla) je zase plná kvalita. Dřív se z lehkého režimu na iPhonu skoro
 * nedalo dostat (rozjezd pod 0,7 s) a video bylo pořád rozmazané.
 *
 * Čistá rozhodnutí (bez prohlížeče) mají test: tests/netQuality.test.mjs.
 */

export type DataSaverPref = 'auto' | 'save' | 'best';
export type PlaybackMode = 'light' | 'full';

export const DATA_SAVER_KEY = 'kine-data-saver';
const SAMPLES_KEY = 'kine-net-samples';
const MODE_KEY = 'kine-net-mode';

/**
 * Rozjezdy (a zapamatovaný režim) starší než tohle se nepočítají - připojení
 * se mění (doma wifi, venku data). Po téhle době se zkusí zase plná kvalita.
 */
export const SAMPLE_MAX_AGE_MS = 10 * 60 * 1000;
/** Rozjezd plné kvality delší než tohle, dvakrát po sobě = slabé připojení. */
export const SLOW_START_MS = 5000;
/** Kolik zaseknutí během jednoho videa v plné kvalitě znamená slabé připojení. */
export const SLOW_STALLS = 2;
/** Rozjezd kratší než tohle a bez zaseknutí = připojení stačí na plnou kvalitu. */
export const FAST_START_MS = 3000;
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

/**
 * Ze změřených rozjezdů: slabé / dobré připojení / nejde říct.
 *
 * Slabé: poslední video v plné kvalitě se zasekávalo (SLOW_STALLS a víc),
 * plná kvalita se dvakrát po sobě rozjížděla přes SLOW_START_MS, nebo se
 * zasekává i lehká kvalita. Dokud je taková potíž v posledních 10 minutách,
 * zůstává lehký režim (žádné přeskakování tam a zpět u každého videa).
 * Dobré: poslední video se rozjelo do FAST_START_MS a bez zaseknutí.
 */
export function measuredVerdict(samples: readonly StartSample[], now: number = Date.now()): 'slow' | 'fast' | null {
  const recent = samples
    .filter((s) => s && now - s.at < SAMPLE_MAX_AGE_MS && now - s.at >= -60_000 && Number.isFinite(s.firstFrameMs) && s.firstFrameMs >= 0)
    .slice(-4);
  if (recent.length === 0) return null;
  const stallsOf = (s: StartSample) => Number(s.stalls) || 0;
  const full = recent.filter((s) => s.mode !== 'light');
  const lastFull = full[full.length - 1];
  if (lastFull && stallsOf(lastFull) >= SLOW_STALLS) return 'slow';
  const lastTwoFull = full.slice(-2);
  if (lastTwoFull.length === 2 && lastTwoFull.every((s) => s.firstFrameMs > SLOW_START_MS)) return 'slow';
  const last = recent[recent.length - 1];
  if (last.mode === 'light' && stallsOf(last) >= 1) return 'slow';
  if (stallsOf(last) === 0 && last.firstFrameMs < FAST_START_MS) return 'fast';
  return null;
}

/**
 * Režim přehrávání. Volba člověka má přednost; v "auto" rozhoduje prohlížeč
 * (když něco ví) a změřené rozjezdy. `previous` = režim z posledních 10 minut
 * (starší se nepočítá - pak plná kvalita).
 */
export function decideMode(pref: DataSaverPref, hint: boolean | null, measured: 'slow' | 'fast' | null, previous: PlaybackMode | null = null): PlaybackMode {
  if (pref === 'save') return 'light';
  if (pref === 'best') return 'full';
  if (hint === true) return 'light';
  if (measured === 'slow') return 'light';
  if (measured === 'fast') return 'full';
  return previous ?? 'full';
}

/**
 * Co uložit jako zapamatovaný režim. Čas se obnoví jen když pro režim je čerstvý
 * důvod (měření, prohlížeč, volba člověka) nebo se režim mění - jinak by se lehký
 * režim jen opakováním přepisoval s novým časem a nikdy by nevypršel.
 */
export function nextModeRecord(
  previous: { mode: PlaybackMode; at: number } | null,
  mode: PlaybackMode,
  freshReason: boolean,
  now: number = Date.now()
): { mode: PlaybackMode; at: number } {
  if (!freshReason && previous && previous.mode === mode && now - previous.at < SAMPLE_MAX_AGE_MS) return previous;
  return { mode, at: now };
}

/** Zapamatovaný režim (s časem); starší než SAMPLE_MAX_AGE_MS nebo staré uložení bez času = žádný. */
export function freshMode(raw: string | null | undefined, now: number = Date.now()): PlaybackMode | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && (v.mode === 'light' || v.mode === 'full') && typeof v.at === 'number' && now - v.at < SAMPLE_MAX_AGE_MS) return v.mode;
  } catch {
    // staré uložení ("light") - bez času se nepočítá
  }
  return null;
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
  return freshMode(storage()?.getItem(MODE_KEY));
}

function previousRecord(): { mode: PlaybackMode; at: number } | null {
  const raw = storage()?.getItem(MODE_KEY);
  const mode = freshMode(raw);
  if (!mode || !raw) return null;
  try {
    return { mode, at: Number(JSON.parse(raw).at) };
  } catch {
    return null;
  }
}

/** Rozhodne režim po novém měření a uloží ho (čas jen s čerstvým důvodem - nextModeRecord). */
function decideAndSave(samples: StartSample[]): void {
  const pref = dataSaverPref();
  const hint = connectionSlow(browserConnection());
  const measured = measuredVerdict(samples);
  const mode = decideMode(pref, hint, measured, previousMode());
  const record = nextModeRecord(previousRecord(), mode, measured !== null || hint === true || pref !== 'auto');
  storage()?.setItem(MODE_KEY, JSON.stringify(record));
}

export type LightReason = 'pref' | 'hint' | 'measured' | null;

/**
 * Režim a proč: 'pref' = člověk si vybral šetření dat, 'hint' = prohlížeč hlásí pomalé
 * připojení / šetření dat, 'measured' = Kine naměřilo potíže (jen tehdy smí přehrávač
 * sám přepnout zpátky na plnou kvalitu, když se signál zlepší).
 */
export function playbackDecision(now: number = Date.now()): { mode: PlaybackMode; reason: LightReason } {
  const pref = dataSaverPref();
  const hint = connectionSlow(browserConnection());
  const mode = decideMode(pref, hint, measuredVerdict(readSamples(), now), previousMode());
  if (mode !== 'light') return { mode, reason: null };
  if (pref === 'save') return { mode, reason: 'pref' };
  if (hint === true) return { mode, reason: 'hint' };
  return { mode, reason: 'measured' };
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
    decideAndSave(samples);
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
    decideAndSave(samples);
  } catch {
    // nic
  }
}

/** Náhledy videa po najetí myší: ne při šetření dat / pomalém připojení. */
export function previewsAllowed(): boolean {
  return playbackMode() === 'full';
}
