/**
 * Test pojistek API z bezpečnostní kontroly (listopad 2026): adresa pro
 * limity (IPv6 po /64), veřejná adresa webu, dekodér PNG pro kontrolu emotů,
 * odkud smí server stahovat obrázky, zveřejnění záznamu vysílání, viditelnost
 * při skrytí a spolupráci, počítání zhlédnutí a kanonická adresa odznaků.
 *
 * Spustit:  node tests/apiHardening.test.mjs
 */

import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit(
  'lib/clientIp.ts',
  'lib/siteUrl.ts',
  'lib/pngDecode.ts',
  'lib/mediaHosts.ts',
  'lib/liveRecordingGuard.ts',
  'lib/moderationVisibility.ts',
  'lib/viewCount.ts',
  'lib/badgeStatsUrl.ts'
);
const { ipBucket, clientIpKey } = await import(join(kam, 'clientIp.js'));
const { siteUrlFrom } = await import(join(kam, 'siteUrl.js'));
const { decodePng, flattenOnGray } = await import(join(kam, 'pngDecode.js'));
const hosts = await import(join(kam, 'mediaHosts.js'));
const guard = await import(join(kam, 'liveRecordingGuard.js'));
const vis = await import(join(kam, 'moderationVisibility.js'));
const views = await import(join(kam, 'viewCount.js'));
const { badgeStatsQuery } = await import(join(kam, 'badgeStatsUrl.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

// ---- adresa pro limity --------------------------------------------------------------

test('IP: IPv4 zůstává celá', () => {
  assert.equal(ipBucket('1.2.3.4'), '1.2.3.4');
  assert.equal(ipBucket(''), 'unknown');
});

test('IP: IPv6 po sítích /64 (jakkoli zapsaná)', () => {
  const key = '2001:db8:1:2::/64';
  assert.equal(ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), key);
  assert.equal(ipBucket('2001:0db8:0001:0002:0000:0000:0000:0001'), key);
  assert.equal(ipBucket('2001:db8:1:2::1'), key);
  assert.equal(ipBucket('2001:DB8:1:2::FFFF'), key);
  assert.notEqual(ipBucket('2001:db8:1:3::1'), key);
  assert.equal(ipBucket('::1'), '0:0:0:0::/64');
});

test('IP: IPv4 zabalená v IPv6 je obyčejná IPv4', () => {
  assert.equal(ipBucket('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(ipBucket('::ffff:0102:0304'), '1.2.3.4');
});

test('IP: nesmysl se nerozbije', () => {
  assert.equal(ipBucket('1:2:3'), '1:2:3');
  assert.equal(ipBucket('1::2::3'), '1::2::3');
  assert.equal(clientIpKey(new Headers({ 'x-real-ip': '2001:db8:1:2::5' })), '2001:db8:1:2::/64');
  assert.equal(clientIpKey(new Headers()), 'unknown');
});

// ---- veřejná adresa webu ------------------------------------------------------------

const req = (url, headers = {}) => new Request(url, { headers });

test('adresa webu: NEXT_PUBLIC_SITE_URL má přednost (i před hlavičkou)', () => {
  const env = { NEXT_PUBLIC_SITE_URL: 'https://kine.cz/', VERCEL_PROJECT_PRODUCTION_URL: 'kine.vercel.app' };
  assert.equal(siteUrlFrom(req('https://kine.cz/api/x', { 'x-forwarded-host': 'evil.com' }), env), 'https://kine.cz');
});

test('adresa webu: bez ní produkční adresa od Vercelu, cizí x-forwarded-host se nebere', () => {
  const env = { VERCEL_PROJECT_PRODUCTION_URL: 'kine.vercel.app' };
  assert.equal(siteUrlFrom(req('https://kine.vercel.app/api/x', { 'x-forwarded-host': 'evil.com' }), env), 'https://kine.vercel.app');
});

test('adresa webu: náhledové nasazení zůstane na své adrese (adresa od Vercelu)', () => {
  const env = { VERCEL_PROJECT_PRODUCTION_URL: 'kine.cz', VERCEL_URL: 'kine-abc123.vercel.app' };
  assert.equal(siteUrlFrom(req('https://kine-abc123.vercel.app/api/x', { 'x-forwarded-host': 'kine-abc123.vercel.app' }), env), 'https://kine-abc123.vercel.app');
});

test('adresa webu: bez nastavení adresa požadavku, ne hlavička od klienta', () => {
  assert.equal(siteUrlFrom(req('http://localhost:3000/api/x', { 'x-forwarded-host': 'evil.com' }), {}), 'http://localhost:3000');
});

// ---- dekodér PNG --------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data = new Uint8Array(0)) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)])), 8 + data.length);
  return out;
}
function ihdr(width, height, depth, color, interlace = 0) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(width, 0);
  d.writeUInt32BE(height, 4);
  d[8] = depth;
  d[9] = color;
  d[12] = interlace;
  return chunk('IHDR', d);
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Zakóduje řádky (bez filtru) s filtrem `filters[y]` - strana kodéru. */
function filtered(rows, bpp, filters) {
  const out = [];
  rows.forEach((row, y) => {
    const f = filters[y % filters.length];
    const prev = y > 0 ? rows[y - 1] : new Uint8Array(row.length);
    const line = new Uint8Array(row.length + 1);
    line[0] = f;
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      line[x + 1] = (row[x] - pred) & 0xff;
    }
    out.push(line);
  });
  return Buffer.concat(out);
}
const png = (...chunks) => new Uint8Array(Buffer.concat([SIG, ...chunks, chunk('IEND')]));

// 3×5 RGBA, každý řádek jiný filtr (None, Sub, Up, Average, Paeth).
const W = 3, H = 5;
const pixels = Array.from({ length: H }, (_, y) => Uint8Array.from({ length: W * 4 }, (_, i) => (y * 53 + i * 31 + (i % 4 === 3 ? 200 : 0)) & 0xff));
const rgbaPng = png(ihdr(W, H, 8, 6), chunk('IDAT', deflateSync(filtered(pixels, 4, [0, 1, 2, 3, 4]))));

test('PNG: RGBA 8 bitů, všech pět filtrů řádků', () => {
  const img = decodePng(rgbaPng);
  assert.ok(img, 'nepřečteno');
  assert.equal(img.width, W);
  assert.equal(img.height, H);
  assert.deepEqual([...img.rgba], pixels.flatMap((r) => [...r]));
});

test('PNG: IDAT rozdělené do víc bloků a pomocné bloky projdou', () => {
  const data = deflateSync(filtered(pixels, 4, [4]));
  const half = Math.floor(data.length / 2);
  const img = decodePng(png(ihdr(W, H, 8, 6), chunk('gAMA', Buffer.from([0, 0, 0xb1, 0x8f])), chunk('IDAT', data.subarray(0, half)), chunk('IDAT', data.subarray(half)), chunk('tEXt', Buffer.from('a\0b'))));
  assert.ok(img);
  assert.deepEqual([...img.rgba], pixels.flatMap((r) => [...r]));
});

test('PNG: paleta (2 bity) s průhledností', () => {
  // 4 pixely v řádku: indexy 0,1,2,3 -> 2 bity na pixel = 1 bajt.
  const row = Uint8Array.from([0b00011011]);
  const plte = chunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]));
  const trns = chunk('tRNS', Buffer.from([0, 128]));
  const img = decodePng(png(ihdr(4, 1, 2, 3), plte, trns, chunk('IDAT', deflateSync(filtered([row], 1, [0])))));
  assert.ok(img);
  assert.deepEqual([...img.rgba], [255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255, 10, 20, 30, 255]);
});

