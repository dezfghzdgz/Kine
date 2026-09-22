/**
 * Test pravidel předplatného (lib/plus.ts) a čtení latest.yml
 * (lib/desktopRelease.ts).
 *
 * Spustit:  node tests/plus.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

process.env.STRIPE_PLUS_KINE_PRICE_ID = 'price_kine';
process.env.STRIPE_PLUS_CLIPS_PRICE_ID = 'price_clips';
process.env.STRIPE_PLUS_PRICE_ID = 'price_all_legacy';
process.env.NEXT_PUBLIC_PLUS_CLIPS_PRICE_LABEL = '79 Kč / měsíc';

const kam = prelozit('lib/plus.ts', 'lib/desktopRelease.ts');
const plus = await import(join(kam, 'plus.js'));
const release = await import(join(kam, 'desktopRelease.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const zaRok = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const vcera = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

test('tři varianty: kdo má co', () => {
  assert.equal(plus.hasKinePlus('kine', null), true);
  assert.equal(plus.hasClipsPlus('kine', null), false, 'Kine Plus nedává automatické nahrávání');
  assert.equal(plus.hasKinePlus('clips', null), false, 'Klipy Plus nedávají odznak');
  assert.equal(plus.hasClipsPlus('clips', null), true);
  assert.equal(plus.hasKinePlus('all', zaRok) && plus.hasClipsPlus('all', zaRok), true);
  assert.equal(plus.hasKinePlus('plus', null) && plus.hasClipsPlus('plus', null), true, 'starší hodnota plus = all');
  assert.equal(plus.hasPlus('clips', null), true);
  assert.equal(plus.hasPlus('free', null), false);
  assert.equal(plus.hasPlus('all', vcera), false, 'prošlé předplatné neplatí');
  assert.equal(plus.normalizePlan('premium'), 'free');
});

test('ceny a Stripe podle varianty (starší STRIPE_PLUS_PRICE_ID = all)', () => {
  assert.equal(plus.tierStripePriceId('kine'), 'price_kine');
  assert.equal(plus.tierStripePriceId('all'), 'price_all_legacy');
  assert.equal(plus.tierFromStripePriceId('price_clips'), 'clips');
  assert.equal(plus.tierFromStripePriceId('price_neznama'), null);
  assert.equal(plus.anyTierAvailable(), true);
  assert.deepEqual(plus.allPriceLabels(), { kine: null, clips: '79 Kč / měsíc', all: null });
  assert.ok(plus.isPaidTier('clips') && !plus.isPaidTier('free') && !plus.isPaidTier('plus'));
  assert.equal(plus.KINE_PLUS_UPLOAD_MULTIPLIER, 3);
});

test('latest.yml od electron-builderu', () => {
  const yml = "version: 0.2.0\nfiles:\n  - url: Kine-Setup.exe\n    sha512: abc\n    size: 134217728\npath: Kine-Setup.exe\nsha512: abc\nreleaseDate: '2026-09-21T18:00:00.000Z'\n";
  assert.deepEqual(release.parseLatestYml(yml), { version: '0.2.0', publishedAt: '2026-09-21T18:00:00.000Z', sizeBytes: 134217728 });
  assert.equal(release.parseLatestYml('nesmysl'), null);
});

test('adresy instalátoru: úložiště, jinak GitHub; dva názvy', () => {
  assert.equal(release.desktopDownloadUrl('full'), 'https://github.com/dezfghzdgz/kine-desktop/releases/latest/download/Kine-Setup.exe');
  assert.equal(release.desktopDownloadUrl('clipper'), 'https://github.com/dezfghzdgz/kine-desktop/releases/latest/download/Kine-Clipper-Setup.exe');
  assert.equal(release.DESKTOP_INSTALLER_NAMES.clipper, 'Kine-Clipper-Setup.exe');
});

test('proužek "Kine do PC" se po zavření vrátí za týden', () => {
  const now = Date.now();
  const den = 24 * 3600 * 1000;
  assert.equal(release.desktopBannerDismissed(null, now), false, 'nikdy nezavřený se ukáže');
  assert.equal(release.desktopBannerDismissed(String(now - 2 * den), now), true, 'zavřený před dvěma dny zůstává schovaný');
  assert.equal(release.desktopBannerDismissed(String(now - 8 * den), now), false, 'po týdnu se ukáže znovu');
  assert.equal(release.desktopBannerDismissed('1', now), true, 'starší "1" se bere jako zavřené teď');
  assert.equal(release.desktopBannerDismissed('nesmysl', now), true);
  assert.equal(release.DESKTOP_BANNER_SHOW_AGAIN_MS, 7 * den);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
process.exit(padly ? 1 : 0);
