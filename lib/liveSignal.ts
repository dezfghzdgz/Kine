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
