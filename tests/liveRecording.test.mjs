/**
 * Test výběru záznamu vysílání ke zveřejnění (lib/liveRecordingRules.ts).
 *
 * Spustit:  node tests/liveRecording.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/liveRecordingRules.ts');
const r = await import(join(kam, 'liveRecordingRules.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const NOW = Date.parse('2026-10-11T22:00:00Z');
const rec = (uid, hoursAgo) => ({ uid, created: new Date(NOW - hoursAgo * 3600e3).toISOString(), state: 'ready' });

test('latest = nejnovější záznam', () => {
  const list = [rec('old', 30), rec('new', 0.2), rec('mid', 5)];
  assert.equal(r.pickRecording(list, 'latest', new Set(), NOW).uid, 'new');
  assert.equal(r.pickRecording(list, '', new Set(), NOW).uid, 'new');
});

test('latest přeskočí už zveřejněné a záznamy starší než 48 h', () => {
  const list = [rec('new', 0.2), rec('mid', 5), rec('ancient', 60)];
  assert.equal(r.pickRecording(list, 'latest', new Set(['new']), NOW).uid, 'mid');
  assert.equal(r.pickRecording([rec('ancient', 60)], 'latest', new Set(), NOW), null);
});

test('konkrétní záznam jen ze seznamu kanálu (cizí id neprojde)', () => {
  const list = [rec('a', 1), rec('b', 2)];
  assert.equal(r.pickRecording(list, 'b', new Set(), NOW).uid, 'b');
  assert.equal(r.pickRecording(list, 'cizi', new Set(), NOW), null);
});

test('viditelnost záznamu: jen povolené hodnoty', () => {
  assert.equal(r.parseRecordingVisibility('public'), 'public');
  assert.equal(r.parseRecordingVisibility('subscribers'), 'subscribers');
  assert.equal(r.parseRecordingVisibility('private'), 'private');
  assert.equal(r.parseRecordingVisibility('off'), null);
  assert.equal(r.parseRecordingVisibility('unlisted'), null);
  assert.equal(r.parseRecordingVisibility(null), null);
});

test('Zahodit podle času vysílání: záznamy z okna, bez zveřejněných a bez běžícího', () => {
  const at = (minutes) => new Date(NOW - minutes * 60 * 1000).toISOString();
  const list = [
    { uid: 'pred', created: at(130) },        // dávno před vysíláním
    { uid: 'kratke', created: at(63) },       // minulé krátké vysílání těsně před tímhle - zůstane
    { uid: 'start', created: at(60.5) },      // Cloudflare ho založil chvíli před "vysílám" v appce
    { uid: 'vypadek', created: at(30) },      // výpadek delší než minuta = druhý záznam
    { uid: 'zverejneny', created: at(20) },   // už je video na Kine
    { uid: 'po', created: at(1) },            // nové vysílání po konci
    { uid: 'bezcasu', created: null },
  ];
  const window = { since: NOW - 60 * 60 * 1000, until: NOW - 10 * 60 * 1000 };
  const picked = r.recordingsInWindow(list, window, { published: new Set(['zverejneny']) }).map((x) => x.uid);
  assert.deepEqual(picked, ['start', 'vypadek']);
  assert.deepEqual(r.recordingsInWindow(list, window, { keep: 'vypadek' }).map((x) => x.uid), ['start', 'zverejneny']);
  assert.deepEqual(r.recordingsInWindow([], window), []);
});

test('okno vysílání: hodiny počítače jinak než server -> posun podle clientNow', () => {
  // appce jdou hodiny o 5 min pozadu: server okno posune o +5 min
  const skew = 5 * 60 * 1000;
  assert.equal(r.clockSkew(NOW - skew, NOW), skew);
  assert.equal(r.clockSkew(String(NOW + 2000), NOW), -2000);
  assert.equal(r.clockSkew(undefined, NOW), 0);
  assert.equal(r.clockSkew('x', NOW), 0);
  assert.equal(r.clockSkew(NOW - 8 * 86400e3, NOW), 0, 'nesmysl (víc než týden) se nebere');
  const w = r.parseStreamWindow(NOW - 3600e3 - skew, NOW - 60e3 - skew, NOW, NOW - skew);
  assert.deepEqual(w, { since: NOW - 3600e3, until: NOW - 60e3 });
  // záznam založený 30 s před začátkem (čas serveru / Cloudflare) se najde, i když appka hlásí čas o 5 min jinak
  const rec = [{ uid: 'start', created: new Date(NOW - 3600e3 - 30e3).toISOString() }];
  assert.deepEqual(r.recordingsInWindow(rec, w).map((x) => x.uid), ['start']);
  // appce jdou hodiny o 5 min napřed: bez posunu by okno začalo pozdě a záznam by se nenašel, s posunem ano
  const ahead = r.parseStreamWindow(NOW - 3600e3 + skew, NOW - 60e3 + skew, NOW, NOW + skew);
  assert.deepEqual(ahead, { since: NOW - 3600e3, until: NOW - 60e3 });
  assert.deepEqual(r.recordingsInWindow(rec, ahead).map((x) => x.uid), ['start']);
  assert.deepEqual(r.recordingsInWindow(rec, { since: NOW - 3600e3 + skew, until: NOW - 60e3 + skew }).map((x) => x.uid), []);
});

test('okno vysílání z appky: jen rozumné hodnoty', () => {
  assert.deepEqual(r.parseStreamWindow(NOW - 3600e3, NOW - 60e3, NOW), { since: NOW - 3600e3, until: NOW - 60e3 });
  assert.equal(r.parseStreamWindow('x', NOW, NOW), null);
  assert.equal(r.parseStreamWindow(NOW, NOW - 1000, NOW), null, 'konec před začátkem');
  assert.equal(r.parseStreamWindow(NOW - 3 * 86400e3, NOW, NOW), null, 'delší než 2 dny');
  assert.equal(r.parseStreamWindow(NOW, NOW + 3600e3, NOW), null, 'budoucnost');
  assert.equal(r.parseStreamWindow(NOW - 9 * 86400e3, NOW - 8 * 86400e3, NOW), null, 'staré');
  assert.equal(r.parseStreamWindow(0, NOW, NOW), null);
  assert.equal(r.parseStreamWindow(null, NOW, NOW, NOW), null);
  assert.equal(r.parseStreamWindow('', NOW, NOW, NOW - 5000), null, 'prázdný začátek ani s posunem hodin');
  // budoucnost se posuzuje až po posunu: appce jdou hodiny o hodinu napřed - konec "za hodinu" je teď
  assert.deepEqual(r.parseStreamWindow(NOW, NOW + 3600e3, NOW, NOW + 3600e3 + 1000), { since: NOW - 3600e3 - 1000, until: NOW - 1000 });
});

test('výchozí název záznamu', () => {
  assert.equal(r.defaultRecordingTitle('2026-10-11T20:00:00Z'), 'Live stream 2026-10-11');
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
