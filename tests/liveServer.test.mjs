/**
 * Živé vysílání na serveru (lib/liveStream.ts) proti falešnému Cloudflare
 * a falešné databázi: přesně situace "appka hlásí 'diváci tě vidí', Kine
 * 'nikdo nevysílá'" - Cloudflare vysílá, ale jeden nebo víc zdrojů, podle
 * kterých to Kine poznává (seznam běžících přenosů účtu, lifecycle, stav
 * vstupu), mlčí.
 *
 * Spustit:  node tests/liveServer.test.mjs
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

// Hodiny, které jde mezi testy posunout (paměť odpovědí Cloudflare na pár vteřin a omezení
// srovnání na jednou za 12 s pak testy navzájem neovlivní).
let posun = 0;
const RealDate = Date;
class TestDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + posun);
    else super(...args);
  }
  static now() {
    return RealDate.now() + posun;
  }
}
globalThis.Date = TestDate;

process.env.CLOUDFLARE_ACCOUNT_ID = 'acc1';
process.env.CLOUDFLARE_STREAM_API_TOKEN = 'tok1';
delete process.env.NEXT_PUBLIC_STREAM_CUSTOMER_CODE;

const kam = prelozit('lib/liveStream.ts');

// ---- falešná databáze (jen to, co lib/liveStream.ts potřebuje) -------------------------
const db = { live_streams: [], videos: [], notifications: [], subscriptions: [], profiles: [] };

function splitOr(expr) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}
function matchCond(row, cond) {
  const [col, op, ...rest] = cond.split('.');
  const val = rest.join('.');
  if (op === 'eq') return String(row[col]) === val;
  if (op === 'neq') return String(row[col]) !== val;
  if (op === 'is') return val === 'null' ? row[col] === null || row[col] === undefined : String(row[col]) === val;
  if (op === 'in') {
    const list = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
    return list.includes(String(row[col]));
  }
  throw new Error('neznámá podmínka ' + cond);
}
function builder(table) {
  const q = { table, filters: [], ors: [], patch: null, insert: null, single: false, maybe: false, limit: null };
  const api = {
    select() { return api; },
    eq(col, v) { q.filters.push((r) => String(r[col]) === String(v)); return api; },
    neq(col, v) { q.filters.push((r) => String(r[col]) !== String(v)); return api; },
    in(col, list) { q.filters.push((r) => list.map(String).includes(String(r[col]))); return api; },
    like() { return api; },
    not() { return api; },
    order() { return api; },
    gt() { return api; },
    or(expr) { const conds = splitOr(expr); q.filters.push((r) => conds.some((c) => matchCond(r, c))); return api; },
    limit(n) { q.limit = n; return api; },
    update(patch) { q.patch = patch; return api; },
    insert(rows) { q.insert = rows; return api; },
    maybeSingle() { q.maybe = true; return api; },
    single() { q.single = true; return api; },
    then(resolve, reject) {
      try {
        const rows = db[table] ?? [];
        if (q.insert) {
          (Array.isArray(q.insert) ? q.insert : [q.insert]).forEach((r) => rows.push({ ...r }));
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        let hit = rows.filter((r) => q.filters.every((f) => f(r)));
        if (q.patch) {
          for (const r of hit) Object.assign(r, q.patch);
          return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(resolve, reject);
        }
        if (q.limit) hit = hit.slice(0, q.limit);
        const data = q.maybe || q.single ? (hit[0] ? { ...hit[0] } : null) : hit.map((r) => ({ ...r }));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    },
  };
  return api;
}
writeFileSync(
  join(kam, 'supabaseServer.js'),
  `export const supabaseServer = globalThis.__kineFakeDb;\n`
);
globalThis.__kineFakeDb = { from: (t) => builder(t), rpc: async () => ({ data: null, error: null }) };

// ---- falešný Cloudflare ----------------------------------------------------------------
const CODE = 'abc123code';
const INPUT = '0123456789abcdef0123456789abcdef';
const cf = {
  accountListing: [], // ?status=live-inprogress
  accountListingMode: 'ok', // 'ok' | 'error' (seznam běžících přenosů účtu nejde)
  apiDown: false, // celé API Cloudflare odpovídá chybou
  lifecycle: 'ok', // 'ok' | 'auth-only-fails' | 'error'
  lifecycleLive: true,
  lifecycleVideo: 'V1',
  inputStatus: null, // pole status u GET live_inputs/<id>
  inputVideos: 'ok', // 'ok' | 'error'
  videos: [], // seznam videí vstupu
  hls: 'live', // 'live' | 'ended' | 'none'
  calls: [],
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  cf.calls.push(url);
  const auth = init.headers && (init.headers.Authorization || init.headers.authorization);
  if (url.startsWith('https://api.cloudflare.com/client/v4/accounts/acc1/stream')) {
    if (cf.apiDown) return json(500, { success: false, errors: [{ message: 'API down' }] });
    const path = url.slice('https://api.cloudflare.com/client/v4/accounts/acc1/stream'.length);
    if (path.startsWith('?status=live-inprogress')) {
      if (cf.accountListingMode === 'error') return json(500, { success: false, errors: [{ message: 'listing boom' }] });
      return json(200, { success: true, result: cf.accountListing });
    }
    if (path.startsWith('?limit=3')) return json(200, { success: true, result: [{ uid: 'old', thumbnail: `https://customer-${CODE}.cloudflarestream.com/old/thumbnails/thumbnail.jpg` }] });
    if (path === `/live_inputs/${INPUT}/videos`) {
      if (cf.inputVideos === 'error') return json(500, { success: false, errors: [{ message: 'boom' }] });
      return json(200, { success: true, result: cf.videos });
    }
    if (path === `/live_inputs/${INPUT}`) return json(200, { success: true, result: { uid: INPUT, status: cf.inputStatus } });
    return json(404, { success: false, errors: [{ message: 'not found ' + path }] });
  }
  if (url === `https://customer-${CODE}.cloudflarestream.com/${INPUT}/lifecycle`) {
    if (cf.lifecycle === 'error') return json(500, {});
    if (cf.lifecycle === 'auth-only-fails' && auth) return json(401, {});
    return json(200, { isInput: true, live: cf.lifecycleLive, videoUID: cf.lifecycleLive ? cf.lifecycleVideo : null });
  }
  if (url === `https://customer-${CODE}.cloudflarestream.com/${INPUT}/manifest/video.m3u8`) {
    if (cf.hls === 'error') throw new TypeError('fetch failed');
    if (cf.hls === 'none') return new Response('not found', { status: 404 });
    return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nstream_360.m3u8\n', { status: 200 });
  }
  if (url === `https://customer-${CODE}.cloudflarestream.com/${INPUT}/manifest/stream_360.m3u8`) {
    const end = cf.hls === 'ended' ? '#EXT-X-ENDLIST\n' : '';
    return new Response(`#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:40\n#EXTINF:2.0,\nseg40.ts\n#EXTINF:2.0,\nseg41.ts\n${end}`, { status: 200 });
  }
  if (url === `https://customer-${CODE}.cloudflarestream.com/${INPUT}/views`) return json(200, { liveViewers: 2 });
  throw new Error('neočekávaná adresa ' + url);
};

const ls = await import(join(kam, 'liveStream.js'));

let prosly = 0;
let padly = 0;
async function test(nazev, fn) {
  posun += 60 * 1000;
  cf.calls.length = 0;
  try { await fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60 * 1000;

/** Řádek kanálu: minulé vysílání skončené tlačítkem Ukončit v appce. */
function resetRow(extra = {}) {
  const now = Date.now();
  db.live_streams.length = 0;
  db.live_streams.push({
    owner_id: OWNER,
    cf_input_id: INPUT,
    is_live: false,
    title: 'Test',
    description: '',
    category: null,
    started_at: iso(now - 40 * MIN),
    ended_at: iso(now - 30 * MIN),
    checked_at: iso(now - 30 * MIN),
    cf_confirmed_at: iso(now - 31 * MIN),
    app_ping_at: null,
    current_video_uid: null,
    notified_video_uid: null,
    notified_at: null,
    updated_at: iso(now - 30 * MIN),
    app_stopped_at: iso(now - 30 * MIN),
    stopped_video_uid: 'OLD',
    ...extra,
  });
}
const row = () => db.live_streams[0];
function cloudflareLive(video = 'V1', createdAgoMs = 20000) {
  cf.videos = [{ uid: video, status: { state: 'live-inprogress' }, created: iso(Date.now() - createdAgoMs), liveInput: INPUT }];
}

