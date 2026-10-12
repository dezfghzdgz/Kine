/**
 * Test vlastního náhledu přenosu (lib/liveThumbnail.ts): rozměry JPEGu
 * z hlavičky, co server přijme, a ořez na 16:9.
 *
 * Spustit:  node tests/liveThumbnail.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/liveThumbnail.ts');
const lt = await import(join(kam, 'liveThumbnail.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

/** Hlavička JPEGu: SOI, APP0 (JFIF), volitelně výplň, SOF (rozměry), SOS. */
function jpeg(width, height, { sof = 0xc0, padding = false, exif = 0 } = {}) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const app1 = exif ? [0xff, 0xe1, (exif + 2) >> 8, (exif + 2) & 0xff, ...new Array(exif).fill(0x41)] : [];
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00];
  const sofSeg = [0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, ...(padding ? [0xff, 0xff] : []), ...dqt, ...sofSeg, ...sos, 0x12, 0x34, 0xff, 0xd9]);
}

test('rozměry z hlavičky JPEGu (i progresivní, s EXIFem a výplní)', () => {
  assert.deepEqual(lt.jpegSize(jpeg(1280, 720)), { width: 1280, height: 720 });
  assert.deepEqual(lt.jpegSize(jpeg(1920, 1080, { sof: 0xc2 })), { width: 1920, height: 1080 });
  assert.deepEqual(lt.jpegSize(jpeg(640, 360, { exif: 3000 })), { width: 640, height: 360 });
  assert.deepEqual(lt.jpegSize(jpeg(800, 450, { padding: true })), { width: 800, height: 450 });
});

test('PNG, GIF, prázdno ani useknutý soubor nejsou JPEG', () => {
  assert.equal(lt.jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), null);
  assert.equal(lt.jpegSize(new TextEncoder().encode('GIF89a......')), null);
  assert.equal(lt.jpegSize(new Uint8Array()), null);
  assert.equal(lt.jpegSize(jpeg(1280, 720).slice(0, 30)), null);
  // DHT (C4) není SOF - rozměry z něj nečíst
  const dhtFirst = new Uint8Array([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x08, 0, 0, 0, 0, 0, 0, ...jpeg(320, 180).slice(2)]);
  assert.deepEqual(lt.jpegSize(dhtFirst), { width: 320, height: 180 });
});

test('server přijme jen JPEG rozumné velikosti', () => {
  assert.deepEqual(lt.checkLiveThumbnail(jpeg(1280, 720)), { ok: true, width: 1280, height: 720 });
  assert.equal(lt.checkLiveThumbnail(new Uint8Array()).code, 'empty');
  assert.equal(lt.checkLiveThumbnail(new Uint8Array(lt.LIVE_THUMBNAIL_MAX_BYTES + 1)).code, 'too-big');
  assert.equal(lt.checkLiveThumbnail(new TextEncoder().encode('<svg></svg>')).code, 'not-jpeg');
  assert.equal(lt.checkLiveThumbnail(jpeg(20, 20)).code, 'size');
  assert.equal(lt.checkLiveThumbnail(jpeg(9000, 5000)).code, 'size');
  // víc než 1280×720 studio ani appka nepošlou - a kontrola obsahu by obří obrázek nepřečetla
  assert.equal(lt.checkLiveThumbnail(jpeg(1920, 1080)).code, 'size');
  assert.equal(lt.checkLiveThumbnail(jpeg(1281, 720)).code, 'size');
  assert.equal(lt.checkLiveThumbnail(jpeg(640, 360)).ok, true);
});

test('náhled leží ve složce, kam zapisuje jen server, a smaže se jen ten svého kanálu', () => {
  const owner = '5881290a-10c0-4136-84d8-ca7cfc97f20e';
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const path = lt.newLiveThumbnailPath(owner, id);
  assert.equal(path, `live/${owner}/${id}.jpg`);
  const url = `https://abc.supabase.co/storage/v1/object/public/thumbnails/${path}`;
  assert.equal(lt.liveThumbnailPath(url, owner), path);
  assert.equal(lt.liveThumbnailPath(url + '?t=1', owner), path);
  // cizí kanál, stará cesta ve složce uživatele, výlet o složku výš, nesmysly
  assert.equal(lt.liveThumbnailPath(url, '11111111-1111-1111-1111-111111111111'), null);
  assert.equal(lt.liveThumbnailPath(`https://abc.supabase.co/storage/v1/object/public/thumbnails/${owner}/live-thumbnail.jpg`, owner), null);
  assert.equal(lt.liveThumbnailPath(`https://abc.supabase.co/storage/v1/object/public/thumbnails/live/${owner}/../x.jpg`, owner), null);
  assert.equal(lt.liveThumbnailPath(`https://abc.supabase.co/storage/v1/object/public/thumbnails/live/${owner}/a%2F..%2Fb.jpg`, owner), null);
  assert.equal(lt.liveThumbnailPath(`https://abc.supabase.co/storage/v1/object/public/thumbnails/live/${owner}/%E0%A4%A.jpg`, owner), null);
  assert.equal(lt.liveThumbnailPath(null, owner), null);
  assert.equal(lt.liveThumbnailPath('https://evil.example/x.jpg', owner), null);
});

test('ořez na 16:9 jako object-fit: cover', () => {
  // na výšku: vezme se prostředek
  assert.deepEqual(lt.coverRect(1080, 1920, 1280, 720), { sx: 0, sy: (1920 - 607.5) / 2, sw: 1080, sh: 607.5 });
  // širší než 16:9: oříznou se boky
  const r = lt.coverRect(2560, 1080, 1280, 720);
  assert.equal(r.sy, 0);
  assert.equal(r.sh, 1080);
  assert.equal(Math.round(r.sw), 1920);
  assert.equal(Math.round(r.sx), 320);
  // přesně 16:9: celý obrázek
  assert.deepEqual(lt.coverRect(1920, 1080, 1280, 720), { sx: 0, sy: 0, sw: 1920, sh: 1080 });
  // nesmysl nespadne
  assert.deepEqual(lt.coverRect(0, 0, 1280, 720), { sx: 0, sy: 0, sw: 0, sh: 0 });
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
