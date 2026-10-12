/**
 * Vlastní přehrávač videí na stránce videa (lib/vodPlayer.ts) - čistá
 * rozhodnutí bez prohlížeče, ať se dají vyzkoušet testem
 * (tests/vodPlayer.test.mjs).
 *
 * PROČ VLASTNÍ PŘEHRÁVAČ
 *
 * Videa dřív hrál iframe Cloudflare. U delších videí se rozjížděl
 * dlouho - hlavně při navázání uprostřed (pokračování, kde divák skončil),
 * a dovnitř se nedalo nijak sáhnout: ani na kvalitu prvního kusu, ani na
 * to, jak dlouho čekat na kus, který Cloudflare zrovna nevydá.
 * Teď hraje <video> s HLS od Cloudflare (Safari sám, ostatní přes hls.js -
 * stejně jako hudba):
 *  - první kus v nižší kvalitě (malý - rozjede se hned), pak sama vyskočí,
 *  - načítá rovnou od místa, kde se pokračuje,
 *  - zaseknutý kus se po pár vteřinách zkusí znovu (výchozí hls.js čeká
 *    až dvě minuty),
 *  - statistiky (proč to trvalo) a volba kvality.
 * Když to v prohlížeči nejde, nebo se něco rozbije, stránka sama přepne
 * na iframe Cloudflare jako dřív.
 */

/** Bez paměti: první kus kolem 360p (Cloudflare ~0,8 Mb/s) - malý, rozjede se rychle; kvalita pak vyskočí sama. */
export const DEFAULT_START_BPS = 1_000_000;
/** Nejvýš tak "vysoko" se začíná i na rychlém připojení (~720p) - první kus musí zůstat malý. */
export const MAX_START_BPS = 3_000_000;
/** Pod tohle odhad nejde (aspoň nejnižší kvalita). */
const MIN_START_BPS = 300_000;

/**
 * Odhad připojení, se kterým přehrávač začíná (hls.js abrEwmaDefaultEstimate).
 * Z minulého přehrávání (zapamatovaný odhad) se bere jen část a s horní
 * hranicí: první kus má být malý, i když je připojení rychlé.
 */
export function startEstimate(rememberedBps: number | null | undefined): number {
  if (!rememberedBps || !Number.isFinite(rememberedBps) || rememberedBps <= 0) return DEFAULT_START_BPS;
  return Math.round(Math.max(MIN_START_BPS, Math.min(MAX_START_BPS, rememberedBps * 0.6)));
}

export type EngineChoice = 'native' | 'iframe';

/** Vlastní přehrávač, nebo iframe Cloudflare? (vynucený Cloudflare = ?player=cloudflare, záchrana při potížích) */
export function chooseEngine(opts: { nativeHls: boolean; mse: boolean; forceCloudflare: boolean }): EngineChoice {
  if (opts.forceCloudflare) return 'iframe';
  return opts.nativeHls || opts.mse ? 'native' : 'iframe';
}

export type QualityLevel = { index: number; height: number; bitrateKbps: number };

/** "1080p" z výšky obrazu. */
export function qualityLabel(height: number | null | undefined): string {
  return height && height > 0 ? `${Math.round(height)}p` : '?';
}

/**
 * Nabídka kvality z úrovní hls.js: od nejvyšší, každá výška jednou
 * (u stejné výšky ta s vyšším datovým tokem). index = pořadí úrovně v hls.js.
 */
export function qualityOptions(levels: ReadonlyArray<{ height?: number; bitrate?: number } | null | undefined>): QualityLevel[] {
  const best = new Map<number, QualityLevel>();
  levels.forEach((level, index) => {
    const height = Math.round(Number(level?.height) || 0);
    if (height <= 0) return;
    const bitrateKbps = Math.round((Number(level?.bitrate) || 0) / 1000);
    const known = best.get(height);
    if (!known || bitrateKbps > known.bitrateKbps) best.set(height, { index, height, bitrateKbps });
  });
  return [...best.values()].sort((a, b) => b.height - a.height);
}

/** Jeden načtený kus videa: kvalita, první bajt, celé načtení, velikost, délka obrazu. */
export type FragmentSample = { height: number; ttfbMs: number; loadMs: number; kb: number; seconds: number };

/**
 * Vzorek z hls.js statistik načtení kusu (stats.loading.start/first/end
 * v ms, stats.loaded v bajtech). null = nesmyslné údaje.
 */
