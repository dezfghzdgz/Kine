/**
 * Denní rozpočet vysílání (lib/liveLimits.ts): minuty v okně 24 h ze záznamů
 * relací, vyčerpání, strop z prostředí.
 *
 * Spustit:  node tests/liveBudget.test.mjs
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/liveBudget.ts');
const m = await import(join(kam, 'liveBudget.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try {
    fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    padly++;
  }
}

const now = Date.parse('2026-11-04T12:00:00Z');
const min = 60 * 1000;
const iso = (msAgo) => new Date(now - msAgo).toISOString();

test('minuty se sčítají přes relace a ořezávají oknem 24 h', () => {
  const sessions = [
    { started_at: iso(90 * min), last_seen_at: iso(30 * min) }, // 60 min
    { started_at: iso(26 * 60 * min), last_seen_at: iso(23 * 60 * min) }, // jen 60 min v okně
  ];
  assert.equal(m.liveMinutesInWindow(sessions, now), 120);
  assert.equal(m.liveMinutesInWindow([], now), 0);
});

test('vadné nebo obrácené záznamy se nepočítají', () => {
  assert.equal(m.liveMinutesInWindow([{ started_at: 'x', last_seen_at: iso(0) }], now), 0);
  assert.equal(m.liveMinutesInWindow([{ started_at: iso(10 * min), last_seen_at: iso(20 * min) }], now), 0);
  // relace, která „běží do budoucna“, končí teď
  assert.equal(m.liveMinutesInWindow([{ started_at: iso(10 * min), last_seen_at: iso(-60 * min) }], now), 10);
});

test('rozpočet: výchozí 480 / 960 minut, meze 30–1440, nesmysl = výchozí', () => {
  assert.equal(m.liveDailyMinutes(false, {}), 480);
  assert.equal(m.liveDailyMinutes(true, {}), 960);
  assert.equal(m.liveDailyMinutes(false, { LIVE_DAILY_MINUTES: '120' }), 120);
  assert.equal(m.liveDailyMinutes(true, { LIVE_DAILY_MINUTES_PLUS: '1440' }), 1440);
  assert.equal(m.liveDailyMinutes(false, { LIVE_DAILY_MINUTES: '5' }), 480);
  assert.equal(m.liveDailyMinutes(false, { LIVE_DAILY_MINUTES: '100000' }), 480);
  assert.equal(m.liveDailyMinutes(false, { LIVE_DAILY_MINUTES: 'abc' }), 480);
});

test('vyčerpání: od stropu výš, strop 0 = bez stropu', () => {
  assert.equal(m.liveBudgetExceeded(479, 480), false);
  assert.equal(m.liveBudgetExceeded(480, 480), true);
  assert.equal(m.liveBudgetExceeded(99999, 0), false);
});

test('přestávka po vyčerpání je hodina', () => {
  assert.equal(m.LIVE_BUDGET_COOLDOWN_MINUTES, 60);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
