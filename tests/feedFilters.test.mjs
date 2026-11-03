/**
 * Co do doporučení nepatří (lib/feedFilters.ts), náhoda se semínkem
 * (lib/seededRandom.ts) a vyřazení zablokovaných kanálů z hledání
 * (lib/searchFilters.ts - restrictedOwners / withoutRestricted).
 *
 * Spustit:  node tests/feedFilters.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const ff = await import(join(prelozit('lib/feedFilters.ts'), 'feedFilters.js'));
const sr = await import(join(prelozit('lib/seededRandom.ts'), 'seededRandom.js'));
const sf = await import(join(prelozit('lib/searchFilters.ts'), 'searchFilters.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const NOW = Date.parse('2026-11-03T12:00:00Z');
const later = new Date(NOW + 86400000).toISOString();
const earlier = new Date(NOW - 86400000).toISOString();
const hidden = { videoIds: new Set(['hv']), channelIds: new Set(['hc']) };

// --- feedFilters -------------------------------------------------------------------

test('tvůrce videa: owner_id, jinak navázaný profil (objekt i pole)', () => {
  assert.equal(ff.ownerIdOf({ owner_id: 'a' }), 'a');
  assert.equal(ff.ownerIdOf({ profiles: { id: 'b' } }), 'b');
  assert.equal(ff.ownerIdOf({ profiles: [{ id: 'c' }] }), 'c');
  assert.equal(ff.ownerIdOf(null), undefined);
});

test('schované: video i celý kanál; bez seznamu nic', () => {
  assert.equal(ff.isHiddenBy({ id: 'hv', owner_id: 'x' }, hidden), true);
  assert.equal(ff.isHiddenBy({ id: 'v', owner_id: 'hc' }, hidden), true);
  assert.equal(ff.isHiddenBy({ id: 'v', profiles: { id: 'hc' } }, hidden), true);
  assert.equal(ff.isHiddenBy({ id: 'v', owner_id: 'x' }, hidden), false);
  assert.equal(ff.isHiddenBy({ id: 'hv' }, null), false);
});

test('vlastní video se doporučuje jen cizím', () => {
  assert.equal(ff.isOwnVideo({ owner_id: 'me' }, 'me'), true);
  assert.equal(ff.isOwnVideo({ owner_id: 'me' }, null), false);
  assert.equal(ff.feedEligible({ id: 'v', owner_id: 'me' }, { viewerId: 'me', now: NOW }), false);
  assert.equal(ff.feedEligible({ id: 'v', owner_id: 'me' }, { viewerId: 'me', allowOwn: true, now: NOW }), true, 'hledání a kanál vlastní nechávají');
});

test('naplánované video před vydáním nikde; premiéra s odpočtem jen kde se smí', () => {
  const scheduled = { id: 's', scheduled_at: later, is_premiere: false };
  const premiere = { id: 'p', scheduled_at: later, is_premiere: true };
  const released = { id: 'r', scheduled_at: earlier, is_premiere: false };
  assert.equal(ff.isUnreleased(scheduled, NOW), true);
  assert.equal(ff.isUnreleased(premiere, NOW), false);
  assert.equal(ff.startsLater(premiere, NOW), true);
  assert.equal(ff.startsLater(released, NOW), false);
  assert.deepEqual(ff.filterFeed([scheduled, premiere, released], { now: NOW }).map((v) => v.id), ['p', 'r']);
  assert.deepEqual(ff.filterFeed([scheduled, premiere, released], { now: NOW, allowUpcomingPremiere: false }).map((v) => v.id), ['r']);
  assert.deepEqual(ff.filterFeed([{ id: 'x', owner_id: 'hc' }, { id: 'hv' }, { owner_id: 'bez-id' }, { id: 'ok' }], { hidden, now: NOW }).map((v) => v.id), ['ok']);
});

test('filtr kandidátů na Sparks: vyšlo a krátké v jednom dotazu (vnořené or v and)', () => {
  const f = ff.sparkCandidateFilter('2026-11-03T12:00:00.000Z');
  assert.equal(f, 'and(or(scheduled_at.is.null,scheduled_at.lte.2026-11-03T12:00:00.000Z),or(duration_seconds.is.null,duration_seconds.lte.120))');
  const open = (f.match(/\(/g) ?? []).length;
  const close = (f.match(/\)/g) ?? []).length;
  assert.equal(open, close, 'závorky sedí');
});

// --- seededRandom ---------------------------------------------------------------------

test('otisk a číslo ze semínka: stálé, v rozsahu 0-1', () => {
  assert.equal(sr.hashText(''), 0x811c9dc5);
  assert.equal(sr.hashText('kine'), sr.hashText('kine'));
  assert.notEqual(sr.hashText('kine'), sr.hashText('kina'));
  for (let i = 0; i < 200; i++) {
    const u = sr.seededUnit(i, 'video-' + i);
    assert.ok(u >= 0 && u < 1);
  }
  assert.equal(sr.seededUnit(5, 'a'), sr.seededUnit(5, 'a'));
});

test('semínko diváka: stejné v jednom okně, jiné v dalším a pro jiného diváka', () => {
  const a = sr.viewerSeed('user-1', NOW);
  // NOW je přesně začátek půlhodinového okna, minuta potom je pořád v něm.
  assert.equal(a, sr.viewerSeed('user-1', NOW + 60 * 1000), 'stejné okno = stejné semínko');
  assert.notEqual(sr.viewerSeed('user-1', NOW), sr.viewerSeed('user-2', NOW));
  assert.notEqual(sr.viewerSeed('user-1', NOW), sr.viewerSeed('user-1', NOW + sr.SEED_WINDOW_MS));
});

test('uložené semínko platí 30 minut od vzniku a jen pro stejného diváka', () => {
  const stored = { s: 123, at: NOW, k: 'u1' };
  assert.equal(sr.storedSeedValid(stored, 'u1', NOW + 10 * 60 * 1000), true);
  assert.equal(sr.storedSeedValid(stored, 'u1', NOW + sr.SEED_WINDOW_MS), false, 'po 30 minutách nové');
  assert.equal(sr.storedSeedValid(stored, 'u2', NOW), false, 'jiný účet');
  assert.equal(sr.storedSeedValid(stored, 'u1', NOW - 1000), false, 'z budoucnosti (posunuté hodiny)');
  assert.equal(sr.storedSeedValid({ s: 'x', at: NOW, k: 'u1' }, 'u1', NOW), false);
  assert.equal(sr.storedSeedValid(null, 'u1', NOW), false);
});

test('zamíchání (Fisher-Yates): permutace, stálá se stejným semínkem, jiná s jiným', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const a = sr.seededShuffle(items, 42);
  assert.deepEqual([...a].sort((x, y) => x - y), items, 'nic se neztratí ani nezdvojí');
  assert.deepEqual(sr.seededShuffle(items, 42), a);
  assert.notDeepEqual(sr.seededShuffle(items, 43), a);
  assert.deepEqual(items, Array.from({ length: 20 }, (_, i) => i), 'vstup zůstane beze změny');
  assert.deepEqual(sr.seededShuffle([], 1), []);
});

test('zamíchání je rovnoměrné (každý prvek na každém místě zhruba stejně často)', () => {
  const counts = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const runs = 8000;
  for (let seed = 0; seed < runs; seed++) {
    sr.seededShuffle([0, 1, 2, 3], seed * 2654435761).forEach((value, position) => counts[value][position]++);
  }
  for (const row of counts) {
    for (const c of row) assert.ok(Math.abs(c - runs / 4) < runs * 0.04, `odchylka moc velká: ${row}`);
  }
});

// --- hledání: zablokované a shadow-banované kanály ----------------------------------------

test('hledání: zablokované a shadow-banované kanály pryč (i podle navázaného profilu)', () => {
  const restricted = sf.restrictedOwners([
    { id: 'ok', is_banned: false, is_shadow_banned: false },
    { id: 'ban', is_banned: true },
    { id: 'shadow', is_shadow_banned: true },
    { id: 'nic' },
  ]);
  assert.deepEqual([...restricted].sort(), ['ban', 'shadow']);
  const videos = [{ id: 1, owner_id: 'ok' }, { id: 2, owner_id: 'ban' }, { id: 3, profiles: { id: 'shadow' } }, { id: 4, profiles: [{ id: 'ok' }] }];
  assert.deepEqual(sf.withoutRestricted(videos, restricted).map((v) => v.id), [1, 4]);
  assert.deepEqual(sf.withoutRestricted(videos, new Set()).length, 4);
  assert.equal(sf.restrictedOwners(null).size, 0);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
