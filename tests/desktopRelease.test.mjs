/**
 * Test odkazů ke stažení appky do PC podle systému (lib/desktopRelease.ts):
 * Windows / macOS / Linux (AppImage, deb), názvy souborů jako píše
 * electron-builder v repu kine-desktop, rozpoznání systému z User-Agentu;
 * Kine Clipper pro Android (APK z repa kine-mobile, latest.json).
 *
 * Spustit:  node tests/desktopRelease.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE = 'https://stahnout.example/';
delete process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL;
const kam = prelozit('lib/desktopRelease.ts');
const R = await import(join(kam, 'desktopRelease.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('soubory podle systému - stejné názvy jako electron-builder (publish-config.mjs)', () => {
  assert.equal(R.DESKTOP_FILES.full.windows, 'Kine-Setup.exe');
  assert.equal(R.DESKTOP_FILES.full.mac, 'Kine-Mac.dmg');
  assert.equal(R.DESKTOP_FILES.full.linux, 'Kine-Linux.AppImage');
  assert.equal(R.DESKTOP_FILES.full['linux-deb'], 'Kine-Linux.deb');
  assert.equal(R.DESKTOP_FILES.clipper.mac, 'Kine-Clipper-Mac.dmg');
  assert.equal(R.DESKTOP_FILES.clipper.linux, 'Kine-Clipper-Linux.AppImage');
});

test('odkazy: úložiště (R2) ve složce appky, bez lomítka navíc', () => {
  assert.equal(R.desktopDownloadUrl('full'), 'https://stahnout.example/full/Kine-Setup.exe', 'výchozí = Windows jako dřív');
  assert.equal(R.desktopDownloadUrl('clipper', 'mac'), 'https://stahnout.example/clipper/Kine-Clipper-Mac.dmg');
  assert.equal(R.desktopDownloadUrl('full', 'linux-deb'), 'https://stahnout.example/full/Kine-Linux.deb');
  const all = R.desktopDownloads();
  assert.deepEqual(Object.keys(all.full).sort(), ['linux', 'linux-deb', 'mac', 'windows']);
  assert.equal(all.clipper.linux, 'https://stahnout.example/clipper/Kine-Clipper-Linux.AppImage');
});

test('systém z User-Agentu: Mac, Linux, jinak Windows; iPhone / Android nejsou PC', () => {
  assert.equal(R.detectDesktopOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'), 'mac');
  assert.equal(R.detectDesktopOs('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130'), 'linux');
  assert.equal(R.detectDesktopOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'), 'windows');
  assert.equal(R.detectDesktopOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'windows', 'telefon: výchozí Windows (stránka nabídne přepínač)');
  assert.equal(R.detectDesktopOs('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'windows');
  assert.equal(R.detectDesktopOs(''), 'windows');
  assert.ok(R.isDesktopOs('linux-deb') && !R.isDesktopOs('ios'));
});

test('Android (0118): APK z plovoucího vydání android-latest v repu kine-mobile; R2 jen když je NEXT_PUBLIC_ANDROID_DOWNLOAD_BASE', () => {
  // NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE je nastavené, ale pro Android se schválně nebere (repo kine-mobile nemusí do R2 nahrávat).
  assert.equal(R.androidDownloadUrl(), 'https://github.com/dezfghzdgz/kine-mobile/releases/download/android-latest/Kine-Clipper.apk');
  assert.equal(R.androidDownloadBase(), 'https://github.com/dezfghzdgz/kine-mobile/releases/download/android-latest');
  assert.equal(R.ANDROID_APK_NAME, 'Kine-Clipper.apk');
});

test('Android: systém z User-Agentu (telefon s Androidem předvybere záložku Android, iPhone zůstává u PC)', () => {
  assert.equal(R.detectDownloadOs('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile'), 'android');
  assert.equal(R.detectDownloadOs('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130'), 'linux');
  assert.equal(R.detectDownloadOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'windows');
  assert.equal(R.detectDownloadOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
});

test('Android: latest.json od build.yml (verze, datum, velikost); rozbité nebo prázdné = null', () => {
  const r = R.parseAndroidLatest('{ "version": "0.1.0", "versionCode": 1, "publishedAt": "2026-10-19T10:00:00Z", "sizeBytes": 2345678, "file": "Kine-Clipper.apk", "signed": false }');
  assert.deepEqual(r, { version: '0.1.0', publishedAt: '2026-10-19T10:00:00Z', sizeBytes: 2345678 });
  assert.equal(R.parseAndroidLatest('{ "version": "" }'), null);
  assert.equal(R.parseAndroidLatest('not json'), null);
  assert.deepEqual(R.parseAndroidLatest('{ "version": "0.2.0", "sizeBytes": "x" }'), { version: '0.2.0', publishedAt: null, sizeBytes: null });
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
process.exit(padly ? 1 : 0);
