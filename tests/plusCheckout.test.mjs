/**
 * Test textů na platební stránce Kine Plus (lib/plusCheckout.ts) a řádku
 * provozovatele (lib/operator.ts).
 *
 * Spustit:  node tests/plusCheckout.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/plusCheckout.ts', 'lib/operator.ts');
const c = await import(join(kam, 'plusCheckout.js'));
const o = await import(join(kam, 'operator.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const SITE = 'https://www.playkine.com/';

test('čeština a slovenština: české texty', () => {
  const cs = c.checkoutTexts('cs', SITE);
  assert.equal(cs.locale, 'cs');
  assert.ok(cs.consent.includes('(https://www.playkine.com/terms)'), 'odkaz na podmínky');
  assert.match(cs.consent, /14 dnů/);
  assert.match(cs.consent, /poměrnou část/);
  assert.ok(cs.consentPlain.includes('playkine.com/terms'));
  assert.ok(!cs.consentPlain.includes('https://'), 'u tlačítka bez odkazu');
  assert.match(cs.renewal, /každý měsíc/);
  assert.equal(c.checkoutTexts('sk-SK', SITE).locale, 'sk');
  assert.equal(c.checkoutTexts('sk', SITE).consent, cs.consent);
});

test('ostatní jazyky: anglicky, Stripe vybere jazyk sám', () => {
  assert.equal(c.checkoutTexts('en', SITE).locale, 'en');
  assert.equal(c.checkoutTexts('de', SITE).locale, 'auto');
  assert.equal(c.checkoutTexts(undefined, SITE).locale, 'auto');
  assert.equal(c.checkoutTexts(42, SITE).locale, 'auto');
  assert.match(c.checkoutTexts('pl', SITE).consent, /14 days/);
});

test('texty se vejdou do limitu Stripe (1200 znaků)', () => {
  for (const lang of ['cs', 'en']) {
    const t = c.checkoutTexts(lang, SITE);
    assert.ok(t.consent.length < 1200);
    assert.ok(`${t.consentPlain} ${t.renewal}`.length < 1200);
    assert.ok(t.renewal.length < 1200);
  }
});

test('provozovatel na webu', () => {
  const op = { name: 'Jan Novák', ico: '12345678', address: 'Dlouhá 1, Praha' };
  assert.equal(
    o.operatorLine('cs', op),
    'Provozovatel: Jan Novák, IČO 12345678, místo podnikání Dlouhá 1, Praha - fyzická osoba podnikající, zapsaná v živnostenském rejstříku.'
  );
  assert.match(o.operatorLine('en', op), /^Operator: Jan Novák, ID No\. \(IČO\) 12345678/);
  assert.equal(o.operatorLine('cs', { ...op, name: '' }), null, 'bez jména nic');
  assert.equal(o.operatorLine('cs', { name: 'Jan Novák', ico: '', address: '' }), 'Provozovatel: Jan Novák - fyzická osoba podnikající, zapsaná v živnostenském rejstříku.');
  assert.equal(
    o.operatorLine('cs', { name: 'Kine s.r.o.', ico: '1', address: 'Praha', registry: 'zapsaná v obchodním rejstříku u Městského soudu v Praze, oddíl C, vložka 1.' }),
    'Provozovatel: Kine s.r.o., IČO 1, místo podnikání Praha - zapsaná v obchodním rejstříku u Městského soudu v Praze, oddíl C, vložka 1.'
  );
  // Bez proměnných ve Vercelu se nic neukáže (texty jako dřív).
  assert.equal(o.operatorLine('cs'), null);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
process.exit(padly ? 1 : 0);
