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

// Srovnání s Cloudflare (decideLive): co je živě, rozhoduje lifecycle vstupu, ne jen seznam běžících videí.
const liveRow = { is_live: true, ended_at: null, app_ping_at: null, started_at: iso(T0), checked_at: iso(T0 + 10 * MIN), cf_confirmed_at: iso(T0 + 10 * MIN) };
const endedRow = { is_live: false, ended_at: iso(T0 + 20 * MIN), app_ping_at: null, started_at: iso(T0), checked_at: iso(T0 + 20 * MIN), cf_confirmed_at: iso(T0 + 19 * MIN) };

test('Cloudflare: běžící a připojený vstup = živě', () => {
  assert.equal(live.decideLive(liveRow, { listed: true, connected: true }, T0 + 11 * MIN), 'confirm');
  assert.equal(live.decideLive({ ...endedRow, ended_at: null, is_live: false }, { listed: true, connected: true }, T0 + 30 * MIN), 'confirm');
  // lifecycle nejde zjistit - živý přenos se drží podle seznamu
  assert.equal(live.decideLive(liveRow, { listed: true, connected: null }, T0 + 11 * MIN), 'confirm');
});

test('Cloudflare: video "visí" v seznamu, ale vstup nevysílá - skončený přenos se neoživí', () => {
  // přesně chyba "pořád jsem v Živě, po kliknutí teď nevysílá"
  for (const at of [T0 + 21 * MIN, T0 + 60 * MIN, T0 + 14 * 60 * MIN]) {
    assert.equal(live.decideLive(endedRow, { listed: true, connected: false, videoCreatedAt: iso(T0) }, at), 'none');
  }
  // ani když lifecycle nejde zjistit: video vzniklo před koncem přenosu
  assert.equal(live.decideLive(endedRow, { listed: true, connected: null, videoCreatedAt: iso(T0) }, T0 + 60 * MIN), 'none');
  // nové video po konci (nový přenos) ano
  assert.equal(live.decideLive(endedRow, { listed: true, connected: null, videoCreatedAt: iso(T0 + 25 * MIN) }, T0 + 26 * MIN), 'confirm');
});

test('Cloudflare: po Ukončit se přenos neoživí dobíhajícím hlášením (minuta čekání Cloudflare)', () => {
  // přesně chyba "skončil jsem a v Živě visím dál s časem 9:53"
  for (const after of [5000, 30000, 60000, 85000]) {
    assert.equal(live.decideLive(endedRow, { listed: true, connected: true, videoCreatedAt: iso(T0) }, T0 + 20 * MIN + after), 'none', String(after));
  }
  // OBS se připojil zpátky do stejného záznamu a opravdu vysílá - po čekání zase živě
  assert.equal(live.decideLive(endedRow, { listed: true, connected: true, videoCreatedAt: iso(T0) }, T0 + 20 * MIN + 95000), 'confirm');
  // nové vysílání (nové video po konci) hned
  assert.equal(live.decideLive(endedRow, { listed: true, connected: true, videoCreatedAt: iso(T0 + 20 * MIN + 3000) }, T0 + 20 * MIN + 5000), 'confirm');
  // nevíme, kdy video vzniklo: bere se jako to skončené
  assert.equal(live.decideLive(endedRow, { listed: true, connected: null, videoCreatedAt: null }, T0 + 20 * MIN + 5 * MIN), 'none');
  // kanál, který ještě nevysílal (bez konce): nový přenos hned
  assert.equal(live.decideLive({ ...endedRow, ended_at: null }, { listed: true, connected: null, videoCreatedAt: iso(T0) }, T0 + 25 * MIN), 'confirm');
});

test('Cloudflare: živý přenos, vstup krátce nepřipojený - minutu drží, pak konec', () => {
  assert.equal(live.decideLive(liveRow, { listed: true, connected: false }, T0 + 10 * MIN + 30000), 'keep');
  assert.equal(live.decideLive(liveRow, { listed: true, connected: false }, T0 + 11 * MIN + 1000), 'end');
  // zmizel ze seznamu a lifecycle nejde zjistit: taky minutu drží, pak konec
  assert.equal(live.decideLive(liveRow, { listed: false, connected: null }, T0 + 10 * MIN + 30000), 'keep');
  assert.equal(live.decideLive(liveRow, { listed: false, connected: null }, T0 + 11 * MIN + 1000), 'end');
});

test('Cloudflare: přenos jednou chybí v seznamu - nezmizí (dřív "Živě" blikalo: je tam / není tam)', () => {
  // přesně chyba "v Živě většinou nikdo, občas ano" (OBS, žádné hlášení z appky)
  let row = liveRow;
  const syncs = [
    [T0 + 10 * MIN + 15000, { listed: false, connected: null }, 'keep'],
    [T0 + 10 * MIN + 27000, { listed: true, connected: true }, 'confirm'],
    [T0 + 10 * MIN + 40000, { listed: false, connected: true }, 'confirm'], // v seznamu chybí, ale vstup vysílá
    [T0 + 10 * MIN + 52000, { listed: true, connected: null }, 'confirm'],
  ];
  for (const [at, cf, want] of syncs) {
    assert.equal(live.decideLive(row, cf, at), want, new Date(at).toISOString());
    if (want === 'confirm') row = { ...row, checked_at: iso(at), cf_confirmed_at: iso(at) };
  }
});

