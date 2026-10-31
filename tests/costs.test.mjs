/**
 * Hlídač nákladů (lib/costs.ts): kdy varovat a jak se počítá odhad ceny.
 * Spustit:  node tests/costs.test.mjs
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/costs.ts');
// Databáze ani Cloudflare tu nejsou potřeba - jen čisté výpočty.
writeFileSync(join(kam, 'supabaseServer.js'), 'export const supabaseServer = {};\n');
const { costAlerts, costEstimate, costPrices } = await import(join(kam, 'costs.js'));

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

const MB = 1024 * 1024;
const GB = 1024 * MB;
const base = () => ({
  stream: { storedMinutes: 100, limitMinutes: 1000, videoCount: 10, error: null },
  delivery: { monthMinutes: 1000, todayMinutes: 50, days: [40, 50, 60, 45, 55, 50, 40, 50].map((minutes, i) => ({ date: `2026-10-0${i + 1}`, minutes })), error: null },
  uploads: { minutes24h: 30, count24h: 2, minutes7d: 100, top: [] },
  supabase: { dbBytes: 50 * MB, dbLimit: 500 * MB, storageBytes: 0.1 * GB, storageLimit: 1 * GB, tables: [] },
  estimate: { storageUsd: 5, deliveryMonthUsd: 1, deliveryProjectedUsd: 2 },
});
const keys = (alerts) => alerts.map((a) => `${a.key}:${a.level}`).sort();

test('běžný stav = žádné varování', () => {
  assert.deepEqual(costAlerts(base(), {}), []);
});

test('úložiště videí: od 80 % varování, od 95 % poplach', () => {
  const r = base();
  r.stream.storedMinutes = 820;
  assert.deepEqual(keys(costAlerts(r, {})), ['storage:warn']);
  r.stream.storedMinutes = 960;
  assert.deepEqual(keys(costAlerts(r, {})), ['storage:crit']);
});

test('nával přehrávání: víc než 500 min a víc než trojnásobek běžného dne', () => {
  const r = base();
  r.delivery.todayMinutes = 400; // pod 500 - nic
  assert.deepEqual(costAlerts(r, {}), []);
  r.delivery.todayMinutes = 900; // průměr ~50 -> nával
  assert.deepEqual(keys(costAlerts(r, {})), ['delivery-spike:warn']);
});

test('odhad přehrávání za měsíc nad hranicí (výchozí $20, jde změnit)', () => {
  const r = base();
  r.estimate.deliveryProjectedUsd = 25;
  assert.deepEqual(keys(costAlerts(r, {})), ['delivery-cost:warn']);
  assert.deepEqual(costAlerts(r, { COST_ALERT_DELIVERY_USD: '50' }), []);
});

test('nezvykle moc nahrávání za 24 h', () => {
  const r = base();
  r.uploads.minutes24h = 700;
  assert.deepEqual(keys(costAlerts(r, {})), ['uploads:warn']);
  assert.deepEqual(costAlerts(r, { COST_ALERT_UPLOAD_MINUTES_DAY: '1000' }), []);
});

test('Supabase: databáze a obrázky blízko limitu tarifu Free', () => {
  const r = base();
  r.supabase.dbBytes = 420 * MB;
  r.supabase.storageBytes = 0.97 * GB;
  assert.deepEqual(keys(costAlerts(r, {})), ['db:warn', 'storage-sb:crit']);
});

test('každé varování má text česky i anglicky', () => {
  const r = base();
  r.stream.storedMinutes = 990;
  r.delivery.todayMinutes = 2000;
  r.estimate.deliveryProjectedUsd = 99;
  r.uploads.minutes24h = 5000;
  r.supabase.dbBytes = 499 * MB;
  r.supabase.storageBytes = 0.99 * GB;
  const alerts = costAlerts(r, {});
  assert.equal(alerts.length, 6);
  for (const a of alerts) {
    assert.ok(a.text && a.en && a.text !== a.en, a.key);
  }
});

test('chybějící údaje (Cloudflare neodpověděl) nevaruje naslepo', () => {
  const r = base();
  r.stream = { storedMinutes: null, limitMinutes: null, videoCount: null, error: 'x' };
  r.delivery = { monthMinutes: null, todayMinutes: null, days: [], error: 'x' };
  r.supabase = null;
  r.estimate = { storageUsd: null, deliveryMonthUsd: null, deliveryProjectedUsd: null };
  assert.deepEqual(costAlerts(r, {}), []);
});

test('odhad ceny: úložiště po 1000 min, přehrávání přepočtené na celý měsíc', () => {
  const prices = costPrices({});
  assert.deepEqual(prices, { storagePer1000: 5, deliveryPer1000: 1 });
  const est = costEstimate({ storedMinutes: 1200, limitMinutes: 2000, videoCount: 1, error: null }, { monthMinutes: 3000, todayMinutes: 100, days: [], error: null }, prices, new Date('2026-10-10T12:00:00Z'));
  assert.equal(est.storageUsd, 10); // předplaceno 2000 min = 2 × $5
  assert.equal(est.deliveryMonthUsd, 3); // 3000 min × $1/1000
  assert.equal(est.deliveryProjectedUsd, 9.3); // 3 $ za 10 dní -> 31 dní
  const none = costEstimate({ storedMinutes: null, limitMinutes: null, videoCount: null, error: 'x' }, { monthMinutes: null, todayMinutes: null, days: [], error: 'x' }, prices, new Date());
  assert.deepEqual(none, { storageUsd: null, deliveryMonthUsd: null, deliveryProjectedUsd: null });
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