test('PNG: šedá 1 bit s průhlednou barvou, šedá + alfa, 16 bitů RGB', () => {
  const gray = decodePng(png(ihdr(8, 1, 1, 0), chunk('tRNS', Buffer.from([0, 1])), chunk('IDAT', deflateSync(filtered([Uint8Array.from([0b10100000])], 1, [0])))));
  assert.ok(gray);
  assert.deepEqual([...gray.rgba.subarray(0, 12)], [255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0]);
  const ga = decodePng(png(ihdr(1, 1, 8, 4), chunk('IDAT', deflateSync(filtered([Uint8Array.from([77, 99])], 2, [0])))));
  assert.deepEqual([...ga.rgba], [77, 77, 77, 99]);
  const rgb16 = decodePng(png(ihdr(2, 1, 16, 2), chunk('tRNS', Buffer.from([0x12, 0x34, 0, 0, 0xff, 0xff])), chunk('IDAT', deflateSync(filtered([Uint8Array.from([0x12, 0x34, 0, 0, 0xff, 0xff, 0xab, 0xcd, 0, 1, 2, 3])], 6, [1])))));
  assert.deepEqual([...rgb16.rgba], [0x12, 0, 0xff, 0, 0xab, 0, 2, 255]);
});

test('PNG: co by prohlížeč kreslil jinak, se nepřečte (APNG, prokládání, neznámý kritický blok, rozházené IDAT)', () => {
  const data = deflateSync(filtered(pixels, 4, [0]));
  assert.equal(decodePng(png(ihdr(W, H, 8, 6), chunk('acTL', Buffer.alloc(8)), chunk('IDAT', data))), null, 'APNG');
  assert.equal(decodePng(png(ihdr(W, H, 8, 6, 1), chunk('IDAT', data))), null, 'prokládané');
  assert.equal(decodePng(png(ihdr(W, H, 8, 6), chunk('ABCD', Buffer.alloc(1)), chunk('IDAT', data))), null, 'neznámý kritický blok');
  const half = Math.floor(data.length / 2);
  assert.equal(decodePng(png(ihdr(W, H, 8, 6), chunk('IDAT', data.subarray(0, half)), chunk('tEXt', Buffer.from('a\0b')), chunk('IDAT', data.subarray(half)))), null, 'IDAT přerušené');
});

