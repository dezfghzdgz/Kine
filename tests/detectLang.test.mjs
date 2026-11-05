/**
 * Jazyk podle prohlížeče (lib/i18n/detect.ts).
 *
 * Spustit:  node tests/detectLang.test.mjs
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/i18n/detect.ts');
const m = await import(join(kam, 'detect.js'));

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

test('cs-CZ -> cs, sk -> sk, en-US -> en', () => {
  assert.equal(m.detectLang(['cs-CZ', 'en-US']), 'cs');
  assert.equal(m.detectLang(['sk']), 'sk');
  assert.equal(m.detectLang(['en-US', 'cs']), 'en');
  assert.equal(m.detectLang(['uk-UA']), 'uk');
  assert.equal(m.detectLang(['DE-de']), 'de');
});

test('nepodporovaný jazyk napřed: vezme se první podporovaný; nic = angličtina', () => {
  assert.equal(m.detectLang(['hu-HU', 'cs']), 'cs');
  assert.equal(m.detectLang(['hu', 'ja']), 'en');
  assert.equal(m.detectLang([]), 'en');
  assert.equal(m.detectLang(null), 'en');
  assert.equal(m.detectLang(undefined), 'en');
});

test('isLang', () => {
  assert.equal(m.isLang('cs'), true);
  assert.equal(m.isLang('xx'), false);
  assert.equal(m.isLang(null), false);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