await test('Cloudflare vysílá, seznam účtu prázdný a lifecycle s API klíčem odmítnutý: "začal jsem" -> hned živě a potvrzené', async () => {
  resetRow();
  Object.assign(cf, { accountListing: [], lifecycle: 'auth-only-fails', lifecycleLive: true, lifecycleVideo: 'V1', inputStatus: null, inputVideos: 'ok', hls: 'live' });
  cloudflareLive('V1');
  const r = await ls.appLiveSignal(OWNER, 'started');
  assert.equal(r.live, true, JSON.stringify(r));
  assert.equal(r.confirmed, true, JSON.stringify(r));
  assert.equal(r.recordingUid, 'V1');
  assert.equal(row().is_live, true);
  assert.equal(row().current_video_uid, 'V1');
  assert.equal(row().app_stopped_at, null, 'minulé Ukončit už neplatí');
  assert.deepEqual(r.cloudflare && { lifecycle: r.cloudflare.lifecycle, listed: r.cloudflare.listed }, { lifecycle: true, listed: true });
  // lifecycle se ptá bez API klíče (veřejná adresa)
  assert.ok(cf.calls.some((u) => u.endsWith('/lifecycle')));
});

await test('Cloudflare vysílá, ale lifecycle i seznam účtu mlčí: potvrdí to seznam videí vstupu', async () => {
  resetRow();
  Object.assign(cf, { accountListing: [], lifecycle: 'error', inputStatus: null, inputVideos: 'ok', hls: 'live' });
  cloudflareLive('V2');
  const r = await ls.appLiveSignal(OWNER, 'started');
  assert.equal(r.live, true);
  assert.equal(r.confirmed, true, JSON.stringify(r));
  assert.equal(row().current_video_uid, 'V2');
});

