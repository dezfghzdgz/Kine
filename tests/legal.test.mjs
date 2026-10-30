/**
 * Test právních textů (lib/legal.ts): česká a anglická verze mají stejnou
 * stavbu (stejně článků a odstavců - číslování 3.2 musí sedět v obou
 * jazycích), odkazy na články míří na existující článek, kontakt je jen
 * kinesupport@gmail.com.
 *
 * Spustit:  node tests/legal.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/legal.ts', 'lib/operator.ts');
const legal = await import(join(kam, 'legal.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const docs = { RULES: legal.RULES, TERMS: legal.TERMS, PRIVACY: legal.PRIVACY };
const allText = (d) => [d.title, ...d.intro, ...(d.summary ?? []), ...d.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.items ?? [])]), d.footer].join('\n');

for (const [name, doc] of Object.entries(docs)) {
  test(`${name}: čeština a angličtina mají stejnou stavbu`, () => {
    assert.equal(doc.cs.sections.length, doc.en.sections.length, 'počet článků');
    doc.cs.sections.forEach((s, i) => {
      assert.equal((s.items ?? []).length, (doc.en.sections[i].items ?? []).length, `odstavce v článku ${i + 1}`);
      assert.equal((s.paragraphs ?? []).length, (doc.en.sections[i].paragraphs ?? []).length, `úvodní věty v článku ${i + 1}`);
    });
    assert.equal((doc.cs.summary ?? []).length, (doc.en.summary ?? []).length, 've zkratce');
    assert.equal(!!doc.cs.numbered, !!doc.en.numbered);
  });
  test(`${name}: kontakt jen kinesupport@gmail.com, žádný jiný e-mail`, () => {
    for (const lang of ['cs', 'en']) {
      const emails = allText(doc[lang]).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
      assert.ok(emails.every((e) => e === 'kinesupport@gmail.com'), emails.join(', '));
    }
  });
}

test('odkazy na články Podmínek z Pravidel míří na existující článek', () => {
  const max = legal.TERMS.cs.sections.length;
  for (const [lang, re] of [['cs', /Podmínky používání, čl\. (\d+)/g], ['en', /Terms of Service, section (\d+)/g]]) {
    for (const m of allText(legal.RULES[lang]).matchAll(re)) assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= max, `${lang}: ${m[0]}`);
  }
  // Odvolání je v čl. 8, výplaty v čl. 10.
  assert.match(legal.TERMS.cs.sections[7].heading, /odvolání/i);
  assert.match(legal.TERMS.en.sections[7].heading, /appeals/i);
  assert.match(legal.TERMS.cs.sections[9].heading, /tvůrcům/);
  assert.match(legal.TERMS.en.sections[9].heading, /creators/);
});

test('podmínky obsahují, co zákon chce u předplatného (odstoupení, vzor, vady, ADR)', () => {
  const cs = allText(legal.TERMS.cs);
  assert.match(cs, /14 dnů/);
  assert.match(cs, /Oznamuji, že odstupuji od smlouvy/);
  assert.match(cs, /obchodní inspekc/);
  assert.match(cs, /6 měsíců/);
  const en = allText(legal.TERMS.en);
  assert.match(en, /14 days/);
  assert.match(en, /I hereby withdraw/);
  assert.match(en, /Czech Trade Inspection Authority/);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
