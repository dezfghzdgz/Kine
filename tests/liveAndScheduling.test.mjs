/**
 * Test čisté logiky živého vysílání (lib/liveChat.ts), naplánovaných videí
 * a premiér (lib/scheduling.ts) a filtrů hledání (lib/searchFilters.ts).
 *
 * Spustit:  node tests/liveAndScheduling.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/liveChat.ts', 'lib/scheduling.ts', 'lib/searchFilters.ts');
const chat = await import(join(kam, 'liveChat.js'));
const sch = await import(join(kam, 'scheduling.js'));
const sf = await import(join(kam, 'searchFilters.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const ID = '5881290a-10c0-4136-84d8-ca7cfc97f20e';

test('chat: jen kanál nebo video s platným id', () => {
  assert.deepEqual(chat.parseChatRoom(`channel:${ID.toUpperCase()}`), { kind: 'channel', id: ID, key: `channel:${ID}` });
  assert.equal(chat.parseChatRoom(`video:${ID}`).kind, 'video');
  assert.equal(chat.parseChatRoom(`user:${ID}`), null);
  assert.equal(chat.parseChatRoom('channel:abc'), null);
  assert.equal(chat.parseChatRoom(null), null);
  assert.equal(chat.channelRoom(ID), `channel:${ID}`);
});

test('jak dlouho přenos běží', () => {
  const start = new Date(1_000_000).toISOString();
  assert.equal(chat.liveElapsed(start, 1_000_000 + 65_000), '1:05');
  assert.equal(chat.liveElapsed(start, 1_000_000 + 3_725_000), '1:02:05');
  assert.equal(chat.liveElapsed(null), '');
});

test('naplánované video je skryté, premiéra vidět s odpočtem', () => {
  const now = Date.parse('2026-09-24T10:00:00Z');
  const future = '2026-09-24T12:00:00Z';
  assert.equal(sch.isHiddenScheduled({ scheduled_at: future }, now), true);
  assert.equal(sch.isHiddenScheduled({ scheduled_at: future, is_premiere: true }, now), false);
  assert.equal(sch.isUpcomingPremiere({ scheduled_at: future, is_premiere: true }, now), true);
  assert.equal(sch.isUpcomingPremiere({ scheduled_at: '2026-09-24T09:00:00Z', is_premiere: true }, now), false);
  assert.equal(sch.isUpcoming({ scheduled_at: null }, now), false);
  assert.equal(sch.visibleNowFilter('X'), 'scheduled_at.is.null,scheduled_at.lte.X,is_premiere.eq.true');
});

test('odpočet', () => {
  assert.equal(sch.formatCountdown(65_000), '01:05');
  assert.equal(sch.formatCountdown(3_725_000), '01:02:05');
  assert.equal(sch.formatCountdown(2 * 86_400_000 + 5_000), '2 d 00:00:05');
  assert.equal(sch.formatCountdown(-5), '00:00');
});

test('filtry hledání: čtení z adresy, nesmysly = výchozí', () => {
  assert.deepEqual(sf.parseSearchFilters({ type: 'sparks', date: 'week', duration: 'long', sort: 'views' }), { type: 'sparks', date: 'week', duration: 'long', sort: 'views' });
  assert.deepEqual(sf.parseSearchFilters({ type: 'x', sort: ['date'] }), { type: 'all', date: 'any', duration: 'any', sort: 'date' });
  assert.equal(sf.filtersActive(sf.DEFAULT_FILTERS), false);
});

test('filtry hledání: typ, datum, délka, řazení a naplánovaná videa', () => {
  const now = Date.parse('2026-09-24T10:00:00Z');
  const rows = [
    { id: 'a', created_at: '2026-09-24T09:30:00Z', duration_seconds: 30, views: 5, width: 1080, height: 1920 },
    { id: 'b', created_at: '2026-09-20T09:00:00Z', duration_seconds: 600, views: 50, width: 1920, height: 1080 },
    { id: 'c', created_at: '2025-01-01T00:00:00Z', duration_seconds: 3600, views: 500, width: 1920, height: 1080 },
    { id: 'd', created_at: '2026-09-24T08:00:00Z', scheduled_at: '2026-09-25T08:00:00Z', duration_seconds: 100, views: 0 },
    { id: 'e', created_at: '2026-09-24T08:00:00Z', scheduled_at: '2026-09-25T08:00:00Z', is_premiere: true, duration_seconds: 100, views: 0 },
  ];
  const spark = (r) => !!(r.height && r.width && r.height > r.width && r.duration_seconds <= 60);
  const ids = (f) => sf.applySearchFilters(rows, { ...sf.DEFAULT_FILTERS, ...f }, spark, now).map((r) => r.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'e']);
  assert.deepEqual(ids({ type: 'sparks' }), ['a']);
  assert.deepEqual(ids({ type: 'long' }), ['b', 'c', 'e']);
  assert.deepEqual(ids({ date: 'hour' }), ['a']);
  assert.deepEqual(ids({ date: 'week' }), ['a', 'b']);
  assert.deepEqual(ids({ duration: 'short' }), ['a', 'e']);
  assert.deepEqual(ids({ duration: 'medium' }), ['b']);
  assert.deepEqual(ids({ duration: 'long' }), ['c']);
  assert.deepEqual(ids({ sort: 'views' }), ['c', 'b', 'a', 'e']);
  assert.deepEqual(ids({ sort: 'date' }), ['e', 'a', 'b', 'c']);
});

test('odkaz se změněným filtrem nechá ostatní', () => {
  const href = sf.searchHref('cs2 ace', { type: 'sparks', date: 'any', duration: 'any', sort: 'relevance' }, { sort: 'views' }, '80');
  assert.equal(href, '/search?q=cs2+ace&minRating=80&type=sparks&sort=views');
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
