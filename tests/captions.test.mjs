/**
 * Test titulků a kapitol (lib/captions.ts): import .srt/.vtt, převod zpět
 * do SRT, který řádek platí kdy, a kapitoly z popisu videa.
 *
 * Spustit:  node tests/captions.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/captions.ts');
const { parseSubtitles, toSrt, captionAt, chaptersFromDescription, effectiveChapters, parseTimestamp, autoCaptionLanguage, sanitizeChapters, sanitizeCaptions } = await import(join(kam, 'captions.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('časy: m:ss, h:mm:ss, s milisekundami, nesmysly', () => {
  assert.equal(parseTimestamp('1:23'), 83);
  assert.equal(parseTimestamp('01:02:03,450'), 3723.45);
  assert.equal(parseTimestamp('00:00:01.5'), 1.5);
  assert.equal(parseTimestamp('90:00'), 5400);
  assert.equal(parseTimestamp('1:61'), null);
  assert.equal(parseTimestamp('abc'), null);
});

test('SRT se přečte i se značkami a Windows konci řádků', () => {
  const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Ahoj</i> světe\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nDruhý\r\nřádek\r\n';
  const c = parseSubtitles(srt);
  assert.deepEqual(c, [
    { time: 1, end: 3.5, text: 'Ahoj světe' },
    { time: 4, end: 6, text: 'Druhý\nřádek' },
  ]);
});

test('WebVTT (i od Cloudflare): hlavička, NOTE, nastavení za časem, krátké časy', () => {
  const vtt = 'WEBVTT\n\nNOTE generováno\n\n00:01.000 --> 00:02.500 align:start position:10%\nPrvní\n\ncue-2\n00:00:03.000 --> 00:00:04.000\n<c.yellow>Druhý</c>\n';
  const c = parseSubtitles(vtt);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { time: 1, end: 2.5, text: 'První' });
  assert.equal(c[1].text, 'Druhý');
});

test('převod do SRT a zpátky nic neztratí; chybějící konec = další řádek (nejvýš +4 s)', () => {
  const src = [{ time: 0.5, text: 'A' }, { time: 2, text: 'B', end: 3 }, { time: 10, text: 'C' }];
  const srt = toSrt(src);
  assert.match(srt, /^1\n00:00:00,500 --> 00:00:02,000\nA/);
  const back = parseSubtitles(srt);
  assert.deepEqual(back.map((c) => [c.time, c.end, c.text]), [[0.5, 2, 'A'], [2, 3, 'B'], [10, 14, 'C']]);
});

test('který řádek platí: s koncem do konce, bez konce do dalšího / 4 s', () => {
  const sorted = [{ time: 1, text: 'A', end: 2 }, { time: 5, text: 'B' }, { time: 7, text: 'C' }];
  assert.equal(captionAt(sorted, 0.5), null);
  assert.equal(captionAt(sorted, 1.5), 'A');
  assert.equal(captionAt(sorted, 3), null);
  assert.equal(captionAt(sorted, 6.9), 'B');
  assert.equal(captionAt(sorted, 10.9), 'C');
  assert.equal(captionAt(sorted, 11.5), null);
});

test('kapitoly z popisu jako na YouTube', () => {
  const desc = 'Video o CS2\n\n0:00 Úvod\n1:30 - Mirage\n(12:05) Konec\nodkaz: https://kine\n';
  assert.deepEqual(chaptersFromDescription(desc), [
    { time: 0, title: 'Úvod' },
    { time: 90, title: 'Mirage' },
    { time: 725, title: 'Konec' },
  ]);
  // První nezačíná na začátku, jen jedna, nebo časy nejdou po sobě -> žádné kapitoly
  assert.deepEqual(chaptersFromDescription('1:00 A\n2:00 B'), []);
  assert.deepEqual(chaptersFromDescription('0:00 Jen jedna'), []);
  assert.deepEqual(chaptersFromDescription('0:00 A\n0:30 B\n0:10 C'), [{ time: 0, title: 'A' }, { time: 30, title: 'B' }]);
  // Za koncem videa se nebere
  assert.deepEqual(chaptersFromDescription('0:00 A\n0:30 B\n9:00 C', 120), [{ time: 0, title: 'A' }, { time: 30, title: 'B' }]);
});

test('kapitoly videa: zadané mají přednost, jinak z popisu', () => {
  assert.deepEqual(effectiveChapters({ chapters: [{ time: 30, title: 'B' }, { time: 0, title: 'A' }], description: '0:00 X\n1:00 Y' }), [{ time: 0, title: 'A' }, { time: 30, title: 'B' }]);
  assert.deepEqual(effectiveChapters({ chapters: [], description: '0:00 X\n1:00 Y' }), [{ time: 0, title: 'X' }, { time: 60, title: 'Y' }]);
});

test('automatické titulky jen pro jazyky, které Cloudflare umí', () => {
  assert.equal(autoCaptionLanguage('cs'), 'cs');
  assert.equal(autoCaptionLanguage('en-US'), 'en');
  assert.equal(autoCaptionLanguage('sk'), null);
  assert.equal(autoCaptionLanguage('uk'), null);
  assert.equal(autoCaptionLanguage(null), null);
});

test('kapitoly a titulky od klienta: jen platné položky, seřazené, bez rozbitých typů', () => {
  assert.deepEqual(sanitizeChapters(null), []);
  assert.deepEqual(sanitizeChapters('0:00 x'), []);
  assert.deepEqual(
    sanitizeChapters([{ time: 95, title: ' Triple kill ' }, { time: 0, title: 'Začátek' }, { time: 95, title: 'Dvojka' }, { time: -1, title: 'x' }, { time: 5, title: 7 }, null, { time: '12.5', title: 'Text' }]),
    [{ time: 0, title: 'Začátek' }, { time: 12.5, title: 'Text' }, { time: 95, title: 'Triple kill' }]
  );
  // Číslo místo názvu uložené v databázi nesmí shodit stránku videa.
  assert.deepEqual(effectiveChapters({ chapters: [{ time: 0, title: 5 }], description: '0:00 A\n1:00 B' }), [{ time: 0, title: 'A' }, { time: 60, title: 'B' }]);
  assert.deepEqual(sanitizeCaptions([{ time: 2, text: 'b', end: 1 }, { time: 1, text: 'a', end: 1.5 }, { time: 3, text: '' }, { time: 'x', text: 'y' }]), [{ time: 1, end: 1.5, text: 'a' }, { time: 2, text: 'b' }]);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
