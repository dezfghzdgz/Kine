/**
 * Test odkazů ke stažení appky do PC podle systému (lib/desktopRelease.ts):
 * Windows / macOS / Linux (AppImage, deb), názvy souborů jako píše
 * electron-builder v repu kine-desktop, rozpoznání systému z User-Agentu.
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

console.log(`\n${prosly} prošlo, ${padly} padlo`);
process.exit(padly ? 1 : 0);