test('Cloudflare: přenos ukončený bez potvrzení se vrátí, jakmile vstup jistě vysílá', () => {
  // srovnání ho ukončilo (minutu bez potvrzení); Cloudflare pořád jede ve stejném záznamu
  const endedBySync = { ...endedRow, ended_at: iso(T0 + 20 * MIN), cf_confirmed_at: iso(T0 + 19 * MIN) };
  assert.equal(live.decideLive(endedBySync, { listed: true, connected: true, videoCreatedAt: iso(T0) }, T0 + 20 * MIN + 95000), 'confirm');
  assert.equal(live.decideLive(endedBySync, { listed: false, connected: true, videoCreatedAt: null }, T0 + 20 * MIN + 95000), 'confirm');
  // samotný seznam (bez jisté odpovědi) skončený záznam neoživí
  assert.equal(live.decideLive(endedBySync, { listed: true, connected: null, videoCreatedAt: iso(T0) }, T0 + 25 * MIN), 'none');
  // nový přenos po dlouhé době, Cloudflare ho ještě nemá v seznamu: hned
  assert.equal(live.decideLive(endedBySync, { listed: false, connected: true, videoCreatedAt: null }, T0 + 3 * 60 * MIN), 'confirm');
});

test('Cloudflare: vrácený přenos si nechá začátek, jen když je to opravdu tentýž záznam', () => {
  const ended = { is_live: false, started_at: iso(T0), ended_at: iso(T0 + 20 * MIN), current_video_uid: 'A' };
  // lifecycle hlásí to samé video (A), nebo video ze seznamu vzniklo před koncem
  assert.equal(live.sameStreamReturns(ended, { lifeUid: 'A' }, T0 + 22 * MIN), true);
  assert.equal(live.sameStreamReturns(ended, { lifeUid: null, videoCreatedAt: iso(T0) }, T0 + 22 * MIN), true);
  // OBS po 3 minutách znovu = nový záznam B, ještě není v seznamu: NE (dřív převzal začátek i záznam A)
  assert.equal(live.sameStreamReturns(ended, { lifeUid: 'B', videoCreatedAt: null }, T0 + 23 * MIN), false);
  assert.equal(live.sameStreamReturns(ended, { lifeUid: null, videoCreatedAt: null }, T0 + 23 * MIN), false);
  assert.equal(live.sameStreamReturns(ended, { lifeUid: null, videoCreatedAt: iso(T0 + 21 * MIN) }, T0 + 23 * MIN), false);
  // dlouho po konci, živý řádek, bez začátku: NE
  assert.equal(live.sameStreamReturns(ended, { lifeUid: 'A' }, T0 + 31 * MIN), false);
  assert.equal(live.sameStreamReturns({ ...ended, is_live: true }, { lifeUid: 'A' }, T0 + 22 * MIN), false);
  assert.equal(live.sameStreamReturns({ ...ended, started_at: null }, { lifeUid: 'A' }, T0 + 22 * MIN), false);
});

test('Cloudflare: stav vstupu z API (záloha za lifecycle)', () => {
  assert.equal(live.connectedFromInputStatus('connected'), true);
  assert.equal(live.connectedFromInputStatus('reconnected'), true);
  assert.equal(live.connectedFromInputStatus({ current: { state: 'connected' } }), true);
  for (const off of ['client_disconnect', 'ttl_exceeded', 'failed_to_connect', 'failed_to_reconnect', { current: { reason: 'client_disconnect' } }]) {
    assert.equal(live.connectedFromInputStatus(off), false, JSON.stringify(off));
  }
  for (const unknown of ['reconnecting', 'new_configuration_accepted', null, undefined, '', 42, {}]) {
    assert.equal(live.connectedFromInputStatus(unknown), null, JSON.stringify(unknown));
  }
});

test('Cloudflare: appka hlásí vysílání - drží se, dokud se jí věří', () => {
  const app = { ...liveRow, app_ping_at: iso(T0 + 11 * MIN) };
  assert.equal(live.decideLive(app, { listed: false, connected: null }, T0 + 11 * MIN + 10000), 'keep');
  assert.equal(live.decideLive(app, { listed: true, connected: false }, T0 + 11 * MIN + 10000), 'keep');
  // appka zmlkla
  assert.equal(live.decideLive(app, { listed: false, connected: null }, T0 + 12 * MIN), 'end');
  // neživý řádek nic nedrží
  assert.equal(live.decideLive({ ...endedRow, app_ping_at: iso(T0 + 21 * MIN) }, { listed: false, connected: null }, T0 + 21 * MIN), 'none');
});

test('Cloudflare neodpovídá: nepotvrzený přenos po 10 minutách zmizí', () => {
  assert.equal(live.staleWithoutCloudflare(liveRow, T0 + 19 * MIN), false);
  assert.equal(live.staleWithoutCloudflare(liveRow, T0 + 21 * MIN), true);
  assert.equal(live.staleWithoutCloudflare(endedRow, T0 + 99 * MIN), false);
  // nikdy nepotvrzený přenos se počítá od začátku
  assert.equal(live.staleWithoutCloudflare({ ...liveRow, cf_confirmed_at: null }, T0 + 9 * MIN), false);
  assert.equal(live.staleWithoutCloudflare({ ...liveRow, cf_confirmed_at: null }, T0 + 11 * MIN), true);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
