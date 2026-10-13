/**
 * Test ratingu důvěryhodnosti kanálu (lib/trustRatingClient.ts).
 *
 * Rating se dřív počítal ze VŠECH reakcí na všech videích kanálu (tisíce
 * řádků při každém otevření videa). Teď jen z počtů po hvězdičkách - tady
 * se hlídá, že vychází stejně a že jde jen o počty (HEAD), všechny naráz.
 *
 * Spustit:  node tests/trustRating.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/trustRatingClient.ts');
// Skutečný klient Supabase se v testu nahradí falešným (jen počty podle filtru).
writeFileSync(join(kam, 'supabaseClient.js'), 'export const supabase = globalThis.__supabase;\n');
const cesta = join(kam, 'trustRatingClient.js');
writeFileSync(cesta, readFileSync(cesta, 'utf8').replace(/'\.\/supabaseClient(\.js)?'/, "'./supabaseClient.js'"));

const dotazy = [];
let pocty = { all: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
globalThis.__supabase = {
  from(table) {
    const q = { table, filters: {}, head: false, cols: '' };
    dotazy.push(q);
    const builder = {
      select(cols, opts) {
        q.cols = cols;
        q.head = !!opts?.head;
        q.count = opts?.count;
        return builder;
      },
      eq(col, val) {
        q.filters[col] = val;
        return builder;
      },
      then(resolve) {
        const score = q.filters.score;
        resolve({ count: score === undefined ? pocty.all : pocty[score], error: null, data: null });
      },
    };
    return builder;
  },
};

const tr = await import(cesta);

let prosly = 0;
let padly = 0;
async function test(nazev, fn) {
  try { await fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

/** Původní výpočet (ze všech řádků) - nový musí vycházet stejně. */
function puvodni(createdAt, scores, now) {
  const ageDays = (now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const ageScore = Math.min(ageDays / 180, 1);
  let likeRatio = 0.9;
  if (scores.length > 0) likeRatio = (scores.reduce((s, x) => s + (x ?? 3), 0) / scores.length - 1) / 4;
  return Math.round(Math.min(Math.max(60 + ageScore * 20 + likeRatio * 20, 50), 99));
}

const NOW = Date.parse('2026-10-13T12:00:00Z');

await test('rating z věku a průměru: stejný jako původní výpočet ze všech řádků', () => {
  const cases = [
    ['2026-01-01T00:00:00Z', []],
    ['2026-10-01T00:00:00Z', [5, 5, 4, 1]],
    ['2024-01-01T00:00:00Z', [1, 1, 2]],
    ['2025-06-01T00:00:00Z', [5, null, 3, 4, null]],
  ];
  for (const [created, scores] of cases) {
    const byScore = [1, 2, 3, 4, 5].map((s) => scores.filter((x) => x === s).length);
    const { avgScore } = tr.summaryFromCounts(scores.length, byScore);
    assert.equal(tr.trustScoreFrom(created, avgScore, NOW), puvodni(created, scores, NOW), `${created} ${JSON.stringify(scores)}`);
  }
});

await test('bez reakcí: průměr null, rating jen z věku; nesmyslné datum = nový kanál', () => {
  assert.deepEqual(tr.summaryFromCounts(0, [0, 0, 0, 0, 0]), { total: 0, avgScore: null });
  assert.equal(tr.trustScoreFrom('2026-10-13T12:00:00Z', null, NOW), 78);
  assert.equal(tr.trustScoreFrom(null, null, NOW), 78);
  assert.equal(tr.trustScoreFrom('2020-01-01T00:00:00Z', 5, NOW), 99, 'strop 99');
});

await test('souběh (mezi počty přibyla reakce): průměr nikdy nepřeleze 5', () => {
  const { avgScore } = tr.summaryFromCounts(3, [0, 0, 0, 0, 4]);
  assert.ok(avgScore <= 5, String(avgScore));
});

await test('kanál: jen počty (HEAD) podle hvězdiček, 6 dotazů naráz, filtr přes vlastníka videa', async () => {
  dotazy.length = 0;
  pocty = { all: 7, 1: 1, 2: 0, 3: 1, 4: 2, 5: 2 }; // 1 reakce bez hvězdiček (počítá se jako 3)
  const r = await tr.channelTrust('kanal-1', '2026-01-01T00:00:00Z');
  assert.equal(r.total, 7);
  assert.equal(dotazy.length, 6);
  assert.ok(dotazy.every((q) => q.table === 'video_reactions' && q.head && q.count === 'exact' && q.filters['videos.owner_id'] === 'kanal-1' && /videos!inner/.test(q.cols)), JSON.stringify(dotazy));
  const expected = puvodni('2026-01-01T00:00:00Z', [1, 3, 4, 4, 5, 5, null], Date.now());
  assert.equal(r.score, expected);
  assert.equal(await tr.getTotalReactionCount('kanal-1'), 7);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
