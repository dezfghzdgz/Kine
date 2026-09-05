/**
 * Test určení zařízení (lib/deviceClass.ts).
 * Spustit:  node tests/deviceClass.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/deviceClass.ts');
const { deviceClass, sanitizeDeviceClass } = await import(join(kam, 'deviceClass.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';
const TIZEN = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 Chrome/76.0 TV Safari/537.36';
const WEBOS = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/79.0 Safari/537.36 WebAppManager';
const ANDROID_TV = 'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K VH2) AppleWebKit/537.36 Chrome/96.0 Safari/537.36';

test('telefon: dotyk a kratší strana pod 600', () => {
  assert.equal(deviceClass({ coarse: true, width: 390, height: 844, userAgent: IPHONE }), 'phone');
  assert.equal(deviceClass({ coarse: true, width: 844, height: 390, userAgent: IPHONE }), 'phone', 'na šířku pořád telefon');
});

test('tablet: dotyk a větší obrazovka (iPad se vydává za Mac, přesto vyjde tablet)', () => {
  assert.equal(deviceClass({ coarse: true, width: 820, height: 1180, userAgent: IPAD }), 'tablet');
});

test('počítač: myš', () => {
  assert.equal(deviceClass({ coarse: false, width: 1920, height: 1080, userAgent: CHROME }), 'desktop');
  assert.equal(deviceClass({ coarse: false, width: 1440, height: 900, userAgent: IPAD }), 'desktop', 'Mac s myší je počítač');
});

test('televize podle prohlížeče, ať hlásí cokoliv o dotyku', () => {
  assert.equal(deviceClass({ coarse: false, width: 1920, height: 1080, userAgent: TIZEN }), 'tv');
  assert.equal(deviceClass({ coarse: true, width: 1920, height: 1080, userAgent: WEBOS }), 'tv');
  assert.equal(deviceClass({ coarse: false, width: 3840, height: 2160, userAgent: ANDROID_TV }), 'tv');
});

test('4K monitor s myší není televize', () => {
  assert.equal(deviceClass({ coarse: false, width: 3840, height: 2160, userAgent: CHROME }), 'desktop');
});

test('bez rozměrů se dotyk bere jako tablet, ne pád', () => {
  assert.equal(deviceClass({ coarse: true, width: 0, height: 0, userAgent: '' }), 'tablet');
});

test('server přijme jen čtyři hodnoty', () => {
  assert.equal(sanitizeDeviceClass('phone'), 'phone');
  assert.equal(sanitizeDeviceClass('tv'), 'tv');
  assert.equal(sanitizeDeviceClass('toaster'), null);
  assert.equal(sanitizeDeviceClass(42), null);
  assert.equal(sanitizeDeviceClass(undefined), null);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
