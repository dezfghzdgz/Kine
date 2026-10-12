/**
 * Test čtení chatu nahlas (lib/chatSpeech.ts): co se přečte, co ne,
 * a že spam (odkazy, opakované znaky, emoji, dlouhé zprávy) stream nezahltí.
 *
 * Spustit:  node tests/chatSpeech.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/chatSpeech.ts');
const S = await import(join(kam, 'chatSpeech.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const T = { tip: '{name} posílá {amount}: {message}', tipNoMessage: '{name} posílá {amount}. Díky!', chat: '{name} píše: {message}', link: 'odkaz' };

test('režimy: vypnuto nic, "jen podpory" jen podpory, "vše" i běžné zprávy', () => {
  const chat = { kind: 'chat', name: 'Pepa', body: 'ahoj' };
  const tip = { kind: 'tip', name: 'Jana', body: 'super stream', amount: '100 Kč' };
  assert.equal(S.speechText(chat, 'off', T), null);
  assert.equal(S.speechText(tip, 'off', T), null);
  assert.equal(S.speechText(chat, 'tips', T), null);
  assert.equal(S.speechText(tip, 'tips', T), 'Jana posílá 100 Kč: super stream');
  assert.equal(S.speechText(chat, 'all', T), 'Pepa píše: ahoj');
  assert.equal(S.parseTtsMode('all'), 'all');
  assert.equal(S.parseTtsMode('nesmysl'), 'off');
});

test('podpora bez vzkazu (jen srdíčko) se přečte jako poděkování; prázdná zpráva v chatu nic', () => {
  assert.equal(S.speechText({ kind: 'tip', name: 'Jana', body: '💛', amount: '5 €' }, 'tips', T), 'Jana posílá 5 €. Díky!');
  assert.equal(S.speechText({ kind: 'chat', name: 'Pepa', body: '😂😂' }, 'all', T), null);
});

test('odkazy se nečtou, opakování a emoji spam se zkrátí', () => {
  assert.equal(S.cleanForSpeech('koukni https://example.com/x?y=1 a www.test.cz', 'odkaz'), 'koukni odkaz a odkaz');
  assert.equal(S.cleanForSpeech('pojď na neco.gg teď', 'odkaz'), 'pojď na odkaz teď');
  assert.equal(S.cleanForSpeech('aaaaaaaaaaaa!!!!!!!!'), 'aaa!!!');
  assert.equal(S.cleanForSpeech('lol lol lol lol lol lol'), 'lol lol lol');
  assert.equal(S.cleanForSpeech('🔥🔥🔥🔥🔥🔥 hype'), '🔥🔥🔥 hype');
});

test('dlouhá zpráva se uřízne na slově (nejvýš ~180 znaků)', () => {
  const long = Array.from({ length: 80 }, (_, i) => `slovo${i}`).join(' ');
  const out = S.cleanForSpeech(long);
  assert.ok(out.length <= S.TTS_MAX_CHARS + 1, `délka ${out.length}`);
  assert.ok(out.endsWith('…'));
  assert.ok(!/slovo\d+\S*…$/.test(out) || out.endsWith('…'));
});

test('jméno se taky čistí (odkaz ve jménu se nečte) a zkrátí', () => {
  const t = S.speechText({ kind: 'chat', name: 'www.spam.com', body: 'čau' }, 'all', T);
  assert.equal(t, 'odkaz píše: čau');
  const long = S.speechText({ kind: 'chat', name: 'x'.repeat(100), body: 'čau' }, 'all', T);
  assert.ok(long.startsWith('xxx') && long.length < 60);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly) process.exit(1);