test('PNG: poškozené, zkrácené a "zip bomba" se nepřečtou', () => {
  assert.equal(decodePng(rgbaPng.subarray(0, rgbaPng.length - 20)), null, 'zkrácené');
  assert.equal(decodePng(new Uint8Array([1, 2, 3])), null);
  const bad = Uint8Array.from(rgbaPng);
  bad[0] = 0;
  assert.equal(decodePng(bad), null, 'podpis');
  // Obraz 3×5, ale data rozbalená na 10 MB.
  assert.equal(decodePng(png(ihdr(W, H, 8, 6), chunk('IDAT', deflateSync(Buffer.alloc(10 * 1024 * 1024))))), null, 'zip bomba');
  // Neplatný filtr řádku.
  const raw = filtered(pixels, 4, [0]);
  raw[0] = 7;
  assert.equal(decodePng(png(ihdr(W, H, 8, 6), chunk('IDAT', deflateSync(raw)))), null, 'filtr');
  // Moc velký obrázek.
  assert.equal(decodePng(rgbaPng, 2), null, 'maxSide');
  // Bez IEND.
  assert.equal(decodePng(new Uint8Array(Buffer.concat([SIG, ihdr(W, H, 8, 6), chunk('IDAT', deflateSync(filtered(pixels, 4, [0])))]))), null, 'bez IEND');
});

test('PNG: průhlednost na šedé pozadí', () => {
  const rgb = flattenOnGray({ width: 3, height: 1, rgba: Uint8Array.from([255, 255, 255, 0, 10, 20, 30, 255, 255, 0, 0, 128]) });
  assert.deepEqual([...rgb], [128, 128, 128, 10, 20, 30, 192, 64, 64]);
});

