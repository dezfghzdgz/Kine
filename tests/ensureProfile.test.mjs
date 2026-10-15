/**
 * Test dotvoření profilu (lib/ensureProfile.ts): jméno z registrace, jinak
 * user_xxxxxxxx - nikdy kus e-mailu (jméno je veřejné).
 *
 * Spustit:  node tests/ensureProfile.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/ensureProfile.ts', 'lib/username.ts');
const P = await import(join(kam, 'ensureProfile.js'));
const U = await import(join(kam, 'username.js'));

let prosly = 0;
let padly = 0;
async function test(nazev, fn) {
  try { await fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const ID = '8f3a2b1c-0d4e-4f5a-9b6c-7d8e9f0a1b2c';

await test('náhradní jméno projde pravidly a není z e-mailu', () => {
  const name = P.generatedUsername(ID);
  assert.equal(name, 'user_8f3a2b1c');
  assert.equal(U.validateUsername(name), null);
});

await test('jméno vybrané při registraci má přednost', () => {
  assert.deepEqual(P.profileNameCandidates({ id: ID, user_metadata: { username: ' Danny_CZ ' } }), ['Danny_CZ', 'user_8f3a2b1c']);
});

await test('neplatné nebo chybějící jméno z registrace -> jen náhradní', () => {
  for (const meta of [null, {}, { username: '' }, { username: 'a' }, { username: 'jan novak' }, { username: 'admin' }, { username: 'x'.repeat(30) }, { username: 42 }, { email: 'jan.novak@firma.cz' }]) {
    assert.deepEqual(P.profileNameCandidates({ id: ID, user_metadata: meta }), ['user_8f3a2b1c'], JSON.stringify(meta));
  }
});

function fakeSupabase({ existing = null, selectError = null, insertErrors = [] } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { calls.push(['select', table]); return { data: existing, error: selectError }; },
        async insert(row) {
          calls.push(['insert', table, row]);
          if (table !== 'profiles') return { error: null };
          const error = insertErrors[n++] ?? null;
          return { error };
        },
      };
    },
  };
}

await test('profil existuje -> nic se nezakládá', async () => {
  const sb = fakeSupabase({ existing: { id: ID } });
  assert.equal(await P.ensureOwnProfile(sb, { id: ID }), false);
  assert.equal(sb.calls.filter((c) => c[0] === 'insert').length, 0);
});

await test('chyba při čtení (výpadek) -> nic se nezakládá', async () => {
  const sb = fakeSupabase({ selectError: { code: 'XX000', message: 'network' } });
  assert.equal(await P.ensureOwnProfile(sb, { id: ID }), false);
  assert.equal(sb.calls.filter((c) => c[0] === 'insert').length, 0);
});

await test('chybí -> profil s vybraným jménem + Sledovat později', async () => {
  const sb = fakeSupabase();
  assert.equal(await P.ensureOwnProfile(sb, { id: ID, user_metadata: { username: 'danny' } }), true);
  const inserts = sb.calls.filter((c) => c[0] === 'insert');
  assert.deepEqual(inserts[0], ['insert', 'profiles', { id: ID, username: 'danny', display_name: 'danny' }]);
  assert.equal(inserts[1][1], 'playlists');
  assert.equal(inserts[1][2].is_system, true);
});

await test('vybrané jméno mezitím zabrané -> náhradní', async () => {
  const sb = fakeSupabase({ insertErrors: [{ code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_lower_idx"' }] });
  assert.equal(await P.ensureOwnProfile(sb, { id: ID, user_metadata: { username: 'danny' } }), true);
  const profiles = sb.calls.filter((c) => c[0] === 'insert' && c[1] === 'profiles').map((c) => c[2].username);
  assert.deepEqual(profiles, ['danny', 'user_8f3a2b1c']);
});

await test('profil mezitím založilo jiné okno -> hotovo, bez druhého pokusu', async () => {
  const sb = fakeSupabase({ insertErrors: [{ code: '23505', message: 'duplicate key value violates unique constraint "profiles_pkey"' }] });
  assert.equal(await P.ensureOwnProfile(sb, { id: ID, user_metadata: { username: 'danny' } }), false);
  assert.equal(sb.calls.filter((c) => c[0] === 'insert').length, 1);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
