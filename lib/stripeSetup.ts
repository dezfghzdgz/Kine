/**
 * Kontrola nastavení Stripe pro Kine (stránka /admin/stripe) - čistá
 * pravidla, ať jdou vyzkoušet bez Stripe (tests/stripeSetup.test.mjs).
 *
 * Co musí sedět, aby se dalo platit:
 *  - tajný klíč ve Vercelu (STRIPE_SECRET_KEY), testovací nebo ostrý,
 *  - webhook na /api/donate/webhook se všemi událostmi a jeho podpisový
 *    klíč (STRIPE_WEBHOOK_SECRET) - bez něj by se o zaplacení Kine nedozvěděla,
 *  - měsíční ceny tří variant (STRIPE_PLUS_*_PRICE_ID) a jejich popisky,
 *  - zapnutý zákaznický portál (zrušení předplatného), účet Stripe aktivní.
 */

export const REQUIRED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.dispute.created',
] as const;

export type KeyMode = 'missing' | 'test' | 'live' | 'invalid';

/** Druh klíče podle začátku: sk_test_ / sk_live_ (i omezené rk_*). Hodnota se nikam neposílá. */
export function keyMode(key: string | null | undefined): KeyMode {
  const k = (key ?? '').trim();
  if (!k) return 'missing';
  if (/^(sk|rk)_test_[A-Za-z0-9]{10,}$/.test(k)) return 'test';
  if (/^(sk|rk)_live_[A-Za-z0-9]{10,}$/.test(k)) return 'live';
  return 'invalid';
}

/** Adresa webhooku Kine (všechny platby jdou jedním webhookem). */
export function webhookUrlFor(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/api/donate/webhook`;
}

/** Je to webhook Kine (stejná cesta; host s/bez www a koncové lomítko nevadí)? */
export function isKineWebhookUrl(url: string | null | undefined, siteUrl: string): boolean {
  if (!url) return false;
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.host.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`;
    } catch {
      return '';
    }
  };
  const want = norm(webhookUrlFor(siteUrl));
  return !!want && norm(url) === want;
}

/**
 * Vede webhook přesně na adresu webu (host i cesta)? Stripe přesměrování
 * nenásleduje - webhook na playkine.com, když web běží na www.playkine.com
 * (a holá doména přesměrovává), by žádnou platbu nedoručil.
 */
