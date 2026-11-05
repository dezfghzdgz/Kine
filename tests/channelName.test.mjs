/**
 * Jméno kanálu (lib/channelName.ts): zobrazované jméno, přezdívka, náhrada;
 * prázdný text se nepočítá jako jméno (dřív se kanál s '' ukazoval beze jména).
 *
 * Spustit:  node tests/channelName.test.mjs
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/channelName.ts');
const m = await import(join(kam, 'channelName.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try {
    fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    padly++;
  }
}

test('zobrazované jméno má přednost, pak přezdívka, pak náhrada', () => {
  assert.equal(m.channelName({ display_name: 'Daniel', username: 'dan' }, 'Neznámý'), 'Daniel');
  assert.equal(m.channelName({ display_name: null, username: 'dan' }, 'Neznámý'), 'dan');
  assert.equal(m.channelName({ display_name: '', username: 'dan' }, 'Neznámý'), 'dan');
  assert.equal(m.channelName({ display_name: '   ', username: '  ' }, 'Neznámý'), 'Neznámý');
  assert.equal(m.channelName(null, 'Neznámý'), 'Neznámý');
  assert.equal(m.channelName(undefined, 'Kine'), 'Kine');
});

test('jméno se ořízne o mezery', () => {
  assert.equal(m.channelName({ display_name: '  Lucie  ' }, 'x'), 'Lucie');
});

test('písmeno do náhradní ikony', () => {
  assert.equal(m.channelInitial('psicak'), 'P');
  assert.equal(m.channelInitial('@dan'), 'D');
  assert.equal(m.channelInitial('  ěda'), 'Ě');
  assert.equal(m.channelInitial(''), '•');
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
