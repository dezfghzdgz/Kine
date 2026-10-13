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
 * Cloudflare živý přenos zrovna nepotvrdil: vstup není připojený (OBS /
 * appka se připojuje znovu - Cloudflare na to čeká minutu a pak záznam
 * uzavře), nebo přenos jednou chybí v seznamu běžících. Tak dlouho od
 * posledního potvrzení zůstává přenos v "Živě"; pak zmizí.
 */
export const CF_RECONNECT_GRACE_MS = 60 * 1000;

/**
 * Skončený přenos (video vzniklo před koncem) smí Cloudflare "oživit" až po
 * téhle době - a jen když vstup opravdu vysílá (lifecycle). Po Ukončit
 * (appka, studio) OBS nebo appka ještě chvíli posílá a Cloudflare navíc
 * minutu čeká na znovupřipojení (timeoutSeconds 60) - kdyby to celou dobu
 * hlásil jako vysílání, skončený přenos se nesmí vrátit. Nové vysílání
 * (nové video) se ukáže hned.
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
   * Vstup opravdu přijímá vysílání (lifecycle vstupu, záložně stav vstupu
   * z API - podle toho se řídí i přehrávač Cloudflare). null = nevíme.
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
 * Co Cloudflare řekne, má dvě síly:
 *  - jistě: lifecycle vstupu (vysílá / nevysílá),
 *  - nejistě (lifecycle nejde zjistit): seznam běžících přenosů. Ten po
 *    konci vysílání nechává video "live-inprogress" ještě minutu i déle,
 *    a naopak v něm běžící přenos jednou za čas chybí.
 *
 * Živý přenos se proto neukončí kvůli jedné odpovědi: skončí až po minutě
 * bez jediného potvrzení (CF_RECONNECT_GRACE_MS) - dřív stačilo jedno
 * srovnání, kde chyběl v seznamu, a přenos z "Živě" zmizel; pak se
 * minutu i déle nesměl vrátit a "Živě" blikalo (je tam / není tam).
 * Skončený přenos oživí jen jistá odpověď (vstup vysílá), u stejného
 * záznamu až po CF_REVIVE_HOLDOFF_MS; nový záznam (nové video) hned.
 */
export function decideLive(
  row: SignalRow & { is_live: boolean; ended_at?: string | null },
  cf: CloudflareSeen,
  now: number = Date.now()
): LiveDecision {
  const sure = cf.connected !== null;
  let streaming = sure ? cf.connected === true : cf.listed;
  // Appka právě hlásí, že vysílá, a Cloudflare má přenos v seznamu běžících: lifecycle
  // (jinak "jistý") občas chvíli zaostává - tady se věří seznamu, ať se přenos potvrdí
  // (bez potvrzení by appce po 3 minutách přestalo platit "pořád vysílám").
  if (!streaming && cf.listed && row.is_live && appPingFresh(row, now)) streaming = true;

  if (row.is_live) {
    if (streaming) return 'confirm';
    if (appSignalTrusted(row, now)) return 'keep';
    const confirmed = lastConfirmedAt(row);
    if (Number.isFinite(confirmed) && now - confirmed < CF_RECONNECT_GRACE_MS) return 'keep';
    return 'end';
  }

  if (!streaming) return 'none';
  const ended = ms(row.ended_at);
  const created = ms(cf.videoCreatedAt);
  // Nové vysílání: kanál ještě nevysílal, nebo Cloudflare hlásí video, které vzniklo po konci.
  if (!Number.isFinite(ended) || (Number.isFinite(created) && created > ended)) return 'confirm';
  // Pořád ten skončený záznam. Seznam samotný ho neoživí (to byl ten "skončil
  // jsem, a v Živě visím dál"); jistě vysílající vstup ano, po chvíli.
  if (!sure) return 'none';
  return now - ended >= CF_REVIVE_HOLDOFF_MS ? 'confirm' : 'none';
}

/** Přenos, který se do tolika po konci vrátí (stejný záznam u Cloudflare), pokračuje i se svým začátkem. */
export const RESUME_SAME_STREAM_MS = 10 * 60 * 1000;

/**
 * Vrací se skončený přenos jako tentýž (stejný záznam u Cloudflare, do
 * RESUME_SAME_STREAM_MS po konci)? Pak si nechá začátek (čas vysílání,
 * chat) i video. Jen když to jde poznat: lifecycle hlásí to samé video,
 * nebo video ze seznamu vzniklo před koncem. Nový přenos (nové video,
 * nebo nevíme) začíná znovu - nesmí převzít čas ani záznam starého.
 */
export function sameStreamReturns(
  row: { is_live: boolean; started_at: string | null; ended_at?: string | null; current_video_uid?: string | null },
  seen: { lifeUid: string | null; videoCreatedAt?: string | null },
  now: number = Date.now()
): boolean {
  if (row.is_live || !row.started_at) return false;
  const ended = ms(row.ended_at);
  if (!Number.isFinite(ended) || now - ended >= RESUME_SAME_STREAM_MS) return false;
  if (seen.lifeUid && row.current_video_uid && seen.lifeUid === row.current_video_uid) return true;
  const created = ms(seen.videoCreatedAt);
  return Number.isFinite(created) && created <= ended;
}

/**
 * Stav vstupu z API Cloudflare (GET live_inputs/<id>, pole status) ->
 * vysílá / nevysílá / nevíme. Záloha, když lifecycle nejde zjistit. API
 * vrací text ("connected"…), novější verze objekt s current.state.
 */
export function connectedFromInputStatus(status: unknown): boolean | null {
  const raw =
    typeof status === 'string'
      ? status
      : status && typeof status === 'object'
        ? String((status as any).current?.state ?? (status as any).current?.reason ?? (status as any).state ?? '')
        : '';
  const state = raw.trim().toLowerCase();
  if (state === 'connected' || state === 'reconnected') return true;
  if (['client_disconnect', 'ttl_exceeded', 'failed_to_connect', 'failed_to_reconnect', 'disconnected'].includes(state)) return false;
  // reconnecting, new_configuration_accepted, nic: nevíme.
  return null;
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
