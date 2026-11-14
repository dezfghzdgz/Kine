/**
 * Test náhledu odkazu v Discordu jako u Medalu (lib/discordEmbed.ts):
 * video v chatu jen u krátkých videí, tlačítka, ochrana proti markdownu
 * v názvu a limit 3 000 bajtů.
 *
 * Spustit:  node tests/discordEmbed.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/discordEmbed.ts');
const { discordEmbedPayload, discordVideoEligible, escapeDiscordMarkdown, payloadBytes, streamMp4Url, DISCORD_EMBED_MAX_BYTES } = await import(join(kam, 'discordEmbed.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const base = {
  title: 'W bait',
  creator: '34Vojáček85',
  game: 'Counter-Strike 2',
  watchUrl: 'https://www.playkine.com/watch/d2acc69f-3edb-44e0-beb3-404cf62171e5',
  channelUrl: 'https://www.playkine.com/channel/11111111-2222-3333-4444-555555555555',
  downloadUrl: 'https://www.playkine.com/download',
  mediaUrl: 'https://customer-abc123.cloudflarestream.com/0123456789abcdef0123456789abcdef/downloads/default.mp4',
  accent: '#00c9a7',
};

test('video v Discordu jen u krátkých videí (do 3 minut)', () => {
  assert.equal(discordVideoEligible(30), true);
  assert.equal(discordVideoEligible(180), true);
  assert.equal(discordVideoEligible(181), false);
  assert.equal(discordVideoEligible(0), false);
  assert.equal(discordVideoEligible(null), false);
  assert.equal(discordVideoEligible(NaN), false);
});

test('adresa MP4 u Cloudflare', () => {
  assert.equal(streamMp4Url('abc123', '0123456789abcdef0123456789abcdef'), 'https://customer-abc123.cloudflarestream.com/0123456789abcdef0123456789abcdef/downloads/default.mp4');
});

test('rozvržení jako u Medalu: název, tvůrce · hra, video, tři tlačítka', () => {
  const p = discordEmbedPayload(base);
  assert.ok(p);
  const c = p.component;
  assert.equal(c.type, 17);
  assert.equal(c.accent_color, 0x00c9a7);
  assert.equal(c.components.length, 3);
  const [text, gallery, row] = c.components;
  assert.equal(text.type, 10);
  assert.equal(text.content, '### W bait\n34Vojáček85 · Counter\\-Strike 2');
  assert.equal(gallery.type, 12);
  assert.deepEqual(gallery.items, [{ media: { url: base.mediaUrl } }]);
  assert.equal(row.type, 1);
  assert.deepEqual(row.components.map((b) => b.label), ['Watch on Kine', 'Follow on Kine', 'Download for PC']);
  for (const b of row.components) {
    assert.equal(b.type, 2);
    assert.equal(b.style, 5, 'jen tlačítka-odkazy');
    // Jiný klíč než povolené by Discordu zneplatnil celý náhled.
    assert.deepEqual(Object.keys(b).sort(), ['label', 'style', 'type', 'url']);
  }
  assert.equal(row.components[0].url, base.watchUrl);
  assert.equal(row.components[1].url, base.channelUrl);
});

test('bez kanálu bez Follow, bez obrázku bez galerie, bez hry jen tvůrce', () => {
  const p = discordEmbedPayload({ ...base, channelUrl: null, mediaUrl: null, game: null, accent: 'nesmysl' });
  const c = p.component;
  assert.equal(c.accent_color, undefined);
  assert.equal(c.components.length, 2);
  assert.equal(c.components[0].content, '### W bait\n34Vojáček85');
  assert.deepEqual(c.components[1].components.map((b) => b.label), ['Watch on Kine', 'Download for PC']);
});

test('název nesmí udělat odkaz, nadpis ani zmínku', () => {
  assert.equal(escapeDiscordMarkdown('[klikni](https://zle.cz) **tučně** @everyone <@123>'), '\\[klikni\\]\\(https\\://zle.cz\\) \\*\\*tučně\\*\\* \\@everyone \\<\\@123\\>');
  assert.equal(escapeDiscordMarkdown('řádek\nnový # nadpis'), 'řádek nový \\# nadpis');
  const p = discordEmbedPayload({ ...base, title: '# [x](https://zle.cz)' });
  assert.ok(!/\]\(https/.test(p.component.components[0].content.replace(/\\\]\\\(/g, '')));
  assert.ok(p.component.components[0].content.startsWith('### \\# \\[x\\]'));
});

test('limit 3 000 bajtů: dlouhý název se zkrátí, nic nepřeteče', () => {
  const long = discordEmbedPayload({ ...base, title: '[]'.repeat(400) + 'ž'.repeat(300), creator: '*'.repeat(200) });
  assert.ok(long);
  assert.ok(payloadBytes(long) <= DISCORD_EMBED_MAX_BYTES);
  assert.ok(long.component.components[0].content.includes('…'));
  const normal = discordEmbedPayload(base);
  assert.ok(payloadBytes(normal) < 1000);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