export function sameWebhookUrl(url: string | null | undefined, siteUrl: string): boolean {
  if (!url) return false;
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, '')}`;
    } catch {
      return '';
    }
  };
  const want = norm(webhookUrlFor(siteUrl));
  return !!want && norm(url) === want;
}

/** Chyba Stripe „takový objekt tu není“ (např. zákazník z testovacího režimu po přechodu na ostrý klíč). */
export function stripeMissing(e: unknown, param?: string): boolean {
  const err = e as { code?: string; param?: string; statusCode?: number; message?: string; raw?: { code?: string; param?: string } } | null;
  if (!err) return false;
  const missing = err.code === 'resource_missing' || err.raw?.code === 'resource_missing' || /no such /i.test(String(err.message ?? ''));
  if (!missing) return false;
  if (!param) return true;
  const p = err.param ?? err.raw?.param;
  return p ? p === param : new RegExp(`no such ${param}`, 'i').test(String(err.message ?? ''));
}

/** Které potřebné události webhook nemá ('*' = všechny). */
export function missingEvents(enabled: readonly string[] | null | undefined): string[] {
  const list = enabled ?? [];
  if (list.includes('*')) return [];
  return REQUIRED_WEBHOOK_EVENTS.filter((e) => !list.includes(e));
}

export type PriceInfo = {
  id: string;
  active: boolean;
  currency: string;
  unitAmount: number | null;
  interval: string | null;
  intervalCount: number | null;
  productActive: boolean | null;
  currencies?: string[];
};

/** Jazyk textů kontroly (stránka /admin/stripe): čeština pro cs/sk, jinak angličtina. */
export type SetupLang = 'cs' | 'en';

/** Co je s cenou špatně (prázdné = v pořádku). */
export function priceProblems(price: PriceInfo | null, lang: SetupLang = 'cs'): string[] {
  const tx = (cs: string, en: string) => (lang === 'en' ? en : cs);
  if (!price) return [tx('Cena u Stripe není (špatné ID, nebo je z jiného režimu - testovací / ostrý).', 'The price does not exist at Stripe (wrong ID, or it is from the other mode - test / live).')];
  const out: string[] = [];
  if (!price.active) out.push(tx('Cena je u Stripe archivovaná.', 'The price is archived at Stripe.'));
  if (price.productActive === false) out.push(tx('Produkt je u Stripe archivovaný.', 'The product is archived at Stripe.'));
  if (price.interval !== 'month' || (price.intervalCount ?? 1) !== 1) out.push(tx('Cena není měsíční předplatné (Recurring, Monthly).', 'The price is not a monthly subscription (Recurring, Monthly).'));
  if (!price.unitAmount || price.unitAmount <= 0) out.push(tx('Cena nemá částku.', 'The price has no amount.'));
  return out;
}

/** Měny, které Stripe vede v setinách; ostatní (JPY…) celé. Kine potřebuje jen CZK, EUR, USD. */
const ZERO_DECIMAL = new Set(['jpy', 'krw', 'vnd', 'clp', 'pyg', 'ugx', 'xaf', 'xof']);

/** Částka pro lidi: 4900 czk → „49 Kč“, 199 eur → „1,99 €“, 499 usd → „$4.99“. */
export function formatAmount(unitAmount: number, currency: string): string {
  const cur = currency.toLowerCase();
  const value = ZERO_DECIMAL.has(cur) ? unitAmount : unitAmount / 100;
  const whole = Number.isInteger(value);
  const num = (sep: string) => (whole ? String(value) : value.toFixed(2).replace('.', sep));
  if (cur === 'czk') return `${num(',')} Kč`;
  if (cur === 'eur') return `${num(',')} €`;
  if (cur === 'usd') return `$${whole ? value : value.toFixed(2)}`;
  return `${num('.')} ${cur.toUpperCase()}`;
}

/**
 * Popisek ceny do NEXT_PUBLIC_PLUS_*_PRICE_LABEL bez období: „59 Kč“, s druhou
 * měnou „59 Kč (2,49 €)“. Období („/ month“, „/ měsíc“…) doplní stránka /plus
 * v jazyce webu (lib/plus.ts stripPricePeriod ho z případných starších popisků
 * „59 Kč / měsíc (2,49 €)“ sama odebere).
 */
export function priceLabelFor(main: { unitAmount: number; currency: string }, extra?: { unitAmount: number; currency: string } | null): string {
  const base = formatAmount(main.unitAmount, main.currency);
  return extra ? `${base} (${formatAmount(extra.unitAmount, extra.currency)})` : base;
}

/** Částka z formuláře („49“, „1,99“) na setiny; null = nesmysl. Rozumný rozsah 0,50-1000. */
export function parseAmount(input: unknown, currency: string): number | null {
  const s = String(input ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  const value = Number(s);
  const cents = ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(value) : Math.round(value * 100);
  const min = currency.toLowerCase() === 'czk' ? 1500 : 50; // Stripe minimum: ~15 Kč / 0,50 €
  if (cents < min || value > 1000 * (currency.toLowerCase() === 'czk' ? 25 : 1)) return null;
  return cents;
}

export type SetupCheck = { id: string; ok: boolean | null; title: string; detail?: string };

export type SetupFacts = {
  keyMode: KeyMode;
  webhookSecretSet: boolean;
  paymentsFlag: boolean;
  creatorFlag: boolean;
  operatorName: boolean;
  operatorIco: boolean;
  account: { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean } | null;
  accountError?: string | null;
  /** Měny, ve kterých Stripe vyplácí (bankovní účty), malými písmeny. */
  payoutCurrencies?: string[];
  /** Měny cen předplatného (hlavní i další), malými písmeny. */
  priceCurrencies?: string[];
  webhook: { url: string; status: string; missing: string[]; exact?: boolean } | null;
  /** Zkušební POST na adresu webhooku (bez podpisu - čeká se 400 „Chybí podpis.“). */
  probe?: { status: number | null; location?: string | null; error?: string | null } | null;
  /** Události, které Stripe za poslední týden nedoručil (null = nevíme). */
  failedDeliveries?: { count: number; latestType: string | null; latestAt: number | null } | null;
  prices: Record<'kine' | 'clips' | 'all', { id: string | null; problems: string[]; label: string | null }>;
  portalDefault: boolean | null;
  /** Smí zákazník v portálu přejít na jinou variantu? (null = nevíme) */
  portalSwitching?: boolean | null;
  /** Úložiště běžného účtu v hodinách (UPLOAD_STORAGE_HOURS, 0 = bez stropu) a násobek pro Kine Plus. */
  storageHours?: number | null;
  plusMultiplier?: number;
};

/** Cloudflare Stream: $5 za 1 000 uložených minut měsíčně, při ~21 Kč/$ asi 0,106 Kč za minutu. */
export const CF_STORAGE_KC_PER_MIN = 0.106;
/** Do přechodu na levnější úložiště videí doporučené úložiště účtu (h). */
export const RECOMMENDED_STORAGE_HOURS = 5;

/** „59 Kč (2,49 €)“ + „/ month“ -> „59 Kč / month (2,49 €)“. */
function withPeriod(label: string, per: string): string {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(label);
  return m && m[1].trim() ? `${m[1].trim()} ${per} (${m[2].trim()})` : `${label} ${per}`;
}

/** Seznam kontrol pro stránku (pořadí = pořadí kroků v návodu). Texty česky, nebo anglicky (lang 'en'). */
export function evaluateSetup(f: SetupFacts, lang: SetupLang = 'cs'): SetupCheck[] {
  const tx = (cs: string, en: string) => (lang === 'en' ? en : cs);
  const keyOk = f.keyMode === 'test' || f.keyMode === 'live';
  const checks: SetupCheck[] = [];
  checks.push({
    id: 'key',
    ok: keyOk,
    title:
      f.keyMode === 'live'
        ? tx('Tajný klíč: ostrý (sk_live_…)', 'Secret key: live (sk_live_…)')
        : f.keyMode === 'test'
          ? tx('Tajný klíč: testovací (sk_test_…) - platí se jen testovací kartou', 'Secret key: test (sk_test_…) - only test cards work')
          : tx('Tajný klíč STRIPE_SECRET_KEY', 'Secret key STRIPE_SECRET_KEY'),
    detail:
      f.keyMode === 'missing'
        ? tx('Chybí ve Vercelu (Developers → API keys → Secret key).', 'Missing in Vercel (Developers → API keys → Secret key).')
        : f.keyMode === 'invalid'
          ? tx('Nevypadá jako klíč Stripe (začíná sk_test_ nebo sk_live_).', 'Does not look like a Stripe key (starts with sk_test_ or sk_live_).')
          : undefined,
  });
  checks.push({
    id: 'account',
    ok: f.account ? f.account.chargesEnabled && f.account.payoutsEnabled : keyOk ? false : null,
    title: tx('Účet Stripe aktivní (platby a výplaty)', 'Stripe account active (payments and payouts)'),
    detail: f.accountError
      ? `Stripe: ${f.accountError}`
      : f.account && !(f.account.chargesEnabled && f.account.payoutsEnabled)
        ? tx(
            'Dokonči ve Stripe aktivaci účtu (údaje o podnikání, IČO, bankovní účet) - jinak nepřijme platby nebo nepošle peníze.',
            'Finish activating the Stripe account (business details, company ID, bank account) - otherwise it cannot take payments or pay out.'
          )
        : undefined,
  });
  const payout = (f.payoutCurrencies ?? []).map((c) => c.toLowerCase());
  const converted = payout.length > 0 ? (f.priceCurrencies ?? []).map((c) => c.toLowerCase()).filter((c) => !payout.includes(c)) : [];
  if (converted.length > 0) {
    const up = (list: string[]) => list.map((c) => c.toUpperCase()).join(', ');
    checks.push({
      id: 'currency',
      ok: null,
      title: tx(`Výplaty v ${up(payout)} - platby v ${up(converted)} Stripe převede`, `Payouts in ${up(payout)} - Stripe converts payments in ${up(converted)}`),
      detail: tx(
        `Za převod měny si Stripe bere zhruba 2 %. Bez převodu: přidej ve Stripe bankovní účet i v ${up(converted)} (Settings → Linked accounts and payouts).`,
        `Stripe charges about 2% for currency conversion. To avoid it, add a bank account in ${up(converted)} too (Settings → Linked accounts and payouts).`
      ),
    });
  }
  checks.push({
    id: 'webhook',
    ok: f.webhook ? f.webhook.status === 'enabled' && f.webhook.missing.length === 0 && f.webhook.exact !== false : keyOk ? false : null,
    title: tx('Webhook /api/donate/webhook se všemi událostmi', 'Webhook /api/donate/webhook with all events'),
    detail: !f.webhook
      ? tx('U Stripe není - vytvoř ho tlačítkem níž (nebo Workbench → Webhooks).', 'Not at Stripe yet - create it with the button below (or Workbench → Webhooks).')
      : f.webhook.exact === false
        ? tx(
            `Webhook vede na ${f.webhook.url}, ale web je na jiné adrese - Stripe přesměrování nenásleduje a platby by se nepropsaly. Oprav tlačítkem níž.`,
            `The webhook points to ${f.webhook.url}, but the site runs on a different address - Stripe does not follow redirects, so payments would not show up. Fix it with the button below.`
          )
        : f.webhook.status !== 'enabled'
          ? tx('Webhook je vypnutý - zapni ho tlačítkem níž.', 'The webhook is disabled - enable it with the button below.')
          : f.webhook.missing.length > 0
            ? tx(`Chybí události: ${f.webhook.missing.join(', ')} - doplň tlačítkem níž.`, `Missing events: ${f.webhook.missing.join(', ')} - add them with the button below.`)
            : undefined,
  });
  if (f.probe) {
    const st = f.probe.status;
    checks.push({
      id: 'webhook-reachable',
      ok: st === 400 ? true : st === null ? null : false,
      title: tx('Adresa webhooku na webu odpovídá', 'The webhook address answers on the site'),
      detail:
        st === 400
          ? undefined
          : st === null
            ? tx(`Nepodařilo se ověřit${f.probe.error ? ` (${f.probe.error})` : ''}.`, `Could not check it${f.probe.error ? ` (${f.probe.error})` : ''}.`)
            : st >= 300 && st < 400
              ? tx(
                  `Adresa přesměrovává${f.probe.location ? ` na ${f.probe.location}` : ''} - Stripe přesměrování nenásleduje. Nastav ve Vercelu NEXT_PUBLIC_SITE_URL na hlavní adresu webu, Redeploy a webhook oprav tlačítkem níž.`,
                  `The address redirects${f.probe.location ? ` to ${f.probe.location}` : ''} - Stripe does not follow redirects. Set NEXT_PUBLIC_SITE_URL in Vercel to the main site address, Redeploy and fix the webhook with the button below.`
                )
              : st === 404
                ? tx('Na adrese webhooku nic není (404) - je nahraná poslední verze webu?', 'Nothing at the webhook address (404) - is the latest version of the site deployed?')
                : tx(`Webhook odpověděl ${st} místo 400 (bez podpisu) - ochrana nasazení ve Vercelu, nebo chyba na webu.`, `The webhook answered ${st} instead of 400 (no signature) - Vercel deployment protection, or an error on the site.`),
    });
  }
  checks.push({
    id: 'webhook-secret',
    ok: f.webhookSecretSet,
    title: tx('Podpisový klíč webhooku STRIPE_WEBHOOK_SECRET (whsec_…)', 'Webhook signing secret STRIPE_WEBHOOK_SECRET (whsec_…)'),
    detail: f.webhookSecretSet
      ? tx('Patří jen k webhooku, u kterého vznikl - k novému webhooku patří nový klíč.', 'It belongs only to the webhook it was created with - a new webhook has a new secret.')
      : tx(
          'Chybí ve Vercelu (nebo je neúplný) - bez něj Kine nepozná, že někdo zaplatil. Najdeš ho ve Stripe: Workbench → Webhooks → webhook → Reveal secret.',
          'Missing in Vercel (or incomplete) - without it Kine cannot tell that someone paid. Find it at Stripe: Workbench → Webhooks → webhook → Reveal secret.'
        ),
  });
  if (f.failedDeliveries) {
    const n = f.failedDeliveries.count;
    const when = f.failedDeliveries.latestAt ? new Date(f.failedDeliveries.latestAt * 1000).toISOString().slice(0, 16).replace('T', ' ') : null;
    checks.push({
      id: 'deliveries',
      ok: n === 0,
      title:
        n === 0
          ? tx('Stripe doručuje události webhooku (za poslední týden nic nevisí)', 'Stripe delivers webhook events (nothing stuck in the last week)')
          : tx(`Stripe nedoručil ${n} ${n === 1 ? 'událost' : n < 5 ? 'události' : 'událostí'} za poslední týden`, `Stripe could not deliver ${n} ${n === 1 ? 'event' : 'events'} in the last week`),
      detail:
        n === 0
          ? undefined
          : tx(
              `Poslední: ${f.failedDeliveries.latestType ?? '?'}${when ? ` (${when} UTC)` : ''}. Nejčastěji je STRIPE_WEBHOOK_SECRET z jiného webhooku nebo režimu, nebo adresa přesměrovává. Oprav, Redeploy - Stripe to zkouší znovu až 3 dny; starší pošli znovu ve Stripe (Workbench → Webhooks → událost → Resend).`,
              `Latest: ${f.failedDeliveries.latestType ?? '?'}${when ? ` (${when} UTC)` : ''}. Usually STRIPE_WEBHOOK_SECRET is from another webhook or mode, or the address redirects. Fix it and Redeploy - Stripe retries for up to 3 days; resend older ones at Stripe (Workbench → Webhooks → event → Resend).`
            ),
    });
  }
  for (const tier of ['kine', 'clips', 'all'] as const) {
    const p = f.prices[tier];
    const name = tier === 'kine' ? 'Kine Plus' : tier === 'clips' ? tx('Klipy Plus', 'Clips Plus') : tx('Kine Plus + Klipy', 'Kine Plus + Clips');
    checks.push({
      id: `price-${tier}`,
      ok: p.id ? p.problems.length === 0 && !!p.label : null,
      title: tx(`Cena ${name}`, `Price ${name}`),
      detail: !p.id
        ? tx('Bez ceny se varianta nedá koupit (ukáže „Brzy“) - vytvoř ceny tlačítkem níž.', 'Without a price this plan cannot be bought (shows “Soon”) - create the prices with the button below.')
        : p.problems.length > 0
          ? p.problems.join(' ')
          : !p.label
            ? tx('Chybí popisek ceny (NEXT_PUBLIC_PLUS_…_PRICE_LABEL).', 'The price label is missing (NEXT_PUBLIC_PLUS_…_PRICE_LABEL).')
            : withPeriod(p.label, tx('/ měsíc', '/ month')),
    });
  }
  checks.push({
    id: 'portal',
    ok: f.portalDefault,
    title: tx('Zákaznický portál (zrušení a změna předplatného)', 'Customer portal (cancel and change the subscription)'),
    detail:
      f.portalDefault === false
        ? tx('Ve Stripe: Settings → Billing → Customer portal → Save (stačí jednou).', 'At Stripe: Settings → Billing → Customer portal → Save (once is enough).')
        : f.portalDefault && f.portalSwitching === false
          ? tx(
              'Zrušení a změna karty jdou. Přechod na jinou variantu je vypnutý (zákazník zruší a koupí jinou) - zapnout: Customer portal → Subscriptions → Customers can switch plans + přidat tři produkty Kine.',
              'Cancelling and changing the card work. Switching plans is off (customers cancel and buy another) - to turn it on: Customer portal → Subscriptions → Customers can switch plans + add the three Kine products.'
            )
          : undefined,
  });
  if (typeof f.storageHours === 'number') {
    const h = f.storageHours;
    const plusH = h * (f.plusMultiplier ?? 3);
    const cost = (hours: number) => Math.round(hours * 60 * CF_STORAGE_KC_PER_MIN);
    checks.push({
      id: 'storage',
      ok: h === 0 ? false : h <= RECOMMENDED_STORAGE_HOURS ? true : null,
      title: h === 0 ? tx('Úložiště účtu bez stropu', 'Account storage without a limit') : tx(`Úložiště účtu ${h} h (Kine Plus ${plusH} h)`, `Account storage ${h} h (Kine Plus ${plusH} h)`),
      detail:
        h === 0
          ? tx(
              `Bez stropu může jeden účet na Cloudflare stát libovolně moc - nastav ve Vercelu UPLOAD_STORAGE_HOURS=${RECOMMENDED_STORAGE_HOURS}.`,
              `Without a limit one account can cost any amount at Cloudflare - set UPLOAD_STORAGE_HOURS=${RECOMMENDED_STORAGE_HOURS} in Vercel.`
            )
          : h > RECOMMENDED_STORAGE_HOURS
            ? tx(
                `Plný účet stojí na Cloudflare ~${cost(h)} Kč, s Plus ~${cost(plusH)} Kč měsíčně - víc, než předplatné vynese. Do přechodu na levnější úložiště doporučuju ve Vercelu UPLOAD_STORAGE_HOURS=${RECOMMENDED_STORAGE_HOURS}.`,
                `A full account costs ~${cost(h)} CZK at Cloudflare, ~${cost(plusH)} CZK with Plus per month - more than a subscription brings in. Until cheaper video storage, set UPLOAD_STORAGE_HOURS=${RECOMMENDED_STORAGE_HOURS} in Vercel.`
              )
            : tx(`Plný účet ~${cost(h)} Kč, s Plus ~${cost(plusH)} Kč měsíčně na Cloudflare.`, `A full account ~${cost(h)} CZK, with Plus ~${cost(plusH)} CZK per month at Cloudflare.`),
    });
  }
  checks.push({
    id: 'operator',
    ok: f.operatorName && f.operatorIco,
    title: tx('Provozovatel na webu (jméno, IČO, místo podnikání)', 'Operator on the site (name, company ID, registered address)'),
    detail:
      f.operatorName && f.operatorIco
        ? undefined
        : tx(
            'NEXT_PUBLIC_OPERATOR_NAME, NEXT_PUBLIC_OPERATOR_ICO, NEXT_PUBLIC_OPERATOR_ADDRESS - zákon je chce u prodeje vidět.',
            'NEXT_PUBLIC_OPERATOR_NAME, NEXT_PUBLIC_OPERATOR_ICO, NEXT_PUBLIC_OPERATOR_ADDRESS - the law requires them where you sell.'
          ),
  });
  checks.push({
    id: 'payments-flag',
    ok: f.paymentsFlag,
    title: tx('Placení zapnuté (NEXT_PUBLIC_PAYMENTS=1)', 'Payments enabled (NEXT_PUBLIC_PAYMENTS=1)'),
    detail: f.paymentsFlag
      ? f.creatorFlag
        ? tx('Zapnuté i peníze pro tvůrce (NEXT_PUBLIC_CREATOR_PAYMENTS=1).', 'Creator payments are on too (NEXT_PUBLIC_CREATOR_PAYMENTS=1).')
        : tx('Peníze pro tvůrce zatím vypnuté (správně - až s Connect a účetní).', 'Creator payments are still off (as intended - later, with Connect and an accountant).')
      : tx('Až bude všechno výš zelené: přidej do Vercelu a Redeploy.', 'Once everything above is green: add it in Vercel and Redeploy.'),
  });
  return checks;
}