await test('Mlčí všechno kromě HLS vstupu (to, co vidí divák): přenos zůstane živě a "pořád vysílám" ho drží', async () => {
  // Minulý pokus před 6 min Cloudflare nepotvrdil: nové "začal jsem" nedostane nové okno důvěry
  // (dřív se pak přenos stáhl hned po startu - "nikdo nevysílá").
  const now = Date.now();
  resetRow({ started_at: iso(now - 6 * MIN), ended_at: iso(now - 2 * MIN), cf_confirmed_at: iso(now - 60 * MIN), app_stopped_at: null, stopped_video_uid: null });
  Object.assign(cf, { accountListing: [], lifecycle: 'error', inputStatus: null, inputVideos: 'error', hls: 'live' });
  const r = await ls.appLiveSignal(OWNER, 'started');
  assert.equal(r.live, true, JSON.stringify(r));
  assert.equal(row().is_live, true);
  const p = await ls.appLiveSignal(OWNER, 'ping');
  assert.equal(p.live, true, JSON.stringify(p));
  assert.equal(row().is_live, true);
  assert.equal(p.cloudflare.hls, true);
});

await test('Přenos, který Kine stáhla (Cloudflare ho tehdy nepotvrdil): další "pořád vysílám" ho vrátí, jakmile ho Cloudflare vidí', async () => {
  const now = Date.now();
  resetRow({ started_at: iso(now - 8 * MIN), ended_at: iso(now - 4 * MIN), app_ping_at: null, cf_confirmed_at: iso(now - 60 * MIN), app_stopped_at: null, stopped_video_uid: null });
  Object.assign(cf, { accountListing: [], lifecycle: 'error', inputStatus: null, inputVideos: 'ok', hls: 'live' });
  cloudflareLive('V3', 7 * MIN);
  const p = await ls.appLiveSignal(OWNER, 'ping');
  assert.equal(p.live, true, JSON.stringify(p));
  assert.equal(p.confirmed, true, JSON.stringify(p));
  assert.equal(row().current_video_uid, 'V3');
  // začátek = kdy Cloudflare záznam založil (ne teď)
  assert.ok(Date.parse(row().started_at) < now - 6 * MIN, row().started_at);
});

await test('Bez důkazu od Cloudflare "pořád vysílám" ukončený přenos nevrátí', async () => {
  const now = Date.now();
  resetRow({ started_at: iso(now - 8 * MIN), ended_at: iso(now - 4 * MIN), app_ping_at: null, app_stopped_at: null, stopped_video_uid: null });
  Object.assign(cf, { accountListing: [], lifecycle: 'ok', lifecycleLive: false, inputStatus: null, inputVideos: 'ok', hls: 'none' });
  cf.videos = [];
  const p = await ls.appLiveSignal(OWNER, 'ping');
  assert.equal(p.live, false, JSON.stringify(p));
  assert.equal(row().is_live, false);
});

await test('Po Ukončit: zpožděné "pořád vysílám" s dobíhajícím záznamem (Cloudflare minutu čeká) přenos nevrátí', async () => {
  resetRow();
  Object.assign(cf, { accountListing: [], lifecycle: 'ok', lifecycleLive: true, lifecycleVideo: 'V4', inputStatus: null, inputVideos: 'ok', hls: 'live' });
  cloudflareLive('V4', 5 * MIN);
  await ls.appLiveSignal(OWNER, 'started');
  assert.equal(row().is_live, true);
  const s = await ls.appLiveSignal(OWNER, 'stopped');
  assert.equal(s.recordingUid, 'V4');
  assert.equal(row().is_live, false);
  assert.equal(row().stopped_video_uid, 'V4');
  const p = await ls.appLiveSignal(OWNER, 'ping');
  assert.equal(p.live, false, JSON.stringify(p));
  assert.equal(row().is_live, false);
  // srovnání (divák otevře Živě) ho taky nevrátí
  await ls.syncLiveStreams({ force: true });
  assert.equal(row().is_live, false);
});