export function fragmentSample(stats: any, height: number, seconds: number): FragmentSample | null {
  const start = Number(stats?.loading?.start);
  const first = Number(stats?.loading?.first);
  const end = Number(stats?.loading?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const ttfb = Number.isFinite(first) && first >= start && first <= end ? first - start : end - start;
  const bytes = Number(stats?.loaded) || Number(stats?.total) || 0;
  return {
    height: Math.max(0, Math.round(Number(height) || 0)),
    ttfbMs: Math.round(ttfb),
    loadMs: Math.round(end - start),
    kb: Math.round(bytes / 1024),
    seconds: Math.round((Number(seconds) || 0) * 10) / 10,
  };
}

/** Rychlost přenosu kusu v kb/s (bez čekání na první bajt). null = nejde spočítat. */
export function fragmentKbps(f: FragmentSample | null | undefined): number | null {
  if (!f || f.kb <= 0) return null;
  const transferMs = Math.max(1, f.loadMs - f.ttfbMs);
  // bity za milisekundu = kilobity za sekundu
  return Math.round((f.kb * 1024 * 8) / transferMs);
}

/** První bajt kusu nad tohle = Cloudflare kus nemá po ruce (čeká se na něj u nich). */
export const SLOW_SERVER_TTFB_MS = 1500;
/** Seznam kvalit (manifest) nad tohle = pomalá odpověď Cloudflare. */
export const SLOW_SERVER_MANIFEST_MS = 2500;
/** Pod tohle připojení nestačí na 720p. */
export const SLOW_CONNECTION_KBPS = 3000;

export type VodVerdict = 'waiting' | 'ok' | 'slow-server' | 'slow-connection';

/** Proč se video načítá pomalu - podle seznamu kvalit, prvního kusu a odhadu připojení. */
export function vodVerdict(s: { manifestMs: number | null; firstFragment: FragmentSample | null; bandwidthKbps: number | null }): VodVerdict {
  if ((s.manifestMs ?? 0) > SLOW_SERVER_MANIFEST_MS) return 'slow-server';
  const f = s.firstFragment;
  if (!f) return 'waiting';
  if (f.ttfbMs > SLOW_SERVER_TTFB_MS) return 'slow-server';
  const kbps = s.bandwidthKbps ?? fragmentKbps(f);
  if (kbps !== null && kbps < SLOW_CONNECTION_KBPS) return 'slow-connection';
  return 'ok';
}

/** Rozjezd delší než tohle se nahlásí (/admin/errors) - jednou za zobrazení videa. */
export const SLOW_START_REPORT_MS = 6000;
/** Tolik zaseknutí během přehrávání se nahlásí taky. */
export const STALLS_REPORT = 3;

/**
 * Stojí to za hlášení? Pomalý rozjezd, video se po dlouhé době pořád
 * nerozjelo (a nečeká se na klepnutí diváka), nebo se opakovaně zasekává.
 */
export function shouldReportSlowStart(s: { firstFrameMs: number | null; waitedMs: number; stalls: number; waitingForTap: boolean }): boolean {
  if (s.firstFrameMs !== null) return s.firstFrameMs > SLOW_START_REPORT_MS || s.stalls >= STALLS_REPORT;
  return !s.waitingForTap && s.waitedMs > 2.5 * SLOW_START_REPORT_MS;
}

/** Mb/s z kb/s, na jedno desetinné místo. */
export function mbps(kbps: number | null | undefined): string {
  return kbps && kbps > 0 ? (kbps / 1000).toFixed(1) : '?';
}

/** Údaje přehrávače, ze kterých se skládá technický souhrn (VodStats z lib/vodPlayer.ts). */
export type StatsSnapshot = {
  engine: string;
  host: string;
  manifestMs: number | null;
  firstFrameMs: number | null;
  firstFragment: FragmentSample | null;
  recent: FragmentSample[];
  height: number | null;
  bitrateKbps: number | null;
  bandwidthKbps: number | null;
  stalls: number;
  retries: number;
  lastError: string | null;
};

function sampleText(f: FragmentSample): string {
  return `${qualityLabel(f.height)} ${f.seconds}s ttfb=${f.ttfbMs}ms load=${f.loadMs}ms ${f.kb}KB`;
}

/**
 * Technický souhrn na jeden zápis (Kopírovat v panelu statistik, hlášení
 * pomalého videa do /admin/errors) - stejný v každém jazyce.
 */
export function statsReport(
  s: StatsSnapshot,
  extra: { videoId?: string | null; durationS?: number | null; startAt?: number | null; bufferedAheadS?: number | null; waitedMs?: number | null } = {}
): string {
  const lines = [
    `verdict=${vodVerdict(s)} engine=${s.engine} host=${s.host || '?'}`,
    `video=${extra.videoId ?? '?'} duration=${extra.durationS ? Math.round(extra.durationS) + 's' : '?'} startAt=${extra.startAt ? Math.round(extra.startAt) + 's' : '0'}`,
    `firstFrame=${s.firstFrameMs !== null ? s.firstFrameMs + 'ms' : `none(waited ${extra.waitedMs !== null && extra.waitedMs !== undefined ? Math.round(extra.waitedMs) + 'ms' : '?'})`} manifest=${s.manifestMs !== null ? s.manifestMs + 'ms' : '?'}`,
    `firstChunk=${s.firstFragment ? sampleText(s.firstFragment) : '?'}`,
    `now=${qualityLabel(s.height)} ${s.bitrateKbps ? mbps(s.bitrateKbps) + 'Mb/s' : ''} bandwidth=${mbps(s.bandwidthKbps)}Mb/s buffer=${extra.bufferedAheadS !== null && extra.bufferedAheadS !== undefined ? extra.bufferedAheadS.toFixed(1) + 's' : '?'}`,
    `stalls=${s.stalls} retries=${s.retries}${s.lastError ? ` lastError=${s.lastError}` : ''}`,
    ...s.recent.map((f, i) => `chunk${i + 1}: ${sampleText(f)}`),
  ];
  return lines.join('\n');
}