// ---- odkud smí server stahovat obrázky ------------------------------------------------

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co', NEXT_PUBLIC_STREAM_CUSTOMER_CODE: 'xyz123' };
const OWNER = '5881290a-10c0-4136-84d8-ca7cfc97f20e';
const OTHER = '11111111-2222-4333-8444-555555555555';

test('obrázky: vlastní úložiště ano, cizí server se stejnou cestou ne', () => {
  assert.equal(hosts.isOwnStorageUrl(`https://abcd.supabase.co/storage/v1/object/public/thumbnails/${OWNER}/a.jpg?t=1`, {}, ENV), true);
  assert.equal(hosts.isOwnStorageUrl(`https://evil.example/storage/v1/object/public/thumbnails/${OWNER}/a.jpg`, {}, ENV), false);
  assert.equal(hosts.isOwnStorageUrl(`http://abcd.supabase.co/storage/v1/object/public/thumbnails/${OWNER}/a.jpg`, {}, ENV), false);
  assert.equal(hosts.isOwnStorageUrl(`https://abcd.supabase.co:8443/storage/v1/object/public/x/a.jpg`, {}, ENV), false);
  assert.equal(hosts.isOwnStorageUrl(`https://u:p@abcd.supabase.co/storage/v1/object/public/x/a.jpg`, {}, ENV), false);
  assert.equal(hosts.isOwnStorageUrl(`https://abcd.supabase.co/storage/v1/object/sign/x/a.jpg`, {}, ENV), false);
  assert.equal(hosts.isOwnStorageUrl('nesmysl', {}, ENV), false);
});

test('obrázky: vlastní náhled jen ze složky majitele', () => {
  assert.equal(hosts.isOwnThumbnailUrl(`https://abcd.supabase.co/storage/v1/object/public/thumbnails/${OWNER}/v-1.jpg?t=2`, OWNER, ENV), true);
  assert.equal(hosts.isOwnThumbnailUrl(`https://abcd.supabase.co/storage/v1/object/public/thumbnails/${OTHER}/v-1.jpg`, OWNER, ENV), false);
  assert.equal(hosts.isOwnThumbnailUrl(`https://abcd.supabase.co/storage/v1/object/public/thumbnails/${OWNER}/../${OTHER}/v.jpg`, OWNER, ENV), false);
  assert.equal(hosts.isOwnThumbnailUrl(`https://abcd.supabase.co/storage/v1/object/public/avatars/${OWNER}/v.jpg`, OWNER, ENV), false);
  assert.equal(hosts.isOwnThumbnailUrl(`https://evil.example/storage/v1/object/public/thumbnails/${OWNER}/v.jpg`, OWNER, ENV), false);
});

test('obrázky: Cloudflare Stream jen vlastního účtu', () => {
  assert.equal(hosts.isOwnStreamMediaUrl('https://videodelivery.net/abc/thumbnails/thumbnail.jpg', ENV), true);
  assert.equal(hosts.isOwnStreamMediaUrl('https://iframe.videodelivery.net/abc', ENV), true);
  assert.equal(hosts.isOwnStreamMediaUrl('https://customer-xyz123.cloudflarestream.com/abc/thumbnails/thumbnail.jpg', ENV), true);
  assert.equal(hosts.isOwnStreamMediaUrl('https://customer-cizi99.cloudflarestream.com/abc/thumbnails/thumbnail.jpg', ENV), false);
  assert.equal(hosts.isOwnStreamMediaUrl('https://customer-cizi99.cloudflarestream.com/abc/thumbnails/thumbnail.jpg', {}), true, 'bez kódu v nastavení');
  assert.equal(hosts.isOwnStreamMediaUrl('https://evil.example/abc', ENV), false);
  assert.equal(hosts.isFetchableMediaUrl('https://evil.example/storage/v1/object/public/thumbnails/x.jpg', ENV), false);
  assert.equal(hosts.isFetchableMediaUrl('https://abcd.supabase.co/storage/v1/object/public/thumbnails/live/x.jpg', ENV), true);
});

