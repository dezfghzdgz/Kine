/**
 * Test průvodce po registraci (lib/welcome.ts).
 *
 * Spustit:  node tests/welcome.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/welcome.ts');
const w = await import(join(kam, 'welcome.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const empty = { agreedToRules: false, viewerType: null, ratingMode: null, contentPreference: null };

test('nový účet začíná pravidly, pak po pořadí', () => {
  assert.equal(w.firstWelcomeStep(empty), 'rules');
  assert.equal(w.firstWelcomeStep({ ...empty, agreedToRules: true }), 'purpose');
  assert.equal(w.firstWelcomeStep({ ...empty, agreedToRules: true, viewerType: 'viewer' }), 'rating');
  assert.equal(w.firstWelcomeStep({ ...empty, agreedToRules: true, viewerType: 'creator', ratingMode: 'stars' }), 'content');
  assert.equal(w.firstWelcomeStep({ agreedToRules: true, viewerType: 'viewer', ratingMode: 'stars', contentPreference: 'long' }), 'done');
});

test('pravidla mají přednost, i když je zbytek vyplněný (starší účet bez souhlasu)', () => {
  assert.equal(w.firstWelcomeStep({ agreedToRules: false, viewerType: 'viewer', ratingMode: 'stars', contentPreference: 'long' }), 'rules');
  assert.equal(w.needsWelcome({ agreedToRules: true, viewerType: 'viewer', ratingMode: 'stars', contentPreference: 'long' }), false);
  assert.equal(w.needsWelcome(empty), true);
});

test('kroky v pořadí, poslední je "hotovo"', () => {
  assert.deepEqual([...w.WELCOME_STEPS], ['rules', 'purpose', 'rating', 'content', 'done']);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
