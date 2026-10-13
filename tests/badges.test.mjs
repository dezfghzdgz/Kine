/**
 * Test odznaků na kanálu (lib/badges.ts).
 *
 * Spustit:  node tests/badges.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/badges.ts');
const b = await import(join(kam, 'badges.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const NOW = Date.parse('2029-03-01T12:00:00Z');
const base = { joinedAt: '2028-06-01T00:00:00Z', videos: 0, views: 0, subscribers: 0, sparks: 0, streamed: false };
const ids = (stats) => b.computeBadges(stats, NOW).map((x) => `${x.id}:${x.value}`);

test('nový účet bez videí: žádný odznak', () => {
  assert.deepEqual(ids(base), []);
});

test('od každé řady jen nejvyšší stupeň, seřazené (odběratelé, zhlédnutí, videa, Sparks, živě, roky, průkopník)', () => {
  const stats = { joinedAt: '2026-10-01T00:00:00Z', videos: 57, views: 12_345, subscribers: 1_000, sparks: 12, streamed: true };
  assert.deepEqual(ids(stats), ['subscribers:1000', 'views:10000', 'videos:50', 'sparks:10', 'streamer:1', 'years:2', 'early:1']);
});

test('hranice: přesně na hranici = má, o jedna méně = nemá', () => {
  assert.deepEqual(ids({ ...base, videos: 1 }), ['videos:1']);
  assert.deepEqual(ids({ ...base, views: 99 }), []);
  assert.deepEqual(ids({ ...base, views: 999 }), ['views:100']);
  assert.deepEqual(ids({ ...base, views: 1000 }), ['views:1000']);
  assert.deepEqual(ids({ ...base, subscribers: 9 }), []);
  assert.deepEqual(ids({ ...base, subscribers: 99 }), ['subscribers:10']);
  assert.deepEqual(ids({ ...base, sparks: 9 }), ['sparks:1']);
});

test('nové řady: lajky, hit (nejsledovanější video), hodiny vysílání, příspěvky, komentáře, spolupráce', () => {
  const stats = { ...base, likes: 1200, topVideoViews: 15_000, streamHours: 12.5, posts: 3, comments: 140, collabs: 1 };
  assert.deepEqual(ids(stats), ['hit:10000', 'likes:1000', 'streamHours:10', 'posts:1', 'comments:100', 'collabs:1']);
  // starší volání bez nových čísel: nic z nových řad
  assert.deepEqual(ids({ ...base, videos: 1 }), ['videos:1']);
});

test('víc stupňů: zhlédnutí 7, videa 8, odběratelé 7 - stupeň (level) roste s hranicí', () => {
  assert.equal(b.BADGE_TIERS.views.length, 7);
  assert.equal(b.BADGE_TIERS.videos.length, 8);
  assert.equal(b.BADGE_TIERS.subscribers.length, 7);
  const top = b.computeBadges({ ...base, views: 2e8, videos: 5000 }, NOW);
  assert.deepEqual(top.map((x) => `${x.id}:${x.level}`), ['views:6', 'videos:7']);
  for (const tiers of Object.values(b.BADGE_TIERS)) {
    assert.ok(tiers.every((t, i) => i === 0 || t > tiers[i - 1]), 'hranice rostou');
    assert.ok(tiers.length <= b.TIER_COUNT, 'na každý stupeň je barva');
  }
});

test('roky na Kine a průkopník (registrace do konce 2026)', () => {
  assert.equal(b.yearsOnKine('2028-03-02T00:00:00Z', NOW), 0);
  assert.equal(b.yearsOnKine('2028-02-28T00:00:00Z', NOW), 1);
  assert.equal(b.yearsOnKine('nesmysl', NOW), 0);
  assert.equal(b.yearsOnKine('2030-01-01T00:00:00Z', NOW), 0);
  assert.deepEqual(ids({ ...base, joinedAt: '2026-12-31T23:00:00Z' }), ['years:2', 'early:1']);
  assert.deepEqual(ids({ ...base, joinedAt: '2027-01-01T00:00:00Z' }), ['years:2']);
});

test('nesmyslná čísla nespadnou', () => {
  assert.deepEqual(ids({ ...base, videos: -5, views: NaN, subscribers: Infinity, sparks: 'x' }), []);
});

test('další odznak: ten nejblíž splněný; Sparks jen když nějaké jsou; null když má všechno', () => {
  // 800/1000 zhlédnutí (80 %) je blíž než 3/10 videí (30 %)
  assert.deepEqual(b.nextBadge({ ...base, videos: 3, views: 800 }, NOW), { id: 'views', target: 1000, current: 800, missing: 200 });
  // nic nemá -> první video (0/1) i 0 zhlédnutí - vyhraje první v pořadí se stejným poměrem
  assert.equal(b.nextBadge(base, NOW).id, 'videos');
  assert.equal(b.nextBadge({ ...base, videos: 2, sparks: 0 }, NOW).id !== 'sparks', true);
  assert.equal(b.nextBadge({ ...base, videos: 1, sparks: 9 }, NOW).id, 'sparks');
  // volitelné řady (hodiny vysílání, příspěvky...) až když v nich něco je
  assert.equal(b.nextBadge({ ...base, videos: 1, streamHours: 9 }, NOW).id, 'streamHours');
  const max = { ...base, videos: 1e9, views: 1e12, subscribers: 1e9, sparks: 1e9, likes: 1e9, topVideoViews: 1e12, streamHours: 1e6, posts: 1e6, comments: 1e6, collabs: 1e6 };
  assert.equal(b.nextBadge(max, NOW), null);
});

test('výběr na kanál: max 3, v pořadí výběru, jen získané; dokud nevybíral, první tři', () => {
  const stats = { joinedAt: '2026-10-01T00:00:00Z', videos: 57, views: 12_345, subscribers: 1_000, sparks: 12, streamed: true };
  const earned = b.computeBadges(stats, NOW);
  const show = (sel) => b.showcaseBadges(earned, sel).map((x) => x.id);
  assert.deepEqual(show(null), ['subscribers', 'views', 'videos']);
  assert.deepEqual(show(undefined), ['subscribers', 'views', 'videos']);
  assert.deepEqual(show(['early', 'streamer']), ['early', 'streamer']);
  assert.deepEqual(show([]), [], 'prázdný výběr = schválně žádný');
  assert.deepEqual(show(['early', 'early', 'nesmysl', 'sparks', 'views', 'videos']), ['early', 'sparks', 'views']);
  // řadu, kterou už nemá (třeba odběratelé spadli), přeskočí
  const fewer = b.computeBadges({ ...stats, subscribers: 5 }, NOW);
  assert.deepEqual(b.showcaseBadges(fewer, ['subscribers', 'early']).map((x) => x.id), ['early']);
  assert.deepEqual(b.sanitizeShowcase('x'), null);
  assert.deepEqual(b.sanitizeShowcase(['views', 'views', 'a', 'early', 'sparks', 'years']), ['views', 'early', 'sparks']);
  // Nové řady (lajky, hit...) výchozí výběr nepřeházejí: hit se neukáže vedle skoro stejných zhlédnutí.
  const small = b.computeBadges({ joinedAt: '2026-10-01T00:00:00Z', videos: 1, views: 1500, subscribers: 3, sparks: 0, streamed: true, topVideoViews: 1500, likes: 20 }, NOW);
  assert.deepEqual(b.showcaseBadges(small, null).map((x) => x.id), ['views', 'videos', 'streamer']);
});

test('oznámení: nové stupně proti zapamatovaným, zapamatované se slučují', () => {
  const before = b.computeBadges({ ...base, videos: 3 }, NOW);
  const seen = b.mergeSeen([], before);
  assert.deepEqual(seen, ['videos:1']);
  const after = b.computeBadges({ ...base, videos: 12, views: 1500 }, NOW);
  assert.deepEqual(b.unseenBadges(after, seen).map(b.badgeKey), ['views:1000', 'videos:10']);
  const merged = b.mergeSeen(seen, after);
  assert.deepEqual(merged, ['videos:1', 'views:1000', 'videos:10']);
  assert.deepEqual(b.unseenBadges(after, merged), []);
});

test('sbírka: každá řada se stupněm, dalším cílem a postupem', () => {
  const p = b.badgeProgress({ ...base, videos: 12, views: 800 }, NOW);
  const byId = Object.fromEntries(p.map((x) => [x.id, x]));
  assert.deepEqual(p.map((x) => x.id), ['subscribers', 'views', 'hit', 'likes', 'videos', 'sparks', 'streamHours', 'streamer', 'posts', 'comments', 'collabs', 'years', 'early']);
  assert.equal(byId.videos.badge.value, 10);
  assert.equal(byId.videos.next, 25);
  assert.equal(byId.videos.tiers, 8);
  assert.equal(byId.views.badge.value, 100);
  assert.equal(byId.views.next, 1000);
  assert.equal(byId.views.current, 800);
  assert.equal(byId.hit.current, 0);
  assert.equal(byId.hit.next, 1000);
  assert.equal(byId.streamer.tiers, 1);
  assert.equal(byId.streamer.badge, null);
  assert.equal(b.badgeProgress({ ...base, views: 1e12 }, NOW).find((x) => x.id === 'views').next, null);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
