/**
 * Hlášení z appky Kine (Kine Clipper / Kine do PC), že vysílá - čistá
 * logika bez databáze, ať jde vyzkoušet testem (tests/security.test.mjs).
 */

/** Appka hlásí vysílání každých ~15 s; do tolika po posledním hlášení se vysílání bere jako živé, i když ho Cloudflare ještě (nebo už) nehlásí. */
export const APP_PING_FRESH_MS = 45 * 1000;

/**
 * Hlášení z appky bez potvrzení od Cloudflare se bere vážně jen tak dlouho.
 * Cloudflare skutečné vysílání uvidí do pár vteřin; kdo by jen posílal
 * "pořád vysílám" a nic nevysílal, po téhle době z řady "Živě" zmizí.
 */
export const APP_UNCONFIRMED_MAX_MS = 3 * 60 * 1000;

/**
 * Nepotvrzený přenos si Kine tak dlouho pamatuje: když ho appka během té
 * doby "začne" znovu, nedostane nové okno důvěry - jinak by šlo opakovaným
 * "začal jsem" viset v řadě "Živě" donekonečna bez jediného snímku.
 */
export const APP_RESTART_MEMORY_MS = 15 * 60 * 1000;

type SignalRow = {
  app_ping_at?: string | null;
  started_at: string | null;
  checked_at: string | null;
  /** Kdy přenos naposledy viděl Cloudflare (sloupec z migrace bezpecnost-rijen; bez ní se bere checked_at). */
  cf_confirmed_at?: string | null;
};

function ms(value: string | null | undefined): number {
  return value ? new Date(value).getTime() : NaN;
}

export function appPingFresh(row: Pick<SignalRow, 'app_ping_at'>, now: number = Date.now()): boolean {
  return !!row.app_ping_at && now - new Date(row.app_ping_at).getTime() < APP_PING_FRESH_MS;
}

/** Kdy přenos naposledy potvrdil Cloudflare (NaN = nikdy / nevíme). */
export function lastConfirmedAt(row: SignalRow): number {
  return ms(row.cf_confirmed_at !== undefined ? row.cf_confirmed_at : row.checked_at);
}

/**
 * Věří se hlášení z appky? Musí být čerstvé a buď přenos začal před chvílí,
 * nebo ho Cloudflare v tomhle přenosu nedávno viděl (po začátku přenosu,
 * ne z minulého).
 */
export function appSignalTrusted(row: SignalRow, now: number = Date.now()): boolean {
  if (!appPingFresh(row, now)) return false;
  const started = ms(row.started_at);
  if (Number.isFinite(started) && now - started < APP_UNCONFIRMED_MAX_MS) return true;
  const confirmed = lastConfirmedAt(row);
  return (
    Number.isFinite(confirmed) &&
    (!Number.isFinite(started) || confirmed >= started) &&
    now - confirmed < APP_UNCONFIRMED_MAX_MS
  );
}

/**
 * Začátek přenosu, který appka znovu rozjíždí (řádek zrovna není živě).
 * Nový začátek = nové okno důvěry; nepotvrzený přenos z poslední
 * čtvrthodiny si ale nechá ten původní (už prošlý).
 */
export function revivedStartedAt(row: SignalRow, now: number = Date.now()): string {
  const started = ms(row.started_at);
  const confirmed = lastConfirmedAt(row);
  const recent = Number.isFinite(started) && now - started < APP_RESTART_MEMORY_MS;
  const neverConfirmed = !Number.isFinite(confirmed) || confirmed < started;
  return recent && neverConfirmed && row.started_at ? row.started_at : new Date(now).toISOString();
}

// ---- co říká Cloudflare -------------------------------------------------------------

/**
 * Cloudflare přenos v seznamu běžících pořád má, ale vstup zrovna není
 * připojený (OBS / appka se připojuje znovu - Cloudflare na to čeká
 * minutu a pak záznam uzavře). Tak dlouho od posledního potvrzení zůstává
 * přenos v "Živě"; pak zmizí.
 */
export const CF_RECONNECT_GRACE_MS = 60 * 1000;

