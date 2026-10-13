/**
 * Test "před chvílí" (lib/timeAgo.ts).
 *
 * Spustit:  node tests/timeAgo.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/timeAgo.ts');
const { timeAgo } = await import(join(kam, 'timeAgo.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const NOW = Date.parse('2026-10-13T12:00:00Z');
const ago = (s) => new Date(NOW - s * 1000).toISOString();

test('česky: teď, minuty, hodiny, dny, týdny, měsíce, roky', () => {
  assert.equal(timeAgo(ago(10), 'cs-CZ', NOW), 'nyní');
  assert.equal(timeAgo(ago(5 * 60), 'cs-CZ', NOW), 'před 5 minutami');
  assert.equal(timeAgo(ago(3 * 3600), 'cs-CZ', NOW), 'před 3 hodinami');
  assert.equal(timeAgo(ago(26 * 3600), 'cs-CZ', NOW), 'včera');
  assert.equal(timeAgo(ago(10 * 86400), 'cs-CZ', NOW), 'minulý týden');
  assert.equal(timeAgo(ago(17 * 86400), 'cs-CZ', NOW), 'před 2 týdny');
  assert.equal(timeAgo(ago(65 * 86400), 'cs-CZ', NOW), 'před 2 měsíci');
  assert.equal(timeAgo(ago(800 * 86400), 'cs-CZ', NOW), 'před 2 lety');
});

test('anglicky a neplatné vstupy', () => {
  assert.equal(timeAgo(ago(3 * 3600), 'en-US', NOW), '3 hours ago');
  assert.equal(timeAgo(null, 'cs-CZ', NOW), '');
  assert.equal(timeAgo('nesmysl', 'cs-CZ', NOW), '');
  assert.equal(timeAgo(ago(3 * 3600), 'xx-nonsense-!!', NOW).length > 0, true);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
