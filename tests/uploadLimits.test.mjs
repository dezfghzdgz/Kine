/**
 * Test limitů nahrávání (lib/uploadLimits.ts) a obrázků do úložiště
 * (lib/imageUpload.ts).
 *
 * Spustit:  node tests/uploadLimits.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/uploadLimits.ts', 'lib/imageUpload.ts');
const L = await import(join(kam, 'uploadLimits.js'));
const I = await import(join(kam, 'imageUpload.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const now = Date.parse('2026-10-15T12:00:00Z');
const old = '2026-01-01T00:00:00Z';
const fresh = '2026-10-15T10:00:00Z';
const free = L.uploadLimitsFor({ staff: false, plus: false, accountCreatedAt: old }, {}, now);
const plus = L.uploadLimitsFor({ staff: false, plus: true, accountCreatedAt: old }, {}, now);
const nove = L.uploadLimitsFor({ staff: false, plus: false, accountCreatedAt: fresh }, {}, now);
const tym = L.uploadLimitsFor({ staff: true, plus: false, accountCreatedAt: fresh }, {}, now);

test('výchozí limity zdarma / Plus / nový účet / tým', () => {
  assert.deepEqual(free, { tier: 'free', maxVideoSeconds: 7200, perDay: 20, secondsPerDay: 14400, storageSeconds: 108000, pending: 2 });
  assert.equal(plus.tier, 'plus');
  assert.equal(plus.maxVideoSeconds, 21600, 'Plus: 3x delší video');
  assert.equal(plus.perDay, 60);
  assert.equal(plus.storageSeconds, 3 * 108000);
  assert.equal(nove.tier, 'new');
  assert.equal(nove.maxVideoSeconds, 15 * 60);
  assert.equal(nove.perDay, 3);
  assert.equal(nove.pending, 1);
  assert.equal(tym.tier, 'staff');
  assert.equal(tym.storageSeconds, 0, 'tým bez stropu úložiště');
  assert.equal(L.uploadLimitsFor({ staff: false, plus: true, accountCreatedAt: fresh }, {}, now).tier, 'plus', 'Plus není "nový účet"');
  assert.equal(L.uploadLimitsFor({ staff: false, plus: false, accountCreatedAt: null }, {}, now).tier, 'free', 'neznámé stáří = starý účet');
});

test('proměnné na Vercelu', () => {
  const env = { UPLOAD_DAILY_LIMIT: '5', UPLOAD_DAILY_MINUTES: '60', UPLOAD_MAX_VIDEO_MINUTES: '30', UPLOAD_STORAGE_HOURS: '0', UPLOAD_NEW_ACCOUNT_HOURS: '0' };
  const l = L.uploadLimitsFor({ staff: false, plus: false, accountCreatedAt: fresh }, env, now);
  assert.equal(l.tier, 'free', 'UPLOAD_NEW_ACCOUNT_HOURS=0 vypne nový účet');
  assert.equal(l.perDay, 5);
  assert.equal(l.secondsPerDay, 3600);
  assert.equal(l.maxVideoSeconds, 1800);
  assert.equal(l.storageSeconds, 0, '0 = bez stropu');
  assert.equal(L.uploadLimitsFor({ staff: false, plus: false, accountCreatedAt: old }, { UPLOAD_DAILY_LIMIT: 'nesmysl' }, now).perDay, 20);
  assert.equal(L.uploadLimitsFor({ staff: false, plus: true, accountCreatedAt: old }, { UPLOAD_MAX_VIDEO_MINUTES: '600' }, now).maxVideoSeconds, 36000, 'nejvýš 10 h (Cloudflare)');
  assert.equal(L.uploadsPaused({}), null);
  assert.ok(L.uploadsPaused({ UPLOADS_PAUSED: '1' }));
});

test('rezerva u Cloudflare = délka videa, ne 6 hodin', () => {
  const r = L.checkUpload(free, L.NO_USAGE, 600);
  assert.equal(r.ok, true);
  assert.equal(r.reserveSeconds, Math.ceil(600 * 1.05) + 30);
  const krátké = L.checkUpload(free, L.NO_USAGE, 5);
  assert.equal(krátké.reserveSeconds, 60, 'nejméně minuta');
  const neznámá = L.checkUpload(free, L.NO_USAGE, null);
  assert.equal(neznámá.reserveSeconds, 7200, 'bez délky strop videa');
  const naHraně = L.checkUpload(free, L.NO_USAGE, 7199);
  assert.equal(naHraně.reserveSeconds, 7200, 'rezerva nepřeleze strop');
});

test('moc dlouhé video, rozpracovaná nahrávání, počet za den', () => {
  const dlouhé = L.checkUpload(free, L.NO_USAGE, 7300);
  assert.equal(dlouhé.ok, false);
  assert.equal(dlouhé.code, 'too-long');
  assert.equal(dlouhé.status, 413);
  assert.match(L.checkUpload(nove, L.NO_USAGE, 20 * 60).message, /Nový účet/);
  assert.equal(L.checkUpload(free, { ...L.NO_USAGE, pending: 2 }, 60).code, 'busy');
  assert.equal(L.checkUpload(free, { ...L.NO_USAGE, uploadsToday: 20 }, 60).code, 'daily-count');
  assert.equal(L.checkUpload(free, { ...L.NO_USAGE, uploadsToday: 19 }, 60).ok, true);
});

test('minuty za den', () => {
  const skoro = { ...L.NO_USAGE, secondsToday: 14400 - 300 };
  assert.equal(L.checkUpload(free, skoro, 200).ok, true, 'kratší video projde');
  const r = L.checkUpload(free, skoro, 400);
  assert.equal(r.code, 'daily-minutes');
  assert.match(r.message, /5 min/);
  const neznámá = L.checkUpload(free, skoro, null);
  assert.equal(neznámá.ok, true);
  assert.equal(neznámá.reserveSeconds, 300, 'bez délky jen to, co dnes zbývá');
  assert.equal(L.checkUpload(free, { ...L.NO_USAGE, secondsToday: 14400 - 30 }, null).code, 'daily-minutes');
});

test('úložiště účtu', () => {
  const plné = { ...L.NO_USAGE, storedSeconds: 108000 - 100 };
  const r = L.checkUpload(free, plné, 300);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'storage');
  assert.equal(r.status, 507);
  assert.equal(L.checkUpload(free, { ...plné, storedSeconds: 50000 }, 300).ok, true);
  assert.equal(L.checkUpload(free, { ...L.NO_USAGE, storedSeconds: 100000, pendingSeconds: 7000 }, 1200).code, 'storage', 'rozpracované se počítají');
  assert.equal(L.checkUpload(tym, { ...L.NO_USAGE, storedSeconds: 10 ** 9 }, 3600).ok, true, 'tým bez stropu');
  assert.match(r.message, /zbývá 1 min z 30 h/);
  assert.match(L.checkUpload(free, { ...L.NO_USAGE, storedSeconds: 108000 - 30 }, 300).message, /plné \(30 h z 30 h\)/, 'plné úložiště');
  const malo = L.checkUpload(free, { ...L.NO_USAGE, storedSeconds: 108000 - 1000 }, 1200);
  assert.equal(malo.code, 'storage');
  assert.match(malo.message, /zbývá 16 min z 30 h/, 'zbývající místo, ne "plné"');
});

test('délka od prohlížeče', () => {
  assert.equal(L.declaredDuration(12.5), 12.5);
  assert.equal(L.declaredDuration('90'), 90);
  assert.equal(L.declaredDuration(0), null);
  assert.equal(L.declaredDuration(-5), null);
  assert.equal(L.declaredDuration(Infinity), null);
  assert.equal(L.declaredDuration('abc'), null);
  assert.equal(L.declaredDuration(1e9), null);
});

test('čitelná délka', () => {
  assert.equal(L.formatDuration(45), '45 s');
  assert.equal(L.formatDuration(15 * 60), '15 min');
  assert.equal(L.formatDuration(7200), '2 h');
  assert.equal(L.formatDuration(5400), '1 h 30 min');
  assert.equal(L.formatDuration(108000), '30 h');
  assert.equal(L.formatDuration(15 * 60 + 20), '15 min');
  assert.equal(L.formatDuration(15 * 60 + 20, 'up'), '16 min', 'video nad limitem se neukáže jako limit');
  assert.equal(L.formatDuration(7200 + 30, 'up'), '2 h 1 min');
  assert.equal(L.formatDuration(59.2, 'up'), '1 min');
  assert.equal(L.formatDuration(44.6, 'down'), '44 s');
  assert.equal(L.formatDuration(14 * 60 + 50, 'down'), '14 min', 'zbývající čas se nezaokrouhlí nahoru');
});

test('obrázky: typ, velikost, přípona podle typu', () => {
  assert.equal(I.imageUploadExt({ type: 'image/jpeg', name: 'x.JPG' }), 'jpg');
  assert.equal(I.imageUploadExt({ type: 'image/png', name: 'bez-pripony' }), 'png');
  assert.equal(I.imageUploadExt({ type: 'image/svg+xml', name: 'a.svg' }), null, 'SVG ne');
  assert.equal(I.imageUploadExt({ type: 'image/heic', name: 'a.heic' }), null);
  assert.equal(I.imageUploadExt({ type: 'text/html', name: 'a.jpg' }), null, 'typ má přednost před názvem');
  assert.equal(I.imageUploadExt({ type: '', name: 'Foto.JPEG' }), 'jpg', 'bez typu podle přípony');
  assert.equal(I.imageUploadExt({ type: '', name: 'video.mp4' }), null);
  assert.equal(I.imageUploadProblem({ type: 'image/png', size: 1000 }, 'thumbnail'), null);
  assert.equal(I.imageUploadProblem({ type: 'image/png', size: 11 * 1024 * 1024 }, 'thumbnail'), 'size');
  assert.equal(I.imageUploadProblem({ type: 'image/png', size: 6 * 1024 * 1024 }, 'playlistCover'), 'size');
  assert.equal(I.imageUploadProblem({ type: 'application/pdf', size: 10 }, 'post'), 'type');
  assert.equal(I.imageUploadProblem({ type: 'image/gif', size: 0 }, 'comment'), 'size');
});

test('cesty v úložišti', () => {
  const p = I.thumbnailPath('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'jpg', 1760000000000);
  assert.match(p, /^00000000-0000-0000-0000-00000000000a\/10000000-0000-0000-0000-00000000000a-[a-z0-9]{1,16}\.jpg$/, 'odpovídá pravidlu úložiště');
  const uid = '00000000-0000-0000-0000-00000000000a';
  const url = `https://abc.supabase.co/storage/v1/object/public/thumbnails/${uid}/v-1.jpg?t=5`;
  assert.equal(I.ownStoragePath(url, 'thumbnails', uid), `${uid}/v-1.jpg`);
  assert.equal(I.ownStoragePath(url, 'thumbnails', '00000000-0000-0000-0000-00000000000b'), null, 'cizí složka ne');
  assert.equal(I.ownStoragePath(url, 'avatars', uid), null);
  assert.equal(I.ownStoragePath('https://videodelivery.net/x/thumbnails/thumbnail.jpg', 'thumbnails', uid), null);
  assert.equal(I.ownStoragePath(`https://a.supabase.co/storage/v1/object/public/thumbnails/${uid}/../x.jpg`, 'thumbnails', uid), null);
  assert.equal(I.ownStoragePath(null, 'thumbnails', uid), null);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
process.exit(padly ? 1 : 0);
