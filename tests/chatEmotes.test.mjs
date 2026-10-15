/**
 * Test emotů, emoji a věcí do chatu (lib/chatEmotes.ts) a obrázků emotů
 * kanálu (lib/emoteImage.ts): rozdělení zprávy, jen emoty, :kódy:,
 * našeptávání, barvy jmen, údaje ke zprávě, příkazy, formáty obrázků.
 *
 * Spustit:  node tests/chatEmotes.test.mjs
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/chatEmotes.ts', 'lib/emoteImage.ts');
const c = await import(join(kam, 'chatEmotes.js'));
const img = await import(join(kam, 'emoteImage.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const map = c.emoteMap([{ code: 'danHype', url: 'https://x/emotes/a.png' }, { code: 'kineHype', url: 'https://x/podvrh.png' }, { code: '1bad', url: 'x' }]);

test('emoty Kine: každý má soubor v public/emotes', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const e of c.KINE_EMOTES) assert.ok(existsSync(join(root, 'public', e.url)), e.url);
  assert.ok(c.KINE_EMOTES.length >= 20);
});

test('mapa emotů: kanál nepřepíše emote Kine, neplatný kód se zahodí', () => {
  assert.equal(map.get('kineHype').url, '/emotes/kineHype.svg');
  assert.equal(map.get('danHype').channel, true);
  assert.equal(map.has('1bad'), false);
});

test('zpráva na kousky: emoty podle kódu (i :kód:), velikost písmen platí', () => {
  const t = c.tokenizeChat('gg kineHype :danHype: kinehype', map, null);
  assert.deepEqual(t.map((x) => x.kind), ['text', 'emote', 'text', 'emote', 'text']);
  assert.equal(t[1].code, 'kineHype');
  assert.equal(t[3].code, 'danHype');
  assert.equal(t[4].text, ' kinehype', 'malými písmeny to emote není');
});

test('zmínky: @jméno, interpunkce za ním, zmínka o mně', () => {
  const t = c.tokenizeChat('ahoj @Daniel, jak to jde @petr.novak?', map, 'daniel');
  const m = t.filter((x) => x.kind === 'mention');
  assert.deepEqual(m.map((x) => [x.name, x.self]), [['Daniel', true], ['petr.novak', false]]);
  assert.ok(t.some((x) => x.kind === 'text' && x.text.startsWith(', jak')));
  assert.equal(c.mentions('díky @DANIEL!', 'daniel'), true);
  assert.equal(c.mentions('mail@daniel.cz', 'daniel'), false);
  assert.equal(c.mentions('ahoj', null), false);
});

test('odkazy: jen http(s) a www., tečka na konci do odkazu nepatří', () => {
  const t = c.tokenizeChat('mrkni na www.playkine.com. a https://x.cz/a?b=1', map, null);
  const links = t.filter((x) => x.kind === 'link');
  assert.deepEqual(links.map((x) => x.href), ['https://www.playkine.com', 'https://x.cz/a?b=1']);
  assert.equal(c.tokenizeChat('javascript:alert(1)', map, null).some((x) => x.kind === 'link'), false);
});

test('jen emoji: skin tóny, vlajky, ZWJ sekvence ano; čísla a text ne', () => {
  for (const ok of ['🔥', '🔥🔥', '👍🏽', '🇨🇿', '❤️', '🏴‍☠️', '🙈 🙉']) assert.equal(c.isEmojiOnly(ok), true, ok);
  for (const no of ['123', 'gg 🔥', '#', 'a', '']) assert.equal(c.isEmojiOnly(no), false, no);
});

test('jen emoty: emoty, :kódy: a emoji ano, slovo ne', () => {
  assert.equal(c.isEmoteOnlyMessage('kineHype 🔥 :danHype:', map), true);
  assert.equal(c.isEmoteOnlyMessage('kineHype gg', map), false);
  assert.equal(c.isEmoteOnlyMessage('   ', map), false);
});

test('před odesláním: :fire: -> 🔥, :kineHype: -> kineHype, neznámé zůstane', () => {
  assert.equal(c.normalizeOutgoing(':fire: gg :kineHype: :neznam: :+1: :srdce:', map), '🔥 gg kineHype :neznam: 👍 ❤️');
  assert.equal(c.normalizeOutgoing('čas 12:30:45', map), 'čas 12:30:45');
});

test('kód emotu kanálu: 2-24 znaků, písmeno na začátku, ne jako emote Kine', () => {
  assert.equal(c.validChannelEmoteCode('danHype'), true);
  assert.equal(c.validChannelEmoteCode('my_emote1'), true);
  for (const bad of ['a', '1abc', 'dan-hype', 'KINEHYPE', 'kineGG', 'x'.repeat(25), 'má']) assert.equal(c.validChannelEmoteCode(bad), false, bad);
});

test('našeptávání: co je rozepsané u kurzoru', () => {
  assert.deepEqual(c.draftQuery('ahoj @pe', 8), { kind: 'user', query: 'pe', start: 5 });
  assert.deepEqual(c.draftQuery('@', 1), { kind: 'user', query: '', start: 0 });
  assert.deepEqual(c.draftQuery('to je :fi', 9), { kind: 'emote', query: 'fi', start: 6 });
  assert.equal(c.draftQuery('to je :f', 8), null, 'aspoň 2 znaky');
  assert.equal(c.draftQuery('mail@x', 6), null, 'zavináč uprostřed slova není zmínka');
  assert.equal(c.draftQuery('12:30', 5), null);
});

test('našeptávání: emoty a emoji, nejdřív ty, co dotazem začínají', () => {
  const all = [...c.KINE_EMOTES, { code: 'danHype', url: 'x' }];
  const hype = c.emoteSuggestions('hype', all);
  assert.ok(hype.some((s) => s.kind === 'emote' && s.code === 'kineHype'));
  assert.ok(hype.some((s) => s.kind === 'emote' && s.code === 'danHype'));
  const fire = c.emoteSuggestions('fir', all);
  assert.ok(fire.some((s) => s.kind === 'emoji' && s.emoji === '🔥'));
  const kine = c.emoteSuggestions('kinef', all);
  assert.equal(kine[0].code.toLowerCase().startsWith('kinef'), true);
  assert.ok(c.emoteSuggestions('xyzxyz', all).length === 0);
  assert.deepEqual(c.userSuggestions('pe', ['Petr', 'eva', 'petr', 'Pepa']).map((s) => s.name), ['Petr', 'Pepa']);
});

test('návrh se vloží místo dotazu (s mezerou) a kurzor skočí za něj', () => {
  const r1 = c.applySuggestion('ahoj @pe jak', 8, 5, { kind: 'user', name: 'petr' });
  assert.deepEqual(r1, { text: 'ahoj @petr jak', caret: 11 });
  const r2 = c.applySuggestion('gg :hy', 6, 3, { kind: 'emote', code: 'kineHype', url: 'x' });
  assert.deepEqual(r2, { text: 'gg kineHype ', caret: 12 });
  const r3 = c.applySuggestion(':fi', 3, 0, { kind: 'emoji', name: 'fire', emoji: '🔥' });
  assert.equal(r3.text, '🔥 ');
});

test('barvy jmen: výchozí podle id je pořád stejná a z palety', () => {
  const a = c.chatNameColor('11111111-1111-4111-8111-111111111111');
  assert.equal(a, c.chatNameColor('11111111-1111-4111-8111-111111111111'));
  assert.ok(c.CHAT_COLORS.includes(a));
  const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => c.chatNameColor(`user-${x}`)));
  assert.ok(colors.size >= 4, 'různí lidé mají různé barvy');
  assert.equal(c.validChatColor('#00c9a7'), true);
  assert.equal(c.validChatColor('red'), false);
  assert.equal(c.validChatColor('#00c9a'), false);
});

test('údaje ke zprávě: jen známé odznaky, platná barva, odpověď', () => {
  const m = c.readChatMeta({ b: ['moderator', 'hacker', 'moderator', 'follower'], c: '#ff0000', fm: 7.9, me: true, first: true, r: { id: '12', uid: 'u', u: 'petr', t: 'x'.repeat(500) } });
  assert.deepEqual(m.b, ['moderator', 'follower']);
  assert.equal(m.c, '#ff0000');
  assert.equal(m.fm, 7);
  assert.equal(m.me, true);
  assert.equal(m.first, true);
  assert.equal(m.r.id, 12);
  assert.equal(m.r.t.length, 120);
  assert.deepEqual(c.readChatMeta(null), {});
  assert.deepEqual(c.readChatMeta({ c: 'javascript:x', b: 'staff' }), {});
  assert.deepEqual([0, 1, 2, 3, 5, 6, 11, 12, 30].map(c.followTier), [0, 1, 1, 3, 3, 6, 6, 12, 24]);
});

test('příkazy: /me, /ban, /timeout (délka nahoru na povolenou), /slow, /followers, /emoteonly, /color', () => {
  assert.equal(c.parseChatCommand('ahoj'), null);
  assert.equal(c.parseChatCommand('//shrug'), null, '// = obyčejná zpráva');
  assert.deepEqual(c.parseChatCommand('/me tancuje'), { cmd: 'me', text: 'tancuje' });
  assert.deepEqual(c.parseChatCommand('/ban @Petr'), { cmd: 'ban', user: 'Petr' });
  assert.deepEqual(c.parseChatCommand('/ban'), { cmd: 'invalid', name: 'ban' });
  assert.deepEqual(c.parseChatCommand('/timeout petr'), { cmd: 'timeout', user: 'petr', minutes: 10 });
  assert.deepEqual(c.parseChatCommand('/timeout petr 5m'), { cmd: 'timeout', user: 'petr', minutes: 10 });
  assert.deepEqual(c.parseChatCommand('/timeout petr 2h'), { cmd: 'timeout', user: 'petr', minutes: 1440 });
  assert.deepEqual(c.parseChatCommand('/timeout petr 30s'), { cmd: 'timeout', user: 'petr', minutes: 1 });
  assert.deepEqual(c.parseChatCommand('/slow'), { cmd: 'slow', seconds: 30 });
  assert.deepEqual(c.parseChatCommand('/slow off'), { cmd: 'slow', seconds: 0 });
  assert.equal(c.parseChatCommand('/slow 9999').cmd, 'invalid');
  assert.deepEqual(c.parseChatCommand('/followers 1h'), { cmd: 'followers', minutes: 60 });
  assert.deepEqual(c.parseChatCommand('/followers off'), { cmd: 'followers', minutes: null });
  assert.deepEqual(c.parseChatCommand('/emoteonly'), { cmd: 'emoteonly', on: null });
  assert.deepEqual(c.parseChatCommand('/emoteonlyoff'), { cmd: 'emoteonly', on: false });
  assert.deepEqual(c.parseChatCommand('/color #FF0000'), { cmd: 'color', color: '#ff0000' });
  assert.deepEqual(c.parseChatCommand('/color reset'), { cmd: 'color', color: null });
  assert.equal(c.parseChatCommand('/color modra').cmd, 'invalid');
  assert.deepEqual(c.parseChatCommand('/HELP'), { cmd: 'help' });
  assert.deepEqual(c.parseChatCommand('/tanec'), { cmd: 'unknown', name: 'tanec' });
});

test('výběr emoji: v každé skupině jen emoji, bez dvojic', () => {
  for (const cat of c.EMOJI_CATEGORIES) {
    assert.ok(cat.emoji.length >= 20, cat.id);
    for (const e of cat.emoji) assert.equal(c.isEmojiOnly(e), true, `${cat.id}: ${JSON.stringify(e)}`);
    assert.equal(new Set(cat.emoji).size, cat.emoji.length, `${cat.id} má dvojice`);
  }
  for (const [name, e] of Object.entries(c.EMOJI_SHORTCODES)) assert.equal(c.isEmojiOnly(e), true, name);
});

// ---- obrázky emotů ---------------------------------------------------------------------------------

function png(width, height, extraChunk = null) {
  const b = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type, data) => {
    const len = data.length;
    b.push((len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...[...type].map((x) => x.charCodeAt(0)), ...data, 0, 0, 0, 0);
  };
  chunk('IHDR', [(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255, (height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255, 8, 6, 0, 0, 0]);
  if (extraChunk) chunk(extraChunk, [0, 0, 0, 2, 0, 0, 0, 0]);
  chunk('IDAT', [0]);
  chunk('IEND', []);
  return new Uint8Array(b);
}

function gif(width, height, frames) {
  const b = [...'GIF89a'].map((x) => x.charCodeAt(0));
  b.push(width & 255, width >> 8, height & 255, height >> 8, 0x00, 0, 0); // bez globální tabulky
  for (let i = 0; i < frames; i++) {
    b.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0); // řízení grafiky
    b.push(0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0x00, 2, 2, 0x4c, 0x01, 0);
  }
  b.push(0x3b);
  return new Uint8Array(b);
}

function webpVp8x(width, height, animated) {
  const b = new Uint8Array(30);
  b.set([...'RIFF'].map((x) => x.charCodeAt(0)), 0);
  b.set([...'WEBP'].map((x) => x.charCodeAt(0)), 8);
  b.set([...'VP8X'].map((x) => x.charCodeAt(0)), 12);
  b[20] = animated ? 0x12 : 0x10;
  const w = width - 1;
  const h = height - 1;
  b.set([w & 255, (w >> 8) & 255, (w >> 16) & 255], 24);
  b.set([h & 255, (h >> 8) & 255, (h >> 16) & 255], 27);
  return b;
}

test('obrázek emotu: PNG (i APNG), GIF (animovaný?), WebP, nesmysl', () => {
  assert.deepEqual(img.emoteImageInfo(png(112, 112)), { ext: 'png', type: 'image/png', width: 112, height: 112, animated: false });
  assert.equal(img.emoteImageInfo(png(64, 64, 'acTL')).animated, true);
  assert.deepEqual(img.emoteImageInfo(gif(56, 28, 1)), { ext: 'gif', type: 'image/gif', width: 56, height: 28, animated: false });
  assert.equal(img.emoteImageInfo(gif(56, 56, 3)).animated, true);
  assert.deepEqual(img.emoteImageInfo(webpVp8x(112, 100, true)), { ext: 'webp', type: 'image/webp', width: 112, height: 100, animated: true });
  assert.equal(img.emoteImageInfo(webpVp8x(112, 112, false)).animated, false);
  assert.equal(img.emoteImageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])), null, 'JPEG ne - nemá průhlednost, prohlížeč ho převede na PNG');
  assert.equal(img.emoteImageInfo(new Uint8Array(10)), null);
});

test('obrázek emotu: velikost a tvar', () => {
  const info = (w, h) => ({ ext: 'png', type: 'image/png', width: w, height: h, animated: false });
  assert.equal(img.checkEmoteImage(info(112, 112), 1000, 512 * 1024), null);
  assert.equal(img.checkEmoteImage(info(112, 112), 600 * 1024, 512 * 1024), 'too-big');
  assert.equal(img.checkEmoteImage(info(10, 10), 1000, 512 * 1024), 'size');
  assert.equal(img.checkEmoteImage(info(1024, 1024), 1000, 512 * 1024), 'size');
  assert.equal(img.checkEmoteImage(info(300, 50), 1000, 512 * 1024), 'size');
  assert.equal(img.checkEmoteImage(info(84, 28), 1000, 512 * 1024), null, 'nápis 3:1 projde');
  assert.equal(img.checkEmoteImage(null, 1000, 512 * 1024), 'not-image');
});

test('cesta emotu v úložišti: jen soubory emotů toho kanálu', () => {
  const ch = '22222222-2222-4222-8222-222222222222';
  assert.equal(img.emoteStoragePath(ch, 'abc', 'png'), `emotes/${ch}/abc.png`);
  const url = `https://x.supabase.co/storage/v1/object/public/thumbnails/emotes/${ch}/0f1e2d3c-aaaa-bbbb-cccc-111122223333.gif`;
  assert.equal(img.emotePathFromUrl(url, ch), `emotes/${ch}/0f1e2d3c-aaaa-bbbb-cccc-111122223333.gif`);
  assert.equal(img.emotePathFromUrl(url, '33333333-3333-4333-8333-333333333333'), null, 'cizí kanál');
  assert.equal(img.emotePathFromUrl(`https://x.supabase.co/storage/v1/object/public/thumbnails/live/${ch}/a.jpg`, ch), null);
  assert.equal(img.emotePathFromUrl(`https://x.supabase.co/storage/v1/object/public/thumbnails/emotes/${ch}/../../avatars/x.png`, ch), null);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
