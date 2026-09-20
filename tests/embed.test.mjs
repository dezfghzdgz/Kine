/**
 * Test vložitelného přehrávače a rozbalování odkazů (lib/embed.ts).
 *
 * Spustit:  NEXT_PUBLIC_SITE_URL=https://kine-lac.vercel.app node tests/embed.test.mjs
 * (bez proměnné se počítá s http://localhost:3000)
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

process.env.NEXT_PUBLIC_SITE_URL = 'https://kine-lac.vercel.app';
const kam = prelozit('lib/embed.ts', 'lib/linkPreview.ts');
const { embedUrl, embedCode, embedSize, videoIdFromUrl, isoDuration, escapeXml } = await import(join(kam, 'embed.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const ID = 'd2acc69f-3edb-44e0-beb3-404cf62171e5';

test('adresa přehrávače, s časem i bez', () => {
  assert.equal(embedUrl(ID), `https://kine-lac.vercel.app/embed/${ID}`);
  assert.equal(embedUrl(ID, 42.7), `https://kine-lac.vercel.app/embed/${ID}?t=42`);
  assert.equal(embedUrl(ID, 0), `https://kine-lac.vercel.app/embed/${ID}`);
});

test('kód iframe: rozměry podle videa, název bez rozbití atributu', () => {
  const code = embedCode(ID, { width: 1920, height: 1080, title: 'Test "uvozovky" <b>' });
  assert.match(code, /^<iframe src="https:\/\/kine-lac\.vercel\.app\/embed\//);
  assert.match(code, /width="560" height="315"/);
  assert.match(code, /title="Test &quot;uvozovky&quot; &lt;b&gt;"/);
  assert.match(code, /allowfullscreen><\/iframe>$/);
});

test('velikost: 16:9, svislé video, bez rozměrů, omezení oEmbed', () => {
  assert.deepEqual(embedSize(1920, 1080), { width: 560, height: 315 });
  assert.deepEqual(embedSize(null, null), { width: 560, height: 315 });
  // Svislé 9:16: výška 315, šířka podle poměru.
  assert.deepEqual(embedSize(1080, 1920), { width: 177, height: 315 });
  // maxwidth zmenší a drží poměr.
  assert.deepEqual(embedSize(1920, 1080, 400), { width: 400, height: 225 });
  assert.deepEqual(embedSize(1920, 1080, null, 200), { width: 356, height: 200 });
});

test('id videa z adresy Kine, cizí adresy ne', () => {
  assert.equal(videoIdFromUrl(`https://kine-lac.vercel.app/watch/${ID}`), ID);
  assert.equal(videoIdFromUrl(`https://kine-lac.vercel.app/embed/${ID}/`), ID);
  assert.equal(videoIdFromUrl(`https://kine-lac.vercel.app/watch/${ID.toUpperCase()}`), ID);
  assert.equal(videoIdFromUrl(`https://youtube.com/watch?v=abc`), null);
  assert.equal(videoIdFromUrl(`https://kine-lac.vercel.app/channel/${ID}`), null);
  assert.equal(videoIdFromUrl('nesmysl'), null);
  assert.equal(videoIdFromUrl(null), null);
});

test('ISO trvání', () => {
  assert.equal(isoDuration(731), 'PT12M11S');
  assert.equal(isoDuration(3600), 'PT1H');
  assert.equal(isoDuration(59.6), 'PT1M');
  assert.equal(isoDuration(0), undefined);
  assert.equal(isoDuration(null), undefined);
});

test('XML escapování', () => {
  assert.equal(escapeXml(`a & b < c > "d" 'e'`), 'a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
