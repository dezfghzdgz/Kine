/**
 * Automatická kontrola nahoty a porna - pravidla (čistá logika bez
 * databáze a bez modelu, tests/nudityRules.test.mjs).
 *
 * Model (nsfwjs, lib/nudityScan.ts) dá u každého snímku pět čísel 0-1:
 *   porn     pornografie, sex
 *   hentai   pornografická kresba / anime
 *   sexy     nahota a odhalená těla bez sexu (akt, spodní prádlo...)
 *   drawing  běžná kresba, neutral běžný obraz
 *
 * Co se s videem stane:
 *   hold    video se hned skryje (soukromé), dokud ho nezkontroluje
 *           moderátor - porno vždycky, nahota jen když autor neoznačil
 *           video jako umění;
 *   review  video zůstane venku, ale jde do fronty ke kontrole
 *           (slabší signál, nebo nahota u videa označeného jako umění);
 *   ok      nic.
 * Model se plete (plavky, zápas, kůže zblízka) - proto rozhoduje
 * o skrytí až víc snímků nebo velmi jistý jeden, a vždycky to potom
 * vidí člověk. Umění posoudí moderátor; porno uměním není.
 */

export type FrameScores = { porn: number; hentai: number; sexy: number; neutral: number; drawing: number };

export const NUDITY_RULES = {
  /** Jeden snímek s pornem / hentai aspoň takhle jistě -> skrýt. */
  holdPornAny: 0.85,
  /** Dva a víc snímků s pornem aspoň takhle -> skrýt. */
  holdPornRepeat: 0.6,
  /** Dva a víc snímků s nahotou aspoň takhle -> skrýt (u umění jen ke kontrole). */
  holdNudityRepeat: 0.92,
  /** Jakýkoli snímek s pornem aspoň takhle -> ke kontrole. */
  reviewPorn: 0.5,
  /** Jakýkoli snímek s nahotou aspoň takhle -> ke kontrole. */
  reviewNudity: 0.8,
} as const;

export type NudityAction = 'ok' | 'review' | 'hold';
export type NudityVerdict = { action: NudityAction; reason: 'porn' | 'nudity' | null; worst: number };

const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Výsledek modelu (pole {className, probability}) -> čísla snímku. */
export function framesFromPredictions(predictions: { className: string; probability: number }[]): FrameScores {
  const get = (name: string) => clamp01(predictions.find((p) => p.className.toLowerCase() === name)?.probability);
  return { porn: get('porn'), hentai: get('hentai'), sexy: get('sexy'), neutral: get('neutral'), drawing: get('drawing') };
}

export function pornScore(f: FrameScores): number {
  return Math.min(1, clamp01(f.porn) + clamp01(f.hentai));
}

export function nudityVerdict(frames: FrameScores[], options: { artistic?: boolean } = {}): NudityVerdict {
  if (frames.length === 0) return { action: 'ok', reason: null, worst: 0 };
  const porn = frames.map(pornScore);
  const sexy = frames.map((f) => clamp01(f.sexy));
  const worst = Math.max(...porn, ...sexy);
  const R = NUDITY_RULES;

  if (porn.some((p) => p >= R.holdPornAny) || porn.filter((p) => p >= R.holdPornRepeat).length >= 2) {
    return { action: 'hold', reason: 'porn', worst };
  }
  if (sexy.filter((s) => s >= R.holdNudityRepeat).length >= 2) {
    return { action: options.artistic ? 'review' : 'hold', reason: 'nudity', worst };
  }
  if (porn.some((p) => p >= R.reviewPorn)) return { action: 'review', reason: 'porn', worst };
  if (sexy.some((s) => s >= R.reviewNudity)) return { action: 'review', reason: 'nudity', worst };
  return { action: 'ok', reason: null, worst };
}

/**
 * Kdy ve videu brát snímky (sekundy): 4-6 snímků rovnoměrně mezi 5 a 95 %
 * délky (delší video víc - snímek trvá na serveru ~1,5 s, celá kontrola se
 * musí vejít do minuty). Krátké video aspoň začátek a půlku.
 */
export function scanTimes(durationSeconds: number): number[] {
  const d = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  if (d < 1) return [0];
  if (d < 6) return [0, Math.floor(d / 2)];
  const n = Math.max(4, Math.min(6, Math.round(d / 30) + 3));
  const times = new Set<number>();
  for (let i = 0; i < n; i++) times.add(Math.floor(d * (0.05 + (0.9 * i) / (n - 1))));
  return [...times].sort((a, b) => a - b);
}

// ---- živé vysílání ----------------------------------------------------------------

/** Snímek z přenosu: 'severe' skryje hned, 'explicit' a 'suspect' se sčítají. */
export type LiveLevel = 'ok' | 'suspect' | 'explicit' | 'severe';
export type LiveStrike = { at: number; level: Exclude<LiveLevel, 'ok'> };

export const LIVE_RULES = {
  severePorn: 0.95,
  explicitPorn: 0.85,
  explicitNudity: 0.95,
  suspectPorn: 0.6,
  suspectNudity: 0.85,
  /** Okno, ve kterém se snímky sčítají. */
  windowMs: 10 * 60 * 1000,
} as const;

export function liveSnapshotLevel(f: FrameScores): LiveLevel {
  const p = pornScore(f);
  const s = clamp01(f.sexy);
  if (p >= LIVE_RULES.severePorn) return 'severe';
  if (p >= LIVE_RULES.explicitPorn || s >= LIVE_RULES.explicitNudity) return 'explicit';
  if (p >= LIVE_RULES.suspectPorn || s >= LIVE_RULES.suspectNudity) return 'suspect';
  return 'ok';
}

/** Přidá snímek k nedávným a zahodí staré (víc než okno, nejvýš 10 záznamů). */
export function addLiveStrike(strikes: unknown, level: LiveLevel, now: number): LiveStrike[] {
  const recent = (Array.isArray(strikes) ? strikes : [])
    .filter((s): s is LiveStrike => !!s && typeof s.at === 'number' && ['suspect', 'explicit', 'severe'].includes(s.level))
    .filter((s) => now - s.at <= LIVE_RULES.windowMs);
  if (level !== 'ok') recent.push({ at: now, level });
  return recent.slice(-10);
}

/**
 * Skrýt přenos? Hned při jednom velmi jistém snímku s pornem, jinak při
 * dvou jasných nebo třech podezřelých během 10 minut - jeden divný snímek
 * (rychlý střih, kůže zblízka) přenos neshodí.
 */
export function liveShouldHide(strikes: LiveStrike[], now: number): boolean {
  const recent = strikes.filter((s) => now - s.at <= LIVE_RULES.windowMs);
  if (recent.some((s) => s.level === 'severe')) return true;
  if (recent.filter((s) => s.level !== 'suspect').length >= 2) return true;
  return recent.length >= 3;
}
