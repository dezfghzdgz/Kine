/**
 * Test cen Kine Plus (lib/plusPrices.ts + zobrazení v lib/plus.ts):
 * která cena se prodává, co se ukáže (jen eura a dolary, koruny nikdy)
 * a náhradní cena ze starého popisku ve Vercelu.
 *
 * Spustit:  node tests/plusPrices.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

delete process.env.STRIPE_SECRET_KEY;
process.env.STRIPE_PLUS_KINE_PRICE_ID = 'price_env_kine';

const kam = prelozit('lib/plusPrices.ts', 'lib/plus.ts', 'lib/stripeSetup.ts');
// Knihovna Stripe se v testu nevolá - stačí prázdná náhrada vedle přeloženého kódu.
mkdirSync(join(kam, 'node_modules', 'stripe'), { recursive: true });
writeFileSync(join(kam, 'node_modules', 'stripe', 'package.json'), JSON.stringify({ name: 'stripe', type: 'module', main: 'index.js' }));
writeFileSync(join(kam, 'node_modules', 'stripe', 'index.js'), 'export default class Stripe { constructor() { throw new Error("v testu se Stripe nevolá"); } }\n');
const pp = await import(join(kam, 'plusPrices.js'));
const plus = await import(join(kam, 'plus.js'));
const s = await import(join(kam, 'stripeSetup.js'));

let prosly = 0;
let padly = 0;
async function test(nazev, fn) {
  try {
    await fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    padly++;
  }
}
/** Mezery z Intl (nezlomitelné) jako obyčejné - ať se dá porovnávat. */
const n = (text) => (text == null ? text : text.replace(/\s/g, ' '));

const month = { interval: 'month', interval_count: 1 };
const eur = { id: 'price_eur', active: true, currency: 'eur', unit_amount: 249, lookup_key: 'kine_plus_kine_month_eur', recurring: month, currency_options: { eur: { unit_amount: 249 }, usd: { unit_amount: 299 } } };
const usd = { id: 'price_usd', active: true, currency: 'usd', unit_amount: 299, lookup_key: 'kine_plus_kine_month_usd', recurring: month };
const czkEnv = { id: 'price_env_kine', active: true, currency: 'czk', unit_amount: 5900, recurring: month, currency_options: { czk: { unit_amount: 5900 }, eur: { unit_amount: 249 } } };

await test('prodává se cena v EUR z /admin/stripe, pak v USD, pak ta z Vercelu', () => {
  assert.equal(pp.pickTierPrice('kine', [usd, eur], czkEnv)?.id, 'price_eur');
  assert.equal(pp.pickTierPrice('kine', [usd], czkEnv)?.id, 'price_usd');
  assert.equal(pp.pickTierPrice('kine', [], czkEnv)?.id, 'price_env_kine');
  assert.equal(pp.pickTierPrice('kine', [], null), null);
});

await test('archivovaná, roční nebo cizí cena se neprodává', () => {
  assert.equal(pp.pickTierPrice('kine', [{ ...eur, active: false }], null), null, 'archivovaná');
  assert.equal(pp.pickTierPrice('kine', [{ ...eur, recurring: { interval: 'year', interval_count: 1 } }], null), null, 'roční');
  assert.equal(pp.pickTierPrice('kine', [{ ...eur, recurring: { interval: 'month', interval_count: 3 } }], null), null, 'čtvrtletní');
  assert.equal(pp.pickTierPrice('clips', [eur], null), null, 'cena jiné varianty');
  assert.equal(pp.pickTierPrice('kine', [], { ...czkEnv, active: false }), null, 'archivovaná z Vercelu');
});

await test('ukazují se jen eura a dolary', () => {
  assert.deepEqual(pp.priceAmounts(eur), { eur: 249, usd: 299 });
  assert.deepEqual(pp.priceAmounts(usd), { eur: null, usd: 299 });
  assert.deepEqual(pp.priceAmounts(czkEnv), { eur: 249, usd: null }, 'koruny s eury: jen eura');
  assert.deepEqual(pp.priceAmounts({ ...czkEnv, currency_options: null }), { eur: null, usd: null }, 'jen koruny: nic');
});

await test('měna podle země: v USA dolary, jinde eura', () => {
  assert.equal(pp.shownCurrencyFor('US'), 'usd');
  assert.equal(pp.shownCurrencyFor('us'), 'usd');
  assert.equal(pp.shownCurrencyFor('PR'), 'usd');
  assert.equal(pp.shownCurrencyFor('CZ'), 'eur');
  assert.equal(pp.shownCurrencyFor('GB'), 'eur');
  assert.equal(pp.shownCurrencyFor(null), 'eur');
});