await test('Appka hlásí vysílání, Cloudflare ho opravdu nevidí (špatný klíč): po 3 minutách pryč jako dřív', async () => {
  const now = Date.now();
  resetRow({ is_live: true, started_at: iso(now - 4 * MIN), ended_at: null, app_ping_at: iso(now - 10000), cf_confirmed_at: null, checked_at: null, app_stopped_at: null, stopped_video_uid: null });
  Object.assign(cf, { accountListing: [], lifecycle: 'ok', lifecycleLive: false, inputStatus: null, inputVideos: 'ok', hls: 'none' });
  cf.videos = [];
  const p = await ls.appLiveSignal(OWNER, 'ping');
  assert.equal(p.live, false, JSON.stringify(p));
  assert.equal(row().is_live, false);
});

await test('Seznam běžících přenosů účtu nejde (chyba): přenos potvrdí seznam videí vstupu a nezmizí ani po 10 minutách', async () => {
  resetRow();
  Object.assign(cf, { accountListing: [], accountListingMode: 'error', apiDown: false, lifecycle: 'error', inputStatus: null, inputVideos: 'ok', hls: 'live' });
  try {
    cloudflareLive('V5');
    const r = await ls.appLiveSignal(OWNER, 'started');
    assert.equal(r.live, true, JSON.stringify(r));
    assert.equal(r.confirmed, true, JSON.stringify(r));
    assert.equal(row().current_video_uid, 'V5');
    // 11 minut vysílání (appka hlásí dál): pořád živě a potvrzené - dřív po 10 minutách pryč
    posun += 11 * MIN;
    const p = await ls.appLiveSignal(OWNER, 'ping');
    assert.equal(p.live, true, JSON.stringify(p));
    assert.equal(p.confirmed, true, JSON.stringify(p));
    assert.ok(Date.now() - Date.parse(row().cf_confirmed_at) < MIN, 'potvrzení je čerstvé');
    // OBS bez appky: srovnání (divák otevře Živě) ho drží taky
    posun += 11 * MIN;
    await ls.syncLiveStreams({ force: true });
    assert.equal(row().is_live, true);
  } finally {
    Object.assign(cf, { accountListingMode: 'ok', apiDown: false });
  }
});

await test('Cloudflare neodpovídá vůbec: živý přenos zůstane, dokud ho 10 minut nikdo nepotvrdí - pak skončí', async () => {
  const now = Date.now();
  resetRow({ is_live: true, started_at: iso(now - 5 * MIN), ended_at: null, app_ping_at: null, cf_confirmed_at: iso(now - 2 * MIN), checked_at: iso(now - 2 * MIN), current_video_uid: 'V6', app_stopped_at: null, stopped_video_uid: null });
  Object.assign(cf, { accountListingMode: 'error', apiDown: true, lifecycle: 'error', inputStatus: null, inputVideos: 'error', hls: 'error' });
  try {
    await ls.syncLiveStreams({ force: true });
    assert.equal(row().is_live, true, 'výpadek Cloudflare přenos hned nestáhne');
    posun += 9 * MIN;
    await ls.syncLiveStreams({ force: true });
    assert.equal(row().is_live, false, 'po 10 minutách bez potvrzení skončí');
  } finally {
    Object.assign(cf, { accountListingMode: 'ok', apiDown: false });
  }
});

await test('Seznam účtu nejde, ale lifecycle jistě říká "nevysílá": přenos (OBS) skončí jako dřív, nečeká 10 minut', async () => {
  const now = Date.now();
  resetRow({ is_live: true, started_at: iso(now - 5 * MIN), ended_at: null, app_ping_at: null, cf_confirmed_at: iso(now - 3 * MIN), checked_at: iso(now - 3 * MIN), current_video_uid: 'V7', app_stopped_at: null, stopped_video_uid: null });
  Object.assign(cf, { accountListingMode: 'error', apiDown: false, lifecycle: 'ok', lifecycleLive: false, inputStatus: null, inputVideos: 'ok', hls: 'none' });
  cf.videos = [];
  try {
    await ls.syncLiveStreams({ force: true });
    assert.equal(row().is_live, false);
  } finally {
    Object.assign(cf, { accountListingMode: 'ok', apiDown: false });
  }
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
