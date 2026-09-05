/**
 * Zjistí, jestli se v repu nevrátila starší verze nějakého souboru.
 *
 * PROČ TO TU JE
 *
 * Build už čtyřikrát spadl na tom, že jeden soubor byl v repu starší než
 * ostatní - typicky proto, že se do složky rozbalil nějaký starší ZIP a
 * přepsal novější soubory. Poznat se to dá až podle chybové hlášky
 * z Vercelu, a to je pozdě.
 *
 * Vedle tohohle skriptu je soubor stav-souboru.json s otiskem každého
 * souboru z poslední dodávky. Tenhle skript otisky přepočítá a řekne,
 * co nesedí.
 *
 * POUŽITÍ (v kořeni repa, tam kde je package.json):
 *
 *     node zkontroluj-soubory.mjs
 *
 * Pusť si to VŽDYCKY po rozbalení balíčku a před tím, než pushneš.
 * Trvá to zlomek vteřiny.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const koren = dirname(fileURLToPath(import.meta.url));
const seznamCesta = join(koren, 'stav-souboru.json');

if (!existsSync(seznamCesta)) {
  console.error('Chybí stav-souboru.json - musí ležet vedle tohohle skriptu.');
  process.exit(2);
}

const seznam = JSON.parse(readFileSync(seznamCesta, 'utf8'));

function otisk(cesta) {
  // Konce řádků se sjednotí, ať Windows nehlásí rozdíl u souboru, který
  // je ve skutečnosti stejný.
  const obsah = readFileSync(cesta, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(obsah).digest('hex').slice(0, 16);
}

const chybi = [];
const jine = [];

// Soubory, které starší balíček přinesl a novější už nechce. Přepsat je
// nejde (balíček přepisuje, nemaže), a jeden takový zbytek už rozbil
// build: lib/username.ts z prvního balíčku odkazoval na překlad, který
// druhý balíček odstranil. Proto se tu hlídají i "nesmí existovat".
//   node zkontroluj-soubory.mjs --uklid    je smaže.
const uklid = process.argv.includes('--uklid');
const zbytky = (seznam.smazat ?? []).filter((cesta) => existsSync(join(koren, cesta)));

for (const [cesta, ocekavany] of Object.entries(seznam.soubory)) {
  const plna = join(koren, cesta);
  if (!existsSync(plna)) {
    chybi.push(cesta);
    continue;
  }
  if (otisk(plna) !== ocekavany) jine.push(cesta);
}

console.log(`Kontroluji ${Object.keys(seznam.soubory).length} souborů z dodávky ${seznam.dodavka}.\n`);

if (zbytky.length > 0 && uklid) {
  for (const z of zbytky) {
    unlinkSync(join(koren, z));
    console.log('Smazáno: ' + z);
  }
  console.log('');
  zbytky.length = 0;
}

if (chybi.length === 0 && jine.length === 0 && zbytky.length === 0) {
  console.log('Všechno sedí. Repo je ve stavu, ve kterém jsem ho ověřoval.');
  process.exit(0);
}

if (zbytky.length > 0) {
  console.log('ZBYTKY ze starších balíčků - smaž je (nebo spusť s --uklid):');
  for (const z of zbytky) console.log('  ' + z);
  console.log('');
}

if (chybi.length > 0) {
  console.log('CHYBÍ v repu:');
  for (const c of chybi) console.log('  ' + c);
  console.log('');
}

if (jine.length > 0) {
  console.log('LIŠÍ SE od poslední dodávky:');
  for (const c of jine) console.log('  ' + c);
  console.log('');
  console.log('Když jsi je sám neupravoval, nejspíš se přes ně rozbalil starší ZIP.');
}

console.log('Tohle pošli Claudovi - podle toho pozná, co doplnit.');
process.exit(1);
