/**
 * Test sdílení odkazu (lib/share.ts).
 *
 * Nejde o to, jestli se otevře systémové okno - to rozhodne prohlížeč.
 * Jde o pořadí a o hranice: kdy se kopíruje, kdy ne, a hlavně že zavření
 * okna bez výběru nesmí skončit hláškou "odkaz zkopírován".
 *
 * Spustit:  node tests/share.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/share.ts');
const { shareLink } = await import(join(kam, 'share.js'));

let prosly = 0;
let padly = 0;
const testy = [];
function test(nazev, fn) { testy.push([nazev, fn]); }

const ODKAZ = { url: 'https://kine-lac.vercel.app/watch/abc', title: 'Video' };

test('na dotyku se použije systémové sdílení a nic se nekopíruje', async () => {
  let sdileno = null;
  let kopirovano = false;
  const v = await shareLink(ODKAZ, {
    nativeAvailable: true,
    share: async (d) => { sdileno = d; },
    copy: async () => { kopirovano = true; },
  });
  assert.equal(v, 'shared');
  assert.deepEqual(sdileno, ODKAZ);
  assert.equal(kopirovano, false);
});

test('na počítači se kopíruje, i když prohlížeč sdílení umí', async () => {
  let kopirovano = null;
  const v = await shareLink(ODKAZ, {
    nativeAvailable: false,
    share: async () => { throw new Error('tohle se nemá volat'); },
    copy: async (t) => { kopirovano = t; },
  });
  assert.equal(v, 'copied');
  assert.equal(kopirovano, ODKAZ.url);
});

test('zavření systémového okna bez výběru není chyba a nic se nekopíruje', async () => {
  let kopirovano = false;
  const abort = Object.assign(new Error('The user aborted'), { name: 'AbortError' });
  const v = await shareLink(ODKAZ, {
    nativeAvailable: true,
    share: async () => { throw abort; },
    copy: async () => { kopirovano = true; },
  });
  assert.equal(v, 'cancelled');
  assert.equal(kopirovano, false, 'po zavření okna nesmí přijít hláška "zkopírováno"');
});

test('jiná chyba sdílení spadne na schránku', async () => {
  let kopirovano = false;
  const v = await shareLink(ODKAZ, {
    nativeAvailable: true,
    share: async () => { throw new Error('NotAllowedError'); },
    copy: async () => { kopirovano = true; },
  });
  assert.equal(v, 'copied');
  assert.equal(kopirovano, true);
});

test('když nejde ani schránka, vrátí se failed a nic nespadne', async () => {
  const v = await shareLink(ODKAZ, {
    nativeAvailable: false,
    copy: async () => { throw new Error('clipboard denied'); },
  });
  assert.equal(v, 'failed');
  const bez = await shareLink(ODKAZ, { nativeAvailable: false });
  assert.equal(bez, 'failed');
});

for (const [nazev, fn] of testy) {
  try { await fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}
console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
