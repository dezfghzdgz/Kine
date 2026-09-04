/**
 * Test práv přihlášeného člověka (lib/useUserRole.ts).
 *
 * Testují se přesně ty dvě věci, které byly rozbité v appce:
 *   - po přihlášení se práva musí projevit hned, bez obnovení stránky
 *     (jinak se moderátorovi neukáže odkaz na Hlášení),
 *   - po odhlášení a přihlášení na jiný účet musí práva zmizet
 *     (jinak neadminovi svítí v menu Podíl z výdělků).
 *
 * React se tu nahrazuje pár řádky: useState si drží hodnoty mezi
 * "vykresleními", useRef je objekt a useEffect se spustí jednou. To stačí,
 * protože hook žádnou další magii Reactu nepoužívá.
 *
 * Spustit:  node tests/useUserRole.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/useUserRole.ts');

/* ---------- falešný Supabase ---------- */

const supabase = {
  _zmena: null,
  _pocetDotazu: 0,
  _odlozit: false,
  _cekajici: [],
  ucty: {},
  auth: {
    uzivatel: null,
    async getUser() {
      return { data: { user: supabase.auth.uzivatel } };
    },
    onAuthStateChange(cb) {
      supabase._zmena = cb;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
  async rpc() {
    supabase._pocetDotazu++;
    const u = supabase.auth.uzivatel;
    const odpoved = { data: u ? [supabase.ucty[u.id] ?? { role: 'user', is_admin: false }] : null };
    if (!supabase._odlozit) return odpoved;
    return new Promise((vyres) => supabase._cekajici.push(() => vyres(odpoved)));
  },
};

// Přihlášení/odhlášení tak, jak ho appce hlásí Supabase.
function prihlas(id) {
  supabase.auth.uzivatel = { id };
  supabase._zmena?.('SIGNED_IN', { user: { id } });
}
function obnovToken() {
  const id = supabase.auth.uzivatel?.id;
  supabase._zmena?.('TOKEN_REFRESHED', { user: { id } });
}
function odhlas() {
  supabase.auth.uzivatel = null;
  supabase._zmena?.('SIGNED_OUT', null);
}

/* ---------- náhrada Reactu ---------- */

let stavy = [];
let refy = [];
let iStav = 0;
let iRef = 0;
let efektSpusten = false;

const React = {
  useState(pocatecni) {
    const i = iStav++;
    if (!(i in stavy)) stavy[i] = pocatecni;
    return [stavy[i], (v) => { stavy[i] = typeof v === 'function' ? v(stavy[i]) : v; }];
  },
  useRef(pocatecni) {
    const i = iRef++;
    if (!(i in refy)) refy[i] = { current: pocatecni };
    return refy[i];
  },
  useEffect(fn) {
    if (efektSpusten) return;
    efektSpusten = true;
    fn();
  },
};

/* Přeložený soubor importuje 'react' a './supabaseClient'. Obojí se tu
   podstrčí: react jako balíček vedle něj, klient jako soubor. */
mkdirSync(join(kam, 'node_modules', 'react'), { recursive: true });
writeFileSync(
  join(kam, 'node_modules', 'react', 'package.json'),
  JSON.stringify({ name: 'react', type: 'module', main: 'index.js' })
);
writeFileSync(
  join(kam, 'node_modules', 'react', 'index.js'),
  'export const useState = (...a) => globalThis.__react.useState(...a);\n' +
    'export const useRef = (...a) => globalThis.__react.useRef(...a);\n' +
    'export const useEffect = (...a) => globalThis.__react.useEffect(...a);\n'
);
writeFileSync(
  join(kam, 'supabaseClient.js'),
  'export const supabase = globalThis.__supabase;\n'
);

// Node vyžaduje u relativních importů příponu, překladač ji nedoplňuje.
const cesta = join(kam, 'useUserRole.js');
writeFileSync(cesta, readFileSync(cesta, 'utf8').replace("'./supabaseClient'", "'./supabaseClient.js'"));

globalThis.__react = React;
globalThis.__supabase = supabase;

const { useUserRole } = await import(cesta);

// Jedno "vykreslení" komponenty.
function vykresli() {
  iStav = 0;
  iRef = 0;
  return useUserRole();
}

const tik = () => new Promise((r) => setTimeout(r, 0));
async function usad() {
  for (let i = 0; i < 6; i++) await tik();
}

/* ---------- testy ---------- */

let prosly = 0;
let padly = 0;
const testy = [];
function test(nazev, fn) {
  testy.push([nazev, fn]);
}

test('odhlášený člověk nemá žádná práva a stránka to ví', async () => {
  const v = vykresli();
  assert.equal(v.loading, true, 'dokud se neví, musí být loading');
  await usad();
  const po = vykresli();
  assert.equal(po.loading, false);
  assert.equal(po.isModerator, false);
  assert.equal(po.isAdmin, false);
});

test('přihlášení moderátora se projeví bez obnovení stránky', async () => {
  supabase.ucty['mod'] = { role: 'moderator', is_admin: false };
  prihlas('mod');
  await usad();
  const v = vykresli();
  assert.equal(v.isModerator, true, 'tohle byla ta chyba: odkaz na Hlášení se objevil až po reloadu');
  assert.equal(v.isAdmin, false);
  assert.equal(v.userId, 'mod');
});

test('obnovení tokenu se na nic neptá znovu', async () => {
  const pred = supabase._pocetDotazu;
  obnovToken();
  await usad();
  assert.equal(supabase._pocetDotazu, pred, 'obnovený token roli nemění, nemá se doptávat');
  assert.equal(vykresli().isModerator, true);
});

test('odhlášení sebere práva okamžitě, bez čekání na server', () => {
  odhlas();
  const v = vykresli();
  assert.equal(v.isModerator, false);
  assert.equal(v.isAdmin, false);
  assert.equal(v.userId, null);
});

test('po adminovi se na neadminském účtu nesmí držet admin práva', async () => {
  supabase.ucty['sef'] = { role: 'admin', is_admin: true };
  supabase.ucty['bezny'] = { role: 'user', is_admin: false };

  prihlas('sef');
  await usad();
  assert.equal(vykresli().isAdmin, true, 'admin má admina vidět');

  odhlas();
  prihlas('bezny');
  await usad();

  const v = vykresli();
  assert.equal(v.isAdmin, false, 'tohle byla ta druhá chyba: neadminovi svítil Podíl z výdělků');
  assert.equal(v.isModerator, false);
  assert.equal(v.userId, 'bezny');
});

test('rychlé přepnutí účtu: platí ten poslední, ne ten pomalejší', async () => {
  odhlas();
  await usad();

  supabase._odlozit = true;

  prihlas('sef');          // admin, odpověď se zdrží
  await tik();
  prihlas('bezny');        // hned nato běžný účet
  await tik();

  // Odpovědi dorazí v opačném pořadí, než se o ně žádalo.
  const cekajici = supabase._cekajici.slice();
  supabase._cekajici.length = 0;
  cekajici.reverse().forEach((f) => f());
  await usad();

  supabase._odlozit = false;

  const v = vykresli();
  assert.equal(v.isAdmin, false, 'starší odpověď nesmí přepsat novější');
  assert.equal(v.userId, 'bezny');
});

for (const [nazev, fn] of testy) {
  try {
    await fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    padly++;
  }
}

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