// ---- zveřejnění záznamu vysílání -----------------------------------------------------

const T0 = Date.parse('2026-11-03T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const HOUR = 3600 * 1000;

test('záznam: známá délka platí', () => {
  assert.equal(guard.estimatedRecordingSeconds({ created: iso(T0), duration: 125 }, null, 46800, T0), 125);
});

test('záznam: neznámá délka (-1 / null) se odhadne z přenosu, ne nula', () => {
  const stream = { is_live: false, started_at: iso(T0), ended_at: iso(T0 + 12 * HOUR) };
  assert.equal(guard.estimatedRecordingSeconds({ created: iso(T0 + 5000), duration: null }, stream, 46800, T0 + 12 * HOUR + 60000), 12 * 3600 - 5);
  assert.equal(guard.estimatedRecordingSeconds({ created: iso(T0), duration: -1 }, { is_live: true, started_at: iso(T0) }, 46800, T0 + HOUR), 3600);
  // Bez údajů opatrně strop jednoho přenosu.
  assert.equal(guard.estimatedRecordingSeconds({ created: null, duration: null }, null, 46800, T0), 46800);
  // Nikdy víc než strop.
  assert.equal(guard.estimatedRecordingSeconds({ created: iso(T0 - 72 * HOUR), duration: null }, { is_live: false, ended_at: iso(T0) }, 46800, T0), 46800);
});

test('záznam: patří k poslednímu přenosu (skrytí) podle času založení', () => {
  const stream = { started_at: iso(T0) };
  assert.equal(guard.recordingBelongsToStream({ created: iso(T0 - 60000) }, stream), true);
  assert.equal(guard.recordingBelongsToStream({ created: iso(T0 + HOUR) }, stream), true);
  assert.equal(guard.recordingBelongsToStream({ created: iso(T0 - HOUR) }, stream), false, 'starší přenos');
  assert.equal(guard.recordingBelongsToStream({ created: null }, stream), true, 'bez data opatrně ano');
  assert.equal(guard.recordingBelongsToStream({ created: iso(T0) }, { started_at: null }), false);
});

// ---- viditelnost při skrytí a spolupráci ---------------------------------------------

test('spolupráce: skryté video se po odpovědi spolutvůrce nezveřejní', () => {
  assert.deepEqual(vis.collabRelease({ pending_collab_visibility: 'public', moderation_hold: 'hidden' }), { action: 'clear' });
  assert.deepEqual(vis.collabRelease({ pending_collab_visibility: 'public', moderation_hold: 'removed' }), { action: 'clear' });
  assert.deepEqual(vis.collabRelease({ pending_collab_visibility: 'public', moderation_hold: null }), { action: 'release', visibility: 'public' });
  assert.deepEqual(vis.collabRelease({ pending_collab_visibility: 'subscribers' }), { action: 'release', visibility: 'subscribers' });
  assert.deepEqual(vis.collabRelease({ pending_collab_visibility: null }), { action: 'none' });
  assert.deepEqual(vis.collabRelease({ pending_collab_visibility: 'unlisted-hack' }), { action: 'clear' });
});

test('skrytí: video čekající na spolutvůrce si pamatuje chtěnou viditelnost', () => {
  assert.equal(vis.visibilityBeforeHold({ visibility: 'private', pending_collab_visibility: 'public' }), 'public');
  assert.equal(vis.visibilityBeforeHold({ visibility: 'public', pending_collab_visibility: null }), 'public');
  assert.equal(vis.visibilityBeforeHold({ visibility: 'subscribers' }), 'subscribers');
  assert.equal(vis.visibilityBeforeHold({ visibility: 'private', pending_collab_visibility: 'nesmysl' }), 'private');
});

test('schválení: když spolutvůrci pořád čekají, video zůstane soukromé a čeká dál', () => {
  assert.deepEqual(vis.visibilityAfterApproval({ moderation_prev_visibility: 'public' }, 1), { visibility: 'private', pendingCollab: 'public' });
  assert.deepEqual(vis.visibilityAfterApproval({ moderation_prev_visibility: 'public' }, 0), { visibility: 'public', pendingCollab: null });
  assert.deepEqual(vis.visibilityAfterApproval({ moderation_prev_visibility: 'private' }, 2), { visibility: 'private', pendingCollab: null });
  assert.deepEqual(vis.visibilityAfterApproval({ moderation_prev_visibility: null }, 0), { visibility: 'public', pendingCollab: null });
});

// ---- zhlédnutí ------------------------------------------------------------------------

test('zhlédnutí: jen hotové, zveřejněné, ne soukromé a ne skryté video', () => {
  const now = T0;
  assert.deepEqual(views.viewCountable({ status: 'ready', visibility: 'public' }, now), { ok: true, check: 'none' });
  assert.deepEqual(views.viewCountable({ status: 'ready', visibility: 'subscribers' }, now), { ok: true, check: 'access' });
  assert.deepEqual(views.viewCountable({ status: 'ready', visibility: 'private' }, now), { ok: false });
  assert.deepEqual(views.viewCountable({ status: 'processing', visibility: 'public' }, now), { ok: false });
  assert.deepEqual(views.viewCountable({ status: 'ready', visibility: 'public', moderation_hold: 'hidden' }, now), { ok: false });
  assert.deepEqual(views.viewCountable({ status: 'ready', visibility: 'public', scheduled_at: iso(now + HOUR) }, now), { ok: false });
  assert.deepEqual(views.viewCountable({ status: 'ready', visibility: 'public', scheduled_at: iso(now - HOUR) }, now), { ok: true, check: 'none' });
  assert.deepEqual(views.viewCountable(null, now), { ok: false });
});

test('zhlédnutí: okno je půlhodina', () => {
  assert.equal(views.viewSlot(T0), views.viewSlot(T0 + 29 * 60 * 1000));
  assert.notEqual(views.viewSlot(T0), views.viewSlot(T0 + 30 * 60 * 1000));
});

// ---- kanonická adresa odznaků ----------------------------------------------------------

test('odznaky: náhodné parametry a velká písmena se přesměrují na jedinou adresu', () => {
  const id = OWNER;
  assert.deepEqual(badgeStatsQuery(new URLSearchParams(`channel=${id}`)), { ok: true, canonical: `?channel=${id}`, redirect: false });
  assert.deepEqual(badgeStatsQuery(new URLSearchParams(`channel=${id}&fresh=1`)), { ok: true, canonical: `?channel=${id}&fresh=1`, redirect: false });
  assert.equal(badgeStatsQuery(new URLSearchParams(`channel=${id}&x=123`)).redirect, true);
  assert.equal(badgeStatsQuery(new URLSearchParams(`fresh=1&channel=${id}`)).redirect, true);
  assert.equal(badgeStatsQuery(new URLSearchParams(`channel=${id}&fresh=0`)).canonical, `?channel=${id}`);
  assert.equal(badgeStatsQuery(new URLSearchParams(`channel=${id.toUpperCase()}`)).canonical, `?channel=${id}`);
  assert.equal(badgeStatsQuery(new URLSearchParams(`channel=${id.toUpperCase()}`)).redirect, true);
  assert.deepEqual(badgeStatsQuery(new URLSearchParams('channel=abc')), { ok: false });
  // Parametr, který si přidá sám Next (přepisy), přesměrování nezacyklí.
  assert.equal(badgeStatsQuery(new URLSearchParams(`channel=${id}&nxtPid=1`)).redirect, false);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
