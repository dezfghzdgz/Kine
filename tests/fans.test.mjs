/**
 * Zeď fanoušků (lib/fans.ts): přezdívky z Instagramu, vložení víc jmen naráz,
 * den kampaně podle pražského kalendáře, řazení podle dnů.
 *
 * Spustit:  node tests/fans.test.mjs
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/fans.ts');
const f = await import(join(kam, 'fans.js'));

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

test('přezdívka: @, velká písmena, odkaz na profil', () => {
  assert.equal(f.normalizeHandle('@Jakub_Koubek'), 'jakub_koubek');
  assert.equal(f.normalizeHandle('  lucie.hraje  '), 'lucie.hraje');
  assert.equal(f.normalizeHandle('https://www.instagram.com/Frag.Master/?igsh=abc123'), 'frag.master');
  assert.equal(f.normalizeHandle('instagram.com/rocketman'), 'rocketman');
  assert.equal(f.normalizeHandle('m.instagram.com/nekdo/'), 'nekdo');
});

test('přezdívka: nesmysly neprojdou', () => {
  for (const bad of ['', '@', 'má mezeru', 'čeština', 'a'.repeat(31), '<script>', '...', 'https://evil.cz/x', null, 42, '@@']) {
    assert.equal(f.normalizeHandle(bad), null, String(bad));
  }
});

test('víc jmen naráz: řádky, čárky, duplicity, špatná jména zvlášť', () => {
  const r = f.parseHandles('@jedna\ndva, Tri ; jedna\n\n  @Dva  špatné!jméno');
  assert.deepEqual(r.valid, ['jedna', 'dva', 'tri']);
  assert.deepEqual(r.invalid, ['špatné!jméno']);
  assert.deepEqual(f.parseHandles(undefined), { valid: [], invalid: [] });
});

test('víc jmen naráz: strop', () => {
  const text = Array.from({ length: 300 }, (_, i) => `fan${i}`).join('\n');
  assert.equal(f.parseHandles(text).valid.length, f.MAX_BULK);
});

test('den kampaně: bez jmen i hned první den je Den 1', () => {
  const first = Date.parse('2026-11-03T08:00:00Z');
  assert.equal(f.campaignDay(null, first), 1);
  assert.equal(f.campaignDay(first, first), 1);
});

// 22:30 UTC je 23:30 v Praze (CET, UTC+1) - pořád 3. listopad = Den 1; 23:30 UTC už je 4. listopad.
test('den kampaně: půlnoc podle Prahy, ne UTC', () => {
  const first = Date.parse('2026-11-03T08:00:00Z');
  assert.equal(f.campaignDay(first, Date.parse('2026-11-03T22:30:00Z')), 1);
  assert.equal(f.campaignDay(first, Date.parse('2026-11-03T23:30:00Z')), 2, '00:30 v Praze už je další den');
  assert.equal(f.campaignDay(first, Date.parse('2026-11-12T10:00:00Z')), 10);
  // Přes změnu času (konec března) se dny nesmí posunout.
  assert.equal(f.campaignDay(Date.parse('2027-03-27T10:00:00Z'), Date.parse('2027-03-29T10:00:00Z')), 3);
});

test('číslo dne od správce', () => {
  assert.equal(f.cleanDay('3'), 3);
  assert.equal(f.cleanDay(7), 7);
  for (const bad of ['', '0', '-1', '2.5', 'abc', 100001, null, undefined]) assert.equal(f.cleanDay(bad), null, String(bad));
});

test('řazení podle dnů: nejnovější den a jméno nahoře', () => {
  const e = (id, day, at) => ({ id, handle: `h${id}`, day, createdAt: at, kine: null });
  const g = f.groupByDay([e(1, 1, '2026-11-03T08:00:00Z'), e(2, 2, '2026-11-04T08:00:00Z'), e(3, 1, '2026-11-03T09:00:00Z'), e(4, 2, '2026-11-04T07:00:00Z')]);
  assert.deepEqual(g.map((d) => d.day), [2, 1]);
  assert.deepEqual(g[0].entries.map((x) => x.id), [2, 4]);
  assert.deepEqual(g[1].entries.map((x) => x.id), [3, 1]);
});

test('odkaz na Instagram Kine z nastavení', () => {
  assert.equal(f.instagramProfileUrl('@playkine'), 'https://www.instagram.com/playkine/');
  assert.equal(f.instagramProfileUrl('https://instagram.com/PlayKine?x=1'), 'https://www.instagram.com/playkine/');
  assert.equal(f.instagramProfileUrl('javascript:alert(1)'), null);
  assert.equal(f.instagramProfileUrl(''), null);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
