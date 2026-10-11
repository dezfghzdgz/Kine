/**
 * Test bezpečnostních pojistek: odkazy z oznámení (lib/safeLink.ts), IP
 * návštěvníka (lib/clientIp.ts) a důvěra v hlášení "vysílám" z appky
 * (lib/liveSignal.ts).
 *
 * Spustit:  node tests/security.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/safeLink.ts', 'lib/clientIp.ts', 'lib/liveSignal.ts');
const { safeInternalLink } = await import(join(kam, 'safeLink.js'));
const { clientIp } = await import(join(kam, 'clientIp.js'));
const live = await import(join(kam, 'liveSignal.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('odkaz: stránky Kine projdou', () => {
  for (const ok of ['/', '/watch/5881290a-10c0-4136-84d8-ca7cfc97f20e', '/watch/abc?t=5', '/channel-stats', '/live/x#chat', '/rules', '/u/jan_novák']) {
    assert.equal(safeInternalLink(ok), ok, ok);
  }
});

test('odkaz: nic ven z Kine', () => {
  for (const bad of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/ /x', 'https://evil.com', 'javascript:alert(1)',
    'evil.com', '', null, undefined, '/watch/x\n//e', '/watch/x\\..', '/' + 'a'.repeat(600)]) {
    assert.equal(safeInternalLink(bad), null, JSON.stringify(bad));
  }
});

test('IP: přednost má adresa od Vercelu, ne x-forwarded-for od klienta', () => {
  const h = new Headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1', 'x-real-ip': '1.2.3.4', 'x-vercel-forwarded-for': '1.2.3.4' });
  assert.equal(clientIp(h), '1.2.3.4');
  assert.equal(clientIp(new Headers({ 'x-vercel-forwarded-for': '2001:db8::1' })), '2001:db8::1');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' })), '5.6.7.8');
  assert.equal(clientIp(new Headers({ 'x-real-ip': '<script>' })), 'unknown');
  assert.equal(clientIp(new Headers()), 'unknown');
});

const T0 = Date.parse('2026-10-11T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60 * 1000;

test('vysílání: čerstvý přenos z appky se bere jako živý i bez Cloudflare', () => {
  const row = { app_ping_at: iso(T0 + 50 * 1000), started_at: iso(T0), checked_at: null };
  assert.equal(live.appSignalTrusted(row, T0 + 60 * 1000), true);
});

test('vysílání: bez potvrzení od Cloudflare po 3 minutách konec', () => {
  const row = { app_ping_at: iso(T0 + 3 * MIN), started_at: iso(T0), checked_at: iso(T0 - 60 * MIN) };
  assert.equal(live.appSignalTrusted(row, T0 + 3 * MIN + 1000), false);
});

test('vysílání: potvrzený přenos vydrží krátký výpadek Cloudflare', () => {
  const row = { app_ping_at: iso(T0 + 30 * MIN), started_at: iso(T0), checked_at: iso(T0 + 29 * MIN) };
  assert.equal(live.appSignalTrusted(row, T0 + 30 * MIN + 5000), true);
  // ...ale ne donekonečna
  assert.equal(live.appSignalTrusted({ ...row, app_ping_at: iso(T0 + 33 * MIN) }, T0 + 33 * MIN), false);
});

test('vysílání: potvrzení z minulého přenosu se nepočítá', () => {
  const row = { app_ping_at: iso(T0 + 10 * MIN), started_at: iso(T0), checked_at: iso(T0 - 1000) };
  assert.equal(live.appSignalTrusted(row, T0 + 10 * MIN), false);
});

test('vysílání: staré hlášení (appka zmlkla) se nebere', () => {
  const row = { app_ping_at: iso(T0), started_at: iso(T0), checked_at: iso(T0) };
  assert.equal(live.appPingFresh(row, T0 + 44 * 1000), true);
  assert.equal(live.appPingFresh(row, T0 + 46 * 1000), false);
  assert.equal(live.appSignalTrusted(row, T0 + 46 * 1000), false);
  assert.equal(live.appSignalTrusted({ ...row, app_ping_at: null }, T0), false);
});

test('vysílání: potvrzení se bere ze sloupce cf_confirmed_at, když existuje', () => {
  // checked_at přepisuje i ukončení - po migraci se nepočítá
  const row = { app_ping_at: iso(T0 + 10 * MIN), started_at: iso(T0), checked_at: iso(T0 + 9 * MIN), cf_confirmed_at: null };
  assert.equal(live.appSignalTrusted(row, T0 + 10 * MIN), false);
  assert.equal(live.appSignalTrusted({ ...row, cf_confirmed_at: iso(T0 + 9 * MIN) }, T0 + 10 * MIN), true);
});

test('vysílání: opakované "začal jsem" bez potvrzení neprodlužuje důvěru', () => {
  const unconfirmed = { started_at: iso(T0), checked_at: iso(T0 + 4 * MIN), cf_confirmed_at: null };
  assert.equal(live.revivedStartedAt(unconfirmed, T0 + 5 * MIN), iso(T0));
  // po čtvrthodině se zapomíná
  assert.equal(live.revivedStartedAt(unconfirmed, T0 + 16 * MIN), iso(T0 + 16 * MIN));
  // potvrzený přenos dostane při novém startu nové okno
  assert.equal(live.revivedStartedAt({ ...unconfirmed, cf_confirmed_at: iso(T0 + MIN) }, T0 + 5 * MIN), iso(T0 + 5 * MIN));
  // první přenos vůbec
  assert.equal(live.revivedStartedAt({ started_at: null, checked_at: null, cf_confirmed_at: null }, T0), iso(T0));
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
