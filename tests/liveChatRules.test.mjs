/**
 * Test pravidel chatu (lib/liveChatRules.ts): pomalý režim, jen odběratelé,
 * odkazy, zakázaná slova, ztlumení, štít.
 *
 * Spustit:  node tests/liveChatRules.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/liveChatRules.ts');
const r = await import(join(kam, 'liveChatRules.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const NOW = Date.parse('2026-10-11T21:00:00Z');
const MIN = 60000;
const base = (over = {}) => ({
  text: 'ahoj všichni',
  settings: { ...r.DEFAULT_CHAT_SETTINGS },
  exempt: false,
  now: NOW,
  lastMessageAt: null,
  followingSince: null,
  accountCreatedAt: NOW - 400 * 24 * 60 * MIN,
  ban: null,
  ...over,
});

test('bez pravidel projde všechno', () => {
  assert.equal(r.checkChatMessage(base()), null);
});

test('zákaz a ztlumení platí i pro moderátora (dát ho na něj ale nejde)', () => {
  assert.deepEqual(r.checkChatMessage(base({ ban: { until: null } })), { code: 'banned' });
  const t = r.checkChatMessage(base({ ban: { until: NOW + 5 * MIN } }));
  assert.equal(t.code, 'timeout');
  assert.equal(r.checkChatMessage(base({ ban: { until: NOW - 1 } })), null, 'prošlé ztlumení už neplatí');
});

test('pomalý režim: počká se zbytek', () => {
  const s = { ...r.DEFAULT_CHAT_SETTINGS, slowSeconds: 30 };
  assert.deepEqual(r.checkChatMessage(base({ settings: s, lastMessageAt: NOW - 10000 })), { code: 'slow', seconds: 20 });
  assert.equal(r.checkChatMessage(base({ settings: s, lastMessageAt: NOW - 31000 })), null);
  assert.equal(r.checkChatMessage(base({ settings: s, lastMessageAt: NOW - 1000, exempt: true })), null, 'moderátor pomalý režim nemá');
});

test('jen odběratelé, i s minimální dobou odběru', () => {
  const s = { ...r.DEFAULT_CHAT_SETTINGS, followersOnly: true, followMinutes: 10 };
  assert.equal(r.checkChatMessage(base({ settings: s })).code, 'followers');
  assert.equal(r.checkChatMessage(base({ settings: s, followingSince: NOW - 2 * MIN })).code, 'followers');
  assert.equal(r.checkChatMessage(base({ settings: s, followingSince: NOW - 11 * MIN })), null);
});

test('nový účet (štít) nepíše', () => {
  const s = { ...r.DEFAULT_CHAT_SETTINGS, minAccountMinutes: 24 * 60 };
  assert.equal(r.checkChatMessage(base({ settings: s, accountCreatedAt: NOW - 5 * MIN })).code, 'newAccount');
  assert.equal(r.checkChatMessage(base({ settings: s, accountCreatedAt: NOW - 2 * 24 * 60 * MIN })), null);
});

test('odkazy: poznají se i bez http', () => {
  for (const t of ['koukni https://evil.example/x', 'www.neco.cz', 'pridej se discord.gg/abc', 'free skins at skins . com', 'neco.gg/x']) assert.ok(r.containsLink(t), t);
  for (const t of ['ahoj, jak se máš?', 'skóre 3.5 bodu', 'gg wp', 'to bylo 1.2.2026']) assert.ok(!r.containsLink(t), t);
  const s = { ...r.DEFAULT_CHAT_SETTINGS, blockLinks: true };
  assert.equal(r.checkChatMessage(base({ settings: s, text: 'www.spam.com' })).code, 'links');
});

test('zakázaná slova: diakritika, velká písmena, číslice i mezery nepomůžou; krátká jen celá', () => {
  const terms = ['idiot', 'ass', 'kill yourself'];
  assert.equal(r.matchBlockedTerm('Ty jsi IDIOT', terms), 'idiot');
  assert.equal(r.matchBlockedTerm('jste idioti', terms), 'idiot');
  assert.equal(r.matchBlockedTerm('1d10t', terms), 'idiot');
  assert.equal(r.matchBlockedTerm('i d i o t', terms), 'idiot');
  assert.equal(r.matchBlockedTerm('Kill   Yourself!!', terms), 'kill yourself');
  assert.equal(r.matchBlockedTerm('to je ass', terms), 'ass');
  assert.equal(r.matchBlockedTerm('first class play', terms), null, 'class není ass');
  assert.equal(r.matchBlockedTerm('what each team does', ['hate']), null, 'slepení přes slova nepočítat');
  assert.equal(r.matchBlockedTerm('nic tu není', terms), null);
});

test('nastavení z čehokoli: meze, duplicitní a prázdná slova pryč', () => {
  const s = r.sanitizeChatSettings({ slow_seconds: 99999, followers_only: true, follow_minutes: -5, block_links: 'ano', blocked_terms: [' Idiot ', 'idiot', 'x', ''], shield: true });
  assert.equal(s.slowSeconds, 600);
  assert.equal(s.followersOnly, true);
  assert.equal(s.followMinutes, 0);
  assert.equal(s.blockLinks, false);
  assert.deepEqual(s.blockedTerms, ['Idiot', 'idiot']);
  assert.equal(s.shield, true);
});

test('režim jen emoty: slova neprojdou, emoty a emoji ano, moderátor může cokoli', () => {
  const s = { ...r.DEFAULT_CHAT_SETTINGS, emoteOnly: true };
  assert.deepEqual(r.checkChatMessage(base({ settings: s, emoteOnlyMessage: false })), { code: 'emoteOnly' });
  assert.equal(r.checkChatMessage(base({ settings: s, emoteOnlyMessage: true })), null);
  assert.equal(r.checkChatMessage(base({ settings: s, emoteOnlyMessage: false, exempt: true })), null);
  assert.equal(r.sanitizeChatSettings({ emote_only: true }).emoteOnly, true);
  assert.equal(r.sanitizeChatSettings({ emote_only: 'ano' }).emoteOnly, false);
  assert.equal(r.DEFAULT_CHAT_SETTINGS.emoteOnly, false);
  // Štít jen emoty nemění (zapnutí štítu ho nevypne, ani nezapne).
  assert.equal('emoteOnly' in r.SHIELD_SETTINGS, false);
});

test('připnutá zpráva: jen platná kopie projde', () => {
  assert.equal(r.readPinned(null), null);
  assert.equal(r.readPinned({ id: 'x', t: 'a' }), null);
  assert.equal(r.readPinned({ id: 5, t: '' }), null);
  const p = r.readPinned({ id: 5, uid: 'u1', u: 'daniel', t: 'Vítejte!', at: '2026-10-14T10:00:00Z' });
  assert.deepEqual(p, { id: 5, uid: 'u1', u: 'daniel', t: 'Vítejte!', at: '2026-10-14T10:00:00Z' });
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
