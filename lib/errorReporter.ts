/**
 * Hlášení chyb z prohlížeče.
 *
 * PROČ
 *
 * Každou chybu v appce zatím našel člověk - všiml si, že něco nefunguje,
 * a napsal. Co se nikomu nezobrazilo jako rozbité, nikdo nenašel. Odteď
 * se neodchycené chyby JavaScriptu posílají na /api/client-errors a jsou
 * k vidění na /admin/errors: co, kde, na jakém zařízení, kolikrát.
 *
 * CO SE NEPOSÍLÁ
 *
 * Nic, co napsal uživatel, žádná hesla, žádný obsah stránky a ani to, kdo
 * je přihlášený - jen text chyby, zásobník volání, adresa stránky (bez
 * parametrů, ty mohou nést hledanou frázi), prohlížeč a třída zařízení.
 * Tabulka má sloupec user_id pro případ, že by to někdy bylo potřeba, ale
 * appka ho neplní.
 *
 * OCHRANA PŘED ZAHLCENÍM
 *
 * Stejná chyba se za jedno načtení stránky pošle jednou (otisk = text +
 * první řádek zásobníku), celkem nejvíc MAX_PER_PAGE. Chyby z rozšíření
 * prohlížeče a známý neškodný šum se nehlásí vůbec.
 *
 * Rozhodování je čisté a má test (tests/errorReporter.test.mjs); napojení
 * na prohlížeč je dole v installErrorReporter().
 */

import { detectDeviceClass, type DeviceClass } from './deviceClass';

export const MAX_PER_PAGE = 10;
export const MAX_MESSAGE = 500;
export const MAX_STACK = 4000;
export const MAX_URL = 300;

export interface RawError {
  kind: 'error' | 'rejection';
  message: string;
  stack?: string | null;
  /** Soubor, ve kterém chyba vznikla (u událostí "error"). */
  source?: string | null;
}

export interface ErrorReport {
  kind: 'error' | 'rejection';
  message: string;
  stack: string | null;
  url: string;
  userAgent: string;
  device: DeviceClass;
  fingerprint: string;
}

export interface ReporterState {
  sent: Set<string>;
  count: number;
}

export function createState(): ReporterState {
  return { sent: new Set(), count: 0 };
}

/** Šum, který nikomu nepomůže a jen by zaplavil přehled. */
const IGNORED = [
  /^ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Loading chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /^Network Error$/i,
  /Load failed/i,
  /AbortError/i,
  /The operation was aborted/i,
  /play\(\) request was interrupted/i,
  /NotAllowedError/i,
];

const EXTENSION_SOURCE = /^(chrome|moz|safari|edge)-extension:\/\//i;

/** Adresa bez parametrů a kotvy - v nich může být hledaná fráze. */
export function stripUrl(url: string): string {
  if (!url) return '';
  const cut = url.split(/[?#]/)[0];
  return cut.length > MAX_URL ? cut.slice(0, MAX_URL) : cut;
}

/**
 * Otisk chyby: text + první řádek zásobníku s odstraněnými čísly řádků
 * a hashi souborů, aby stejná chyba po novém nasazení nevypadala jako
 * jiná.
 */
export function fingerprintOf(message: string, stack: string | null | undefined): string {
  const firstFrame = (stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && l !== message && !l.startsWith('Error') && !l.startsWith('TypeError')) ?? '';
  const normalized = (message + '|' + firstFrame)
    .replace(/:\d+:\d+/g, '')
    .replace(/[a-f0-9]{8,}/gi, '#')
    .replace(/\d+/g, '0')
    .toLowerCase();
  return normalized.slice(0, 200);
}

/**
 * Z chyby udělá hlášení, nebo null, když se hlásit nemá.
 * Mutuje stav (počet a otisky) jen když hlášení vrací.
 */
export function prepareReport(
  raw: RawError,
  ctx: { url: string; userAgent: string; device: DeviceClass },
  state: ReporterState
): ErrorReport | null {
  const message = (raw.message || '').trim();
  if (!message) return null;
  if (IGNORED.some((re) => re.test(message))) return null;
  if (raw.source && EXTENSION_SOURCE.test(raw.source)) return null;
  if (raw.stack && EXTENSION_SOURCE.test(raw.stack)) return null;
  if (state.count >= MAX_PER_PAGE) return null;

  const fingerprint = fingerprintOf(message, raw.stack);
  if (state.sent.has(fingerprint)) return null;

  state.sent.add(fingerprint);
  state.count++;

  return {
    kind: raw.kind,
    message: message.slice(0, MAX_MESSAGE),
    stack: raw.stack ? String(raw.stack).slice(0, MAX_STACK) : null,
    url: stripUrl(ctx.url),
    userAgent: (ctx.userAgent || '').slice(0, 300),
    device: ctx.device,
    fingerprint,
  };
}

/** Text a zásobník z čehokoliv, co prohlížeč hodil (Error, string, objekt). */
export function describeThrown(thrown: unknown): { message: string; stack: string | null } {
  if (thrown instanceof Error) return { message: thrown.message || thrown.name, stack: thrown.stack ?? null };
  if (typeof thrown === 'string') return { message: thrown, stack: null };
  if (thrown && typeof thrown === 'object') {
    const o = thrown as any;
    if (typeof o.message === 'string') return { message: o.message, stack: typeof o.stack === 'string' ? o.stack : null };
    try {
      return { message: JSON.stringify(thrown).slice(0, MAX_MESSAGE), stack: null };
    } catch {
      return { message: 'Neznámá chyba (objekt)', stack: null };
    }
  }
  return { message: String(thrown ?? 'Neznámá chyba'), stack: null };
}

/* ---------- napojení na prohlížeč ---------- */

let installed = false;

/**
 * Zapne hlášení. Volat jednou, v kostře appky (components/ErrorReporter.tsx).
 * Vrací funkci, která ho zase vypne.
 */
export function installErrorReporter(endpoint = '/api/client-errors'): () => void {
  if (typeof window === 'undefined' || installed) return () => {};
  installed = true;

  const state = createState();
  const device = detectDeviceClass();

  function send(report: ErrorReport) {
    const body = JSON.stringify(report);
    try {
      // sendBeacon doručí i při zavírání stránky a nezdrží ji.
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))) return;
    } catch {
      // spadne na fetch
    }
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  function ctx() {
    return { url: window.location.href, userAgent: navigator.userAgent, device };
  }

  function onError(e: ErrorEvent) {
    const d = e.error ? describeThrown(e.error) : { message: e.message, stack: null };
    const report = prepareReport({ kind: 'error', message: d.message, stack: d.stack, source: e.filename }, ctx(), state);
    if (report) send(report);
  }

  function onRejection(e: PromiseRejectionEvent) {
    const d = describeThrown(e.reason);
    const report = prepareReport({ kind: 'rejection', message: d.message, stack: d.stack }, ctx(), state);
    if (report) send(report);
  }

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    installed = false;
  };
}