/**
 * Skončený přenos (video vzniklo před koncem) smí Cloudflare "oživit" až po
 * téhle době: Cloudflare po odpojení minutu čeká na znovupřipojení a video
 * pořád hlásí jako běžící. Nové vysílání (nové video) se ukáže hned.
 */
export const CF_REVIVE_HOLDOFF_MS = 90 * 1000;

/**
 * Cloudflare se nedá zeptat (výpadek, špatný klíč na serveru): přenos,
 * který tak dlouho nikdo nepotvrdil a appka o něm nehlásí, skončil - jinak
 * by v "Živě" visel napořád.
 */
export const CF_SILENT_MAX_MS = 10 * 60 * 1000;

/** Co o vstupu řekl Cloudflare při jednom srovnání. */
export type CloudflareSeen = {
  /** Má u vstupu video ve stavu live-inprogress (seznam běžících přenosů). */
  listed: boolean;
  /**
   * Vstup opravdu přijímá vysílání (lifecycle - podle toho se řídí i
   * přehrávač Cloudflare). null = nevíme (dotaz nevyšel).
   */
  connected: boolean | null;
  /** Kdy vzniklo video, které Cloudflare hlásí (začátek přenosu u Cloudflare). */
  videoCreatedAt?: string | null;
};

/**
 * - confirm: je živě (potvrdit - video, čas potvrzení),
 * - keep: nechat živě bez potvrzení (appka hlásí, krátký výpadek spojení),
 * - end: skončilo,
 * - none: není živě a nemá být.
 */
export type LiveDecision = 'confirm' | 'keep' | 'end' | 'none';

/**
 * Rozhodnutí pro jeden kanál při srovnání s Cloudflare. Stránka přenosu
 * i řada "Živě" pak čtou totéž z databáze, takže se nemůžou rozejít.
 *
 * Proč nestačí seznam běžících přenosů: Cloudflare v něm po konci vysílání
 * nechává video ve stavu "live-inprogress" ještě minutu (čeká, jestli se
 * vysílání nepřipojí znovu), a někdy i mnohem déle. Kanál pak visel
 * v "Živě", i když nikdo nevysílal - a po kliknutí stránka přenosu (a
 * přehrávač Cloudflare) řekla "teď nevysílá". Proto rozhoduje hlavně
 * lifecycle vstupu: jestli opravdu přijímá vysílání.
 */
export function decideLive(
  row: SignalRow & { is_live: boolean; ended_at?: string | null },
  cf: CloudflareSeen,
  now: number = Date.now()
): LiveDecision {
  if (cf.listed && cf.connected !== false) {
    if (row.is_live) return 'confirm';
    const ended = ms(row.ended_at);
    const created = ms(cf.videoCreatedAt);
    // Video z přenosu, který už skončil (vzniklo před koncem, nebo nevíme kdy):
    // to je přesně "skončil jsem, a v Živě visím dál". Oživí ho jen opravdu
    // připojený vstup, a to až po minutě, kterou Cloudflare čeká na znovupřipojení.
    const sameSession = Number.isFinite(ended) && (!Number.isFinite(created) || created <= ended);
    if (sameSession && (cf.connected !== true || now - ended < CF_REVIVE_HOLDOFF_MS)) return 'none';
    return 'confirm';
  }
  if (!row.is_live) return 'none';
  if (appSignalTrusted(row, now)) return 'keep';
  if (cf.listed) {
    const confirmed = lastConfirmedAt(row);
    if (Number.isFinite(confirmed) && now - confirmed < CF_RECONNECT_GRACE_MS) return 'keep';
  }
  return 'end';
}

/**
 * Cloudflare neodpověděl: skončil živý přenos, o kterém appka nehlásí
 * a který nikdo nepotvrdil déle než CF_SILENT_MAX_MS?
 */
export function staleWithoutCloudflare(row: SignalRow & { is_live: boolean }, now: number = Date.now()): boolean {
  if (!row.is_live || appSignalTrusted(row, now)) return false;
  const confirmed = lastConfirmedAt(row);
  const started = ms(row.started_at);
  const last = Math.max(Number.isFinite(confirmed) ? confirmed : -Infinity, Number.isFinite(started) ? started : -Infinity);
  return !Number.isFinite(last) || now - last > CF_SILENT_MAX_MS;
}