await test('popisky pro appku: zvolená měna, jinak ta, která je', () => {
  const prices = {
    ok: true,
    tiers: {
      kine: { priceId: 'a', currency: 'eur', amounts: { eur: 249, usd: 299 } },
      clips: { priceId: 'b', currency: 'eur', amounts: { eur: 299, usd: null } },
      all: null,
    },
  };
  const fmt = (cents, cur) => plus.formatPlusAmount(cents, cur, 'en');
  assert.deepEqual(pp.shownLabels(prices, 'usd', fmt), { kine: '$2.99', clips: '€2.99', all: null });
  assert.deepEqual(pp.shownLabels(prices, 'eur', fmt), { kine: '€2.49', clips: '€2.99', all: null });
});

await test('bez klíče Stripe: „nevíme“ (ok false), žádná chyba', async () => {
  const r = await pp.getPlusPrices({ fresh: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.tiers, { kine: null, clips: null, all: null });
  const forCheckout = await pp.tierPriceIdForCheckout('kine');
  assert.deepEqual(forCheckout, { priceId: 'price_env_kine', fromStripe: false }, 'nákup zkusí cenu z Vercelu');
});

await test('částka podle jazyka webu', () => {
  assert.equal(n(plus.formatPlusAmount(249, 'eur', 'en')), '€2.49');
  assert.equal(n(plus.formatPlusAmount(249, 'eur', 'cs')), '2,49 €');
  assert.equal(n(plus.formatPlusAmount(300, 'eur', 'en')), '€3');
  assert.equal(n(plus.formatPlusAmount(299, 'usd', 'en')), '$2.99');
  assert.equal(n(plus.formatPlusAmount(399, 'eur', 'de')), '3,99 €');
});

await test('starý popisek z Vercelu: jen eurová / dolarová část, koruny nikdy', () => {
  assert.deepEqual(plus.parseShownAmount('2,49 €'), { cents: 249, currency: 'eur' });
  assert.deepEqual(plus.parseShownAmount('€2.49'), { cents: 249, currency: 'eur' });
  assert.deepEqual(plus.parseShownAmount('$2.99'), { cents: 299, currency: 'usd' });
  assert.deepEqual(plus.parseShownAmount('2.5 EUR'), { cents: 250, currency: 'eur' });
  assert.equal(plus.parseShownAmount('59 Kč'), null);
  assert.equal(plus.parseShownAmount('99 CZK'), null);
  assert.equal(plus.parseShownAmount('zdarma'), null);
  assert.equal(n(plus.shownPriceFromLabel('59 Kč (2,49 €)', 'en')), '€2.49');
  assert.equal(n(plus.shownPriceFromLabel('59 Kč / měsíc (2,49 €)', 'cs')), '2,49 €');
  assert.equal(n(plus.shownPriceFromLabel('€2.49 ($2.99)', 'en')), '€2.49');
  assert.equal(plus.shownPriceFromLabel('79 Kč / měsíc', 'en'), null, 'jen koruny - nic');
  assert.equal(plus.shownPriceFromLabel(null), null);
});

await test('kontrola v /admin/stripe: eura zelené, koruny k předělání', () => {
  const base = {
    keyMode: 'live', webhookSecretSet: true, paymentsFlag: true, creatorFlag: false, operatorName: true, operatorIco: true,
    account: { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true }, webhook: null, portalDefault: true,
    prices: {
      kine: { id: 'price_eur', problems: [], label: null, sells: { currency: 'eur', eur: 249, usd: 299 } },
      clips: { id: 'price_env', problems: [], label: '79 Kč (3,29 €)', sells: { currency: 'czk', eur: 329, usd: null } },
      all: { id: null, problems: [], label: null, sells: null },
    },
  };
  const by = Object.fromEntries(s.evaluateSetup(base).map((c) => [c.id, c]));
  assert.equal(by['price-kine'].ok, true);
  assert.equal(by['price-kine'].detail, '€2.49 · v USA $2.99 / měsíc');
  assert.equal(by['price-clips'].ok, false, 'koruny = předělat');
  assert.match(by['price-clips'].detail, /Vytvořit ceny ve Stripe/);
  assert.equal(by['price-all'].ok, null, 'bez ceny jen „Brzy“');
  const en = Object.fromEntries(s.evaluateSetup(base, 'en').map((c) => [c.id, c]));
  assert.equal(en['price-kine'].detail, '€2.49 · in the USA $2.99 / month');
  assert.doesNotMatch(en['price-clips'].detail, /[ěščřžýáíéůú]/, 'anglicky bez češtiny');
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
