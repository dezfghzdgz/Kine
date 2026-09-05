/**
 * Test rozhodování hudebního přehrávače (lib/musicSlots.ts).
 *
 * Nejde o zvuk, ale o dvě věci, na kterých to v appce viditelně
 * selhávalo:
 *   - co se pustí jako další (fronta, opakování, náhodné pořadí),
 *   - jestli se použije skladba, která už je předem načtená. Pokud ne,
 *     je mezi skladbami několik vteřin ticha.
 *
 * Spustit:  node tests/musicSlots.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/musicSlots.ts');
const { chooseNext, choosePrevious, planSwap, planPreload } = await import(join(kam, 'musicSlots.js'));

const t = (id) => ({ id, cloudflareId: 'cf-' + id, title: id, creator: null, thumbnail: null, duration: 180 });
const FRONTA = [t('a'), t('b'), t('c')];

let prosly = 0;
function test(nazev, fn) {
  try {
    fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    process.exitCode = 1;
  }
}

// ---------- co se pustí dál ----------

test('další skladba ve frontě', () => {
  assert.equal(chooseNext(FRONTA, 'a', { shuffle: false, repeat: 'off' }).id, 'b');
  assert.equal(chooseNext(FRONTA, 'b', { shuffle: false, repeat: 'off' }).id, 'c');
});

test('konec fronty bez opakování = konec', () => {
  assert.equal(chooseNext(FRONTA, 'c', { shuffle: false, repeat: 'off' }), null);
});

test('konec fronty s opakováním celku = zase od začátku', () => {
  assert.equal(chooseNext(FRONTA, 'c', { shuffle: false, repeat: 'all' }).id, 'a');
});

test('prázdná fronta nic nevrátí', () => {
  assert.equal(chooseNext([], 'a', { shuffle: false, repeat: 'all' }), null);
});

test('skladba, která ve frontě není, začne od první', () => {
  assert.equal(chooseNext(FRONTA, 'x', { shuffle: false, repeat: 'off' }).id, 'a');
});

test('náhodné pořadí nikdy nevybere tu samou hned po sobě', () => {
  // Náhoda schválně pořád ukazuje na první položku - funkce musí zkusit znovu.
  const hodnoty = [0, 0, 0, 0.9];
  let i = 0;
  const vybrana = chooseNext(FRONTA, 'a', {
    shuffle: true,
    repeat: 'off',
    random: () => hodnoty[Math.min(i++, hodnoty.length - 1)],
  });
  assert.notEqual(vybrana.id, 'a');
});

test('náhodné pořadí u jediné skladby: s opakováním ano, bez něj konec', () => {
  assert.equal(chooseNext([t('a')], 'a', { shuffle: true, repeat: 'all' }).id, 'a');
  assert.equal(chooseNext([t('a')], 'a', { shuffle: true, repeat: 'off' }), null);
});

test('předchozí skladba', () => {
  assert.equal(choosePrevious(FRONTA, 'b', 'off').id, 'a');
  assert.equal(choosePrevious(FRONTA, 'a', 'off'), null, 'na začátku bez opakování není kam');
  assert.equal(choosePrevious(FRONTA, 'a', 'all').id, 'c', 's opakováním se přeskočí na konec');
});

// ---------- sloty ----------

const prazdne = () => [
  { key: 'a0', track: null },
  { key: 'b0', track: null },
];

test('bez předehrání se musí načíst nový slot (to je ta díra mezi skladbami)', () => {
  const plan = planSwap(prazdne(), 0, t('b'), 'k1');
  assert.equal(plan.reused, false);
  assert.equal(plan.active, 1);
  assert.equal(plan.slots[1].track.id, 'b');
  assert.equal(plan.slots[1].key, 'k1');
});

test('předehraná skladba se použije a nic se nenačítá znovu', () => {
  const sloty = [
    { key: 'k1', track: t('a') },
    { key: 'k2', track: t('b') },
  ];
  const plan = planSwap(sloty, 0, t('b'), 'k9');
  assert.equal(plan.reused, true, 'tohle je celý smysl dvou slotů');
  assert.equal(plan.active, 1);
  assert.equal(plan.slots[1].key, 'k2', 'klíč se nesmí změnit, jinak se iframe nasadí znovu');
});

test('hrající slot se výměnou nikdy nepřepíše', () => {
  const sloty = [
    { key: 'k1', track: t('a') },
    { key: 'k2', track: t('b') },
  ];
  const plan = planSwap(sloty, 0, t('c'), 'k9');
  assert.equal(plan.slots[0].track.id, 'a');
  assert.equal(plan.slots[0].key, 'k1');
});

test('celý průchod frontou: po prvním kroku už je vždycky předehráno', () => {
  let sloty = [
    { key: 'k1', track: t('a') },
    { key: 'b0', track: null },
  ];
  let active = 0;
  let seq = 1;
  const pouzito = [];

  for (const ocekavana of ['b', 'c']) {
    // 1) přehrávač si dopředu načte, co přijde
    const dalsi = chooseNext(FRONTA, sloty[active].track.id, { shuffle: false, repeat: 'off' });
    const pre = planPreload(sloty, active, dalsi, `k${++seq}`);
    if (pre) sloty = pre.slots;

    // 2) skladba dohraje a přepne se
    const plan = planSwap(sloty, active, dalsi, `k${++seq}`);
    sloty = plan.slots;
    active = plan.active;
    pouzito.push(plan.reused);

    assert.equal(sloty[active].track.id, ocekavana);
  }

  assert.deepEqual(pouzito, [true, true], 'po předehrání musí být přepnutí okamžité');
});

test('předehrání se neopakuje, když už je ve slotu to správné', () => {
  const sloty = [
    { key: 'k1', track: t('a') },
    { key: 'k2', track: t('b') },
  ];
  assert.equal(planPreload(sloty, 0, t('b'), 'k9'), null, 'nesmí se sahat na iframe, který už načítá to samé');
});

test('není-li co předehrát, nic se neděje', () => {
  assert.equal(planPreload(prazdne(), 0, null, 'k9'), null);
});

test('předehrává se vždy do slotu, který nehraje', () => {
  const sloty = [
    { key: 'k1', track: t('a') },
    { key: 'k2', track: t('x') },
  ];
  const plan = planPreload(sloty, 1, t('c'), 'k9');
  assert.equal(plan.idle, 0);
  assert.equal(plan.slots[1].track.id, 'x', 'hrající slot zůstane nedotčený');
});


/* ---------- parametry adresy iframu se rozhodují jednou, při vzniku slotu ---------- */
// Adresa iframu se nesmí měnit podle toho, který slot je aktivní - změna
// src iframe načte znovu jako nový přehrávač, kterému pauza ani ztlumení
// neporučí ("duch", který hrál dál). Proto nese slot své parametry sám.
{
  const zacatek = [{ key: 'a0', track: null }, { key: 'b0', track: null }];
  const hrajici = planSwap(zacatek, 0, t('a'), 's1');
  assert.equal(hrajici.slots[1].autoplay, true, 'nový hrající slot se rozjede sám');
  assert.equal(hrajici.slots[1].muted, false, 'a se zvukem');

  const predehrani = planPreload(hrajici.slots, 1, t('b'), 's2');
  assert.equal(predehrani.slots[0].autoplay, false, 'dopředu načtený slot stojí');
  assert.equal(predehrani.slots[0].muted, true, 'a mlčí');

  // Po přepnutí na předehraný slot zůstává jeho záznam beze změny -
  // tedy i adresa iframu. Zvuk mu dá SDK, ne nová adresa.
  const prepnuti = planSwap(predehrani.slots, 1, t('b'), 's3');
  assert.equal(prepnuti.reused, true);
  assert.deepEqual(prepnuti.slots[0], predehrani.slots[0], 'slot se při přepnutí nemění');
  console.log('OK    parametry adresy iframu jsou dané při vzniku slotu a přepnutím se nemění');
  prosly = (typeof prosly === 'number') ? prosly + 1 : prosly;
}

console.log('\n' + prosly + ' kontrol prošlo');
