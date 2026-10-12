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

test('výchozí název záznamu', () => {
  assert.equal(r.defaultRecordingTitle('2026-10-11T20:00:00Z'), 'Live stream 2026-10-11');
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
