/**
 * Test zámku na uživatele (lib/userLock.ts) a pomocníků statistik živého
 * vysílání (lib/liveStats.ts).
 *
 * Zámek: souběžné požadavky jednoho uživatele musí jít za sebou (jinak by
 * prošly limity nahrávání všechny naráz), cizí zámek se nesmí smazat,
 * spadlý (starý) zámek se převezme a bez tabulky se jede bez zámku.
 *
 * Spustit:  node tests/userLock.test.mjs
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/userLock.ts', 'lib/liveStats.ts');

// ---- falešná databáze: tabulka kine_user_locks s primárním klíčem + rpc ----------------
const db = { locks: new Map(), missing: false, rpcCalls: [], tick: 0 };
function stamp() {
  db.tick += 1;
  return new Date(Date.now() + db.tick).toISOString();
}
function builder(table) {
  const q = { op: 'select', filters: [], wantRows: false };
  const api = {
    insert(row) { q.op = 'insert'; q.row = row; return api; },
    delete() { q.op = 'delete'; return api; },
    select() { q.wantRows = true; return api; },
    eq(col, val) { q.filters.push((r) => r[col] === val); return api; },
    lt(col, val) { q.filters.push((r) => r[col] < val); return api; },
    maybeSingle() { q.single = true; return api; },
    then(resolve, reject) {
      const run = async () => {
        await new Promise((r) => setTimeout(r, 1)); // jako síť - ať se požadavky opravdu prolínají
        if (table !== 'kine_user_locks') throw new Error('neznámá tabulka ' + table);
        if (db.missing) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.kine_user_locks' in the schema cache" } };
        if (q.op === 'insert') {
          if (db.locks.has(q.row.key)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          const row = { key: q.row.key, locked_at: stamp() };
          db.locks.set(row.key, row);
          return { data: q.single ? { locked_at: row.locked_at } : [row], error: null };
        }
        if (q.op === 'delete') {
          const hit = [...db.locks.values()].filter((r) => q.filters.every((f) => f(r)));
          for (const r of hit) db.locks.delete(r.key);
          return { data: q.wantRows ? hit.map((r) => ({ key: r.key })) : null, error: null };
        }
        return { data: [], error: null };
      };
      return run().then(resolve, reject);
    },
  };
  return api;
}
globalThis.__kineFakeDb = {
  from: (t) => builder(t),
  rpc: async (name, args) => {
    db.rpcCalls.push({ name, args });
    return { data: null, error: null };
  },
};
writeFileSync(join(kam, 'supabaseServer.js'), 'export const supabaseServer = globalThis.__kineFakeDb;\n');
// Statistiky si berou počet diváků z lib/liveStream.ts - v testu pevné číslo.
writeFileSync(join(kam, 'liveStream.js'), 'export async function liveViewerCount() { globalThis.__kineViewerAsks = (globalThis.__kineViewerAsks ?? 0) + 1; return 7; }\n');

const lock = await import(join(kam, 'userLock.js'));
const stats = await import(join(kam, 'liveStats.js'));

let prosly = 0;
let padly = 0;
async function test(nazev, fn) {
  try {
    await fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    padly++;
  }
}

await test('20 souběžných požadavků jde za sebou (nikdy dva naráz)', async () => {
  let running = 0;
  let maxRunning = 0;
  let done = 0;
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      lock.withUserLock(
        'upload:u1',
        async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((r) => setTimeout(r, 3));
          running--;
          done++;
          return done;
        },
        { waitMs: 20000 }
      )
    )
  );
  assert.equal(maxRunning, 1);
  assert.equal(done, 20);
  assert.ok(results.every((r) => r.ok && r.locked));
  assert.equal(db.locks.size, 0, 'po doběhnutí nesmí zůstat zámek');
});

await test('limit se díky zámku nedá obejít souběžnými požadavky', async () => {
  // Simulace "spočítej -> povol -> zapiš lístek" s limitem 3.
  let tickets = 0;
  const outcomes = await Promise.all(
    Array.from({ length: 10 }, () =>
      lock.withUserLock(
        'upload:u2',
        async () => {
          const used = tickets;
          await new Promise((r) => setTimeout(r, 2));
          if (used >= 3) return 'limit';
          tickets = used + 1;
          return 'ok';
        },
        { waitMs: 20000 }
      )
    )
  );
  assert.equal(outcomes.filter((o) => o.ok && o.value === 'ok').length, 3);
  assert.equal(tickets, 3);
});

await test('různí uživatelé se navzájem neblokují', async () => {
  let running = 0;
  let maxRunning = 0;
  await Promise.all(
    ['a', 'b', 'c'].map((u) =>
      lock.withUserLock(lock.lockKey('upload', u), async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 15));
        running--;
      })
    )
  );
  assert.ok(maxRunning > 1, 'tři různí uživatelé mají běžet souběžně');
});

await test('obsazený zámek: po čekání "busy" a funkce se nespustí', async () => {
  db.locks.set('upload:busy', { key: 'upload:busy', locked_at: new Date().toISOString() });
  let ran = false;
  const r = await lock.withUserLock('upload:busy', async () => {
    ran = true;
  }, { waitMs: 300 });
  assert.deepEqual(r, { ok: false, busy: true });
  assert.equal(ran, false);
  assert.ok(db.locks.has('upload:busy'), 'cizí zámek zůstává');
  db.locks.delete('upload:busy');
});

await test('starý zámek (spadlá funkce) se převezme', async () => {
  db.locks.set('upload:stale', { key: 'upload:stale', locked_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() });
  const r = await lock.withUserLock('upload:stale', async () => 'hotovo', { waitMs: 300 });
  assert.equal(r.ok, true);
  assert.equal(r.value, 'hotovo');
  assert.equal(db.locks.has('upload:stale'), false);
});

await test('uvolní se jen vlastní zámek (převzatý cizí zůstane)', async () => {
  const r = await lock.withUserLock('upload:own', async () => {
    // Někdo zámek mezitím převzal (náš běh trval přes minutu) - má jiný čas založení.
    db.locks.set('upload:own', { key: 'upload:own', locked_at: '2099-01-01T00:00:00.000Z' });
    return 1;
  });
  assert.equal(r.ok, true);
  assert.ok(db.locks.has('upload:own'), 'cizí (převzatý) zámek se nesmí smazat');
  db.locks.delete('upload:own');
});

await test('bez tabulky (migrace neproběhla) se jede bez zámku', async () => {
  db.missing = true;
  const r = await lock.withUserLock('upload:x', async () => 42, { waitMs: 100 });
  db.missing = false;
  assert.deepEqual(r, { ok: true, value: 42, locked: false });
});

await test('chyba ve funkci zámek stejně uvolní', async () => {
  await assert.rejects(lock.withUserLock('upload:err', async () => {
    throw new Error('boom');
  }));
  assert.equal(db.locks.has('upload:err'), false);
});

await test('lockKey: bezpečné znaky a nejvýš 120 znaků', () => {
  assert.equal(lock.lockKey('upload', '1111-aaaa'), 'upload:1111-aaaa');
  assert.equal(lock.lockKey('clip', "x'; drop table--"), 'clip:xdroptable--');
  assert.ok(lock.lockKey('a', 'b'.repeat(500)).length <= 120);
});

await test('lockTableMissing pozná chybějící tabulku', () => {
  assert.equal(lock.lockTableMissing({ code: '42P01', message: 'relation "kine_user_locks" does not exist' }), true);
  assert.equal(lock.lockTableMissing({ code: 'PGRST205', message: 'x' }), true);
  assert.equal(lock.lockTableMissing({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(lock.lockTableMissing(null), false);
});

// ---- statistiky živého vysílání -------------------------------------------------------

await test('průměr diváků: zaokrouhlení na desetiny, bez vzorků null', () => {
  assert.equal(stats.averageViewers(42, 2), 21);
  assert.equal(stats.averageViewers(10, 3), 3.3);
  assert.equal(stats.averageViewers(0, 0), null);
  assert.equal(stats.averageViewers(5, -1), null);
});

await test('délka vysílání nikdy záporná', () => {
  assert.equal(stats.sessionDurationS('2026-10-30T18:00:00Z', '2026-10-30T19:30:00Z'), 5400);
  assert.equal(stats.sessionDurationS('2026-10-30T18:00:00Z', '2026-10-30T17:00:00Z'), 0);
  assert.equal(stats.sessionDurationS('nesmysl', '2026-10-30T17:00:00Z'), 0);
});

await test('vzorek se zapíše nejvýš jednou za minutu na vysílání', async () => {
  db.rpcCalls.length = 0;
  const row = { owner_id: 'o1', started_at: '2026-10-30T18:00:00Z', title: 'Stream', category: null, cf_input_id: 'in1', is_live: true };
  await stats.sampleLiveRow(row);
  await stats.sampleLiveRow(row);
  await stats.sampleLiveRow(row);
  assert.equal(db.rpcCalls.length, 1);
  assert.equal(db.rpcCalls[0].name, 'live_session_sample');
  assert.equal(db.rpcCalls[0].args.p_viewers, 7);
  assert.equal(db.rpcCalls[0].args.p_owner, 'o1');
  // Jiné vysílání (nový začátek) se zapisuje zvlášť.
  await stats.sampleLiveRow({ ...row, started_at: '2026-10-30T20:00:00Z' });
  assert.equal(db.rpcCalls.length, 2);
});

await test('neživý přenos ani přenos bez začátku se nezapisuje', async () => {
  db.rpcCalls.length = 0;
  assert.equal(await stats.sampleLiveRow({ owner_id: 'o2', started_at: '2026-10-30T18:00:00Z', is_live: false }), null);
  await stats.sampleLiveSession({ owner_id: 'o2', started_at: null }, 5);
  assert.equal(db.rpcCalls.length, 0);
});

await test('počet diváků se u Cloudflare zjišťuje nejvýš jednou za 30 s', async () => {
  globalThis.__kineViewerAsks = 0;
  assert.equal(await stats.cachedLiveViewers('in-cache'), 7);
  assert.equal(await stats.cachedLiveViewers('in-cache'), 7);
  assert.equal(stats.peekLiveViewers('in-cache'), 7);
  assert.equal(stats.peekLiveViewers('nikdy-nezjistovano'), null);
  assert.equal(globalThis.__kineViewerAsks, 1);
  assert.equal(await stats.cachedLiveViewers(null), null);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly) process.exit(1);
