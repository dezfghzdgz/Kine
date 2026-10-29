/**
 * Test kontroly nastavení Stripe (lib/stripeSetup.ts) - stránka /admin/stripe.
 *
 * Spustit:  node tests/stripeSetup.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/stripeSetup.ts');
const s = await import(join(kam, 'stripeSetup.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('druh klíče podle začátku', () => {
  // Vymyšlené klíče skládané za běhu - v repu nesmí být nic, co vypadá jako skutečný klíč.
  const fake = (prefix) => `${prefix}_${'x'.repeat(4)}${'Y1'.repeat(8)}`;
  assert.equal(s.keyMode(''), 'missing');
  assert.equal(s.keyMode(undefined), 'missing');
  assert.equal(s.keyMode(fake('sk_test')), 'test');
  assert.equal(s.keyMode(` ${fake('sk_live')} `), 'live');
  assert.equal(s.keyMode(fake('rk_live')), 'live');
  assert.equal(s.keyMode(fake('pk_test')), 'invalid', 'veřejný klíč není tajný');
  assert.equal(s.keyMode('sk_test_short'), 'invalid');
  assert.equal(s.keyMode(fake('whsec')), 'invalid');
});

test('adresa webhooku a poznání toho našeho', () => {
  assert.equal(s.webhookUrlFor('https://www.playkine.com/'), 'https://www.playkine.com/api/donate/webhook');
  assert.equal(s.isKineWebhookUrl('https://www.playkine.com/api/donate/webhook', 'https://www.playkine.com'), true);
  assert.equal(s.isKineWebhookUrl('https://playkine.com/api/donate/webhook/', 'https://www.playkine.com'), true, 'bez www a s lomítkem');
  assert.equal(s.isKineWebhookUrl('https://www.playkine.com/api/other', 'https://www.playkine.com'), false);
  assert.equal(s.isKineWebhookUrl('https://jiny-web.cz/api/donate/webhook', 'https://www.playkine.com'), false);
  assert.equal(s.isKineWebhookUrl(null, 'https://www.playkine.com'), false);
  assert.equal(s.isKineWebhookUrl('nesmysl', 'https://www.playkine.com'), false);
});

test('webhook přesně na adresu webu (Stripe nenásleduje přesměrování)', () => {
  assert.equal(s.sameWebhookUrl('https://www.playkine.com/api/donate/webhook', 'https://www.playkine.com'), true);
  assert.equal(s.sameWebhookUrl('https://WWW.playkine.com/api/donate/webhook/', 'https://www.playkine.com/'), true);
  assert.equal(s.sameWebhookUrl('https://playkine.com/api/donate/webhook', 'https://www.playkine.com'), false, 'bez www není totéž');
  assert.equal(s.sameWebhookUrl('http://www.playkine.com/api/donate/webhook', 'https://www.playkine.com'), false);
  assert.equal(s.sameWebhookUrl(null, 'https://www.playkine.com'), false);
});

test('chyba Stripe „není“ (zákazník z testovacího režimu)', () => {
  const zakaznik = { type: 'StripeInvalidRequestError', code: 'resource_missing', param: 'customer', statusCode: 400, message: "No such customer: 'cus_1'; a similar object exists in test mode, but a live mode key was used to make this request." };
  assert.equal(s.stripeMissing(zakaznik), true);
  assert.equal(s.stripeMissing(zakaznik, 'customer'), true);
  assert.equal(s.stripeMissing({ ...zakaznik, param: 'line_items[0][price]', message: "No such price: 'price_1'" }, 'customer'), false, 'chybějící cena není chybějící zákazník');
  assert.equal(s.stripeMissing({ raw: { code: 'resource_missing', param: 'customer' } }, 'customer'), true);
  assert.equal(s.stripeMissing({ message: "No such customer: 'cus_2'" }, 'customer'), true);
  assert.equal(s.stripeMissing({ code: 'card_declined', message: 'Your card was declined.' }), false);
  assert.equal(s.stripeMissing(new Error('ETIMEDOUT')), false, 'výpadek sítě není „není“');
  assert.equal(s.stripeMissing(null), false);
});

test('chybějící události webhooku', () => {
  assert.deepEqual(s.missingEvents(['*']), []);
  assert.deepEqual(s.missingEvents([...s.REQUIRED_WEBHOOK_EVENTS]), []);
  assert.equal(s.missingEvents(null).length, s.REQUIRED_WEBHOOK_EVENTS.length);
  const chybi = s.missingEvents(['checkout.session.completed', 'invoice.paid']);
  assert.ok(!chybi.includes('checkout.session.completed'));
  assert.ok(chybi.includes('customer.subscription.deleted'));
  assert.ok(chybi.includes('charge.dispute.created'));
});

test('kontrola ceny', () => {
  const ok = { id: 'price_1', active: true, currency: 'czk', unitAmount: 4900, interval: 'month', intervalCount: 1, productActive: true };
  assert.deepEqual(s.priceProblems(ok), []);
  assert.equal(s.priceProblems(null).length, 1);
  assert.equal(s.priceProblems({ ...ok, active: false }).length, 1);
  assert.equal(s.priceProblems({ ...ok, productActive: false }).length, 1);
  assert.equal(s.priceProblems({ ...ok, interval: 'year' }).length, 1, 'roční cena není měsíční');
  assert.equal(s.priceProblems({ ...ok, intervalCount: 3 }).length, 1);
  assert.equal(s.priceProblems({ ...ok, interval: null }).length, 1, 'jednorázová cena');
  assert.equal(s.priceProblems({ ...ok, unitAmount: null }).length, 1);
});

test('částky pro lidi a popisek ceny', () => {
  assert.equal(s.formatAmount(4900, 'czk'), '49 Kč');
  assert.equal(s.formatAmount(4950, 'CZK'), '49,50 Kč');
  assert.equal(s.formatAmount(199, 'eur'), '1,99 €');
  assert.equal(s.formatAmount(300, 'eur'), '3 €');
  assert.equal(s.formatAmount(499, 'usd'), '$4.99');
  assert.equal(s.formatAmount(500, 'usd'), '$5');
  assert.equal(s.formatAmount(1000, 'jpy'), '1000 JPY');
  // Bez období - „/ month“ / „/ měsíc“ doplní stránka /plus v jazyce webu.
  assert.equal(s.priceLabelFor({ unitAmount: 5900, currency: 'czk' }), '59 Kč');
  assert.equal(s.priceLabelFor({ unitAmount: 5900, currency: 'czk' }, { unitAmount: 249, currency: 'eur' }), '59 Kč (2,49 €)');
});

test('částka z formuláře', () => {
  assert.equal(s.parseAmount('49', 'czk'), 4900);
  assert.equal(s.parseAmount(' 49 ', 'czk'), 4900);
  assert.equal(s.parseAmount('49,50', 'czk'), 4950);
  assert.equal(s.parseAmount('1 000', 'czk'), 100000);
  assert.equal(s.parseAmount('1,99', 'eur'), 199);
  assert.equal(s.parseAmount('1.99', 'eur'), 199);
  assert.equal(s.parseAmount(79, 'czk'), 7900);
  assert.equal(s.parseAmount('10', 'czk'), null, 'pod minimem Stripe');
  assert.equal(s.parseAmount('0,40', 'eur'), null);
  assert.equal(s.parseAmount('30000', 'czk'), null, 'nesmyslně vysoko');
  assert.equal(s.parseAmount('1001', 'eur'), null);
  assert.equal(s.parseAmount('abc', 'czk'), null);
  assert.equal(s.parseAmount('', 'czk'), null);
  assert.equal(s.parseAmount('-49', 'czk'), null);
  assert.equal(s.parseAmount('4,999', 'eur'), null, 'víc než setiny');
});

const hotovo = {
  keyMode: 'live',
  webhookSecretSet: true,
  paymentsFlag: true,
  creatorFlag: false,
  operatorName: true,
  operatorIco: true,
  account: { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true },
  accountError: null,
  payoutCurrencies: ['czk', 'eur'],
  priceCurrencies: ['czk', 'eur'],
  webhook: { url: 'https://www.playkine.com/api/donate/webhook', status: 'enabled', missing: [], exact: true },
  probe: { status: 400, location: null, error: null },
  failedDeliveries: { count: 0, latestType: null, latestAt: null },
  portalSwitching: true,
  storageHours: 5,
  plusMultiplier: 3,
  prices: {
    kine: { id: 'price_k', problems: [], label: '49 Kč' },
    clips: { id: 'price_c', problems: [], label: '79 Kč' },
    all: { id: 'price_a', problems: [], label: '99 Kč' },
  },
  portalDefault: true,
};

test('všechno nastavené = všechno zelené', () => {
  const checks = s.evaluateSetup(hotovo);
  assert.ok(checks.length >= 9);
  for (const c of checks) assert.equal(c.ok, true, `${c.id}: ${c.title}`);
  assert.ok(!checks.some((c) => c.id === 'currency'), 'výplaty v obou měnách - bez upozornění');
});

test('bez klíče: klíč chybí, o účtu a webhooku nevíme', () => {
  const checks = s.evaluateSetup({ ...hotovo, keyMode: 'missing', account: null, webhook: null, portalDefault: null, paymentsFlag: false });
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(by.key.ok, false);
  assert.equal(by.account.ok, null);
  assert.equal(by.webhook.ok, null);
  assert.equal(by.portal.ok, null);
  assert.equal(by['payments-flag'].ok, false);
});

test('chyby nastavení se ukážou', () => {
  const checks = s.evaluateSetup({
    ...hotovo,
    keyMode: 'test',
    webhookSecretSet: false,
    operatorIco: false,
    account: { chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true },
    webhook: { url: 'x', status: 'enabled', missing: ['charge.dispute.created'] },
    prices: { ...hotovo.prices, clips: { id: null, problems: [], label: null }, all: { id: 'price_a', problems: ['Cena je u Stripe archivovaná.'], label: '99 Kč' } },
    portalDefault: false,
  });
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(by.key.ok, true);
  assert.match(by.key.title, /testovací/);
  assert.equal(by.account.ok, false);
  assert.equal(by.webhook.ok, false);
  assert.match(by.webhook.detail, /charge\.dispute\.created/);
  assert.equal(by['webhook-secret'].ok, false);
  assert.equal(by['price-clips'].ok, null, 'bez ceny varianta jen „Brzy“');
  assert.equal(by['price-all'].ok, false);
  assert.equal(by.portal.ok, false);
  assert.equal(by.operator.ok, false);
});

test('webhook: jiná adresa, přesměrování, nedoručené události', () => {
  let by = Object.fromEntries(s.evaluateSetup({ ...hotovo, webhook: { ...hotovo.webhook, url: 'https://playkine.com/api/donate/webhook', exact: false } }).map((c) => [c.id, c]));
  assert.equal(by.webhook.ok, false);
  assert.match(by.webhook.detail, /přesměrování/);
  by = Object.fromEntries(s.evaluateSetup({ ...hotovo, probe: { status: 308, location: 'https://www.playkine.com/api/donate/webhook' } }).map((c) => [c.id, c]));
  assert.equal(by['webhook-reachable'].ok, false);
  assert.match(by['webhook-reachable'].detail, /NEXT_PUBLIC_SITE_URL/);
  by = Object.fromEntries(s.evaluateSetup({ ...hotovo, probe: { status: 404 } }).map((c) => [c.id, c]));
  assert.equal(by['webhook-reachable'].ok, false);
  by = Object.fromEntries(s.evaluateSetup({ ...hotovo, probe: { status: null, error: 'timeout' } }).map((c) => [c.id, c]));
  assert.equal(by['webhook-reachable'].ok, null, 'neověřeno není chyba');
  by = Object.fromEntries(s.evaluateSetup({ ...hotovo, failedDeliveries: { count: 3, latestType: 'checkout.session.completed', latestAt: 1793000000 } }).map((c) => [c.id, c]));
  assert.equal(by.deliveries.ok, false);
  assert.match(by.deliveries.title, /3 události/);
  assert.match(by.deliveries.detail, /checkout\.session\.completed/);
  assert.ok(!s.evaluateSetup({ ...hotovo, probe: null, failedDeliveries: null }).some((c) => c.id === 'deliveries' || c.id === 'webhook-reachable'), 'bez údajů se neukazují');
  by = Object.fromEntries(s.evaluateSetup({ ...hotovo, portalSwitching: false }).map((c) => [c.id, c]));
  assert.equal(by.portal.ok, true);
  assert.match(by.portal.detail, /switch plans/);
});

test('úložiště účtu: cena plného účtu na Cloudflare a doporučení', () => {
  let c = s.evaluateSetup({ ...hotovo, storageHours: 30 }).find((x) => x.id === 'storage');
  assert.equal(c.ok, null, 'jen upozornění, neblokuje');
  assert.equal(c.title, 'Úložiště účtu 30 h (Kine Plus 90 h)');
  assert.match(c.detail, /~191 Kč, s Plus ~572 Kč/);
  assert.match(c.detail, /UPLOAD_STORAGE_HOURS=5/);
  c = s.evaluateSetup({ ...hotovo, storageHours: 5 }).find((x) => x.id === 'storage');
  assert.equal(c.ok, true);
  assert.equal(c.title, 'Úložiště účtu 5 h (Kine Plus 15 h)');
  c = s.evaluateSetup({ ...hotovo, storageHours: 0 }).find((x) => x.id === 'storage');
  assert.equal(c.ok, false, 'bez stropu je riziko');
  assert.ok(!s.evaluateSetup({ ...hotovo, storageHours: undefined }).some((x) => x.id === 'storage'));
});

test('anglicky pro web v jiném jazyce než cs/sk', () => {
  const by = Object.fromEntries(s.evaluateSetup({ ...hotovo, keyMode: 'test', webhookSecretSet: false, storageHours: 30, payoutCurrencies: ['eur'], priceCurrencies: ['czk'] }, 'en').map((c) => [c.id, c]));
  assert.equal(by.key.title, 'Secret key: test (sk_test_…) - only test cards work');
  assert.match(by['webhook-secret'].detail, /Reveal secret/);
  assert.match(by.storage.detail, /~191 CZK at Cloudflare, ~572 CZK with Plus/);
  assert.match(by.currency.title, /^Payouts in EUR - Stripe converts payments in CZK$/);
  assert.equal(by['price-clips'].title, 'Price Clips Plus');
  assert.equal(by['price-kine'].detail, '49 Kč / month', 'cena s obdobím v angličtině');
  assert.ok(!JSON.stringify(Object.values(by)).replace(/Kč/g, '').match(/[ěščřžýáíéůúňťď]/), 'žádná čeština (kromě měny Kč)');
  assert.deepEqual(s.priceProblems(null, 'en'), ['The price does not exist at Stripe (wrong ID, or it is from the other mode - test / live).']);
  assert.equal(Object.fromEntries(s.evaluateSetup({ ...hotovo, prices: { ...hotovo.prices, kine: { id: 'p', problems: [], label: '59 Kč (2,49 €)' } } }).map((c) => [c.id, c]))['price-kine'].detail, '59 Kč / měsíc (2,49 €)');
});

test('výplaty v jiné měně než ceny - upozornění na převod', () => {
  const checks = s.evaluateSetup({ ...hotovo, payoutCurrencies: ['eur'], priceCurrencies: ['czk', 'eur'] });
  const c = checks.find((x) => x.id === 'currency');
  assert.ok(c, 'upozornění je');
  assert.equal(c.ok, null, 'jen informace, neblokuje');
  assert.match(c.title, /CZK/);
  assert.ok(!s.evaluateSetup({ ...hotovo, payoutCurrencies: [], priceCurrencies: ['czk'] }).some((x) => x.id === 'currency'), 'neznámé výplaty - nic');
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
process.exit(padly ? 1 : 0);
