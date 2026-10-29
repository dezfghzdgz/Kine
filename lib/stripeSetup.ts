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

/** Co je s cenou špatně (prázdné = v pořádku). */
export function priceProblems(price: PriceInfo | null): string[] {
  if (!price) return ['Cena u Stripe není (špatné ID, nebo je z jiného režimu - testovací / ostrý).'];
  const out: string[] = [];
  if (!price.active) out.push('Cena je u Stripe archivovaná.');
  if (price.productActive === false) out.push('Produkt je u Stripe archivovaný.');
  if (price.interval !== 'month' || (price.intervalCount ?? 1) !== 1) out.push('Cena není měsíční předplatné (Recurring, Monthly).');
  if (!price.unitAmount || price.unitAmount <= 0) out.push('Cena nemá částku.');
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

/** Popisek ceny do NEXT_PUBLIC_PLUS_*_PRICE_LABEL: „49 Kč / měsíc“, s druhou měnou „49 Kč / měsíc (1,99 €)“. */
export function priceLabelFor(main: { unitAmount: number; currency: string }, extra?: { unitAmount: number; currency: string } | null): string {
  const base = `${formatAmount(main.unitAmount, main.currency)} / měsíc`;
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

/** Seznam kontrol pro stránku (pořadí = pořadí kroků v návodu). */
export function evaluateSetup(f: SetupFacts): SetupCheck[] {
  const checks: SetupCheck[] = [];
  checks.push({
    id: 'key',
    ok: f.keyMode === 'test' || f.keyMode === 'live',
    title: f.keyMode === 'live' ? 'Tajný klíč: ostrý (sk_live_…)' : f.keyMode === 'test' ? 'Tajný klíč: testovací (sk_test_…) - platí se jen testovací kartou' : 'Tajný klíč STRIPE_SECRET_KEY',
    detail: f.keyMode === 'missing' ? 'Chybí ve Vercelu (Developers → API keys → Secret key).' : f.keyMode === 'invalid' ? 'Nevypadá jako klíč Stripe (začíná sk_test_ nebo sk_live_).' : undefined,
  });
  checks.push({
    id: 'account',
    ok: f.account ? f.account.chargesEnabled && f.account.payoutsEnabled : f.keyMode === 'test' || f.keyMode === 'live' ? false : null,
    title: 'Účet Stripe aktivní (platby a výplaty)',
    detail: f.accountError
      ? `Stripe: ${f.accountError}`
      : f.account && !(f.account.chargesEnabled && f.account.payoutsEnabled)
        ? 'Dokonči ve Stripe aktivaci účtu (údaje o podnikání, IČO, bankovní účet) - jinak nepřijme platby nebo nepošle peníze.'
        : undefined,
  });
  const payout = (f.payoutCurrencies ?? []).map((c) => c.toLowerCase());
  const converted = payout.length > 0 ? (f.priceCurrencies ?? []).map((c) => c.toLowerCase()).filter((c) => !payout.includes(c)) : [];
  if (converted.length > 0) {
    const up = (list: string[]) => list.map((c) => c.toUpperCase()).join(', ');
    checks.push({
      id: 'currency',
      ok: null,
      title: `Výplaty v ${up(payout)} - platby v ${up(converted)} Stripe převede`,
      detail: `Za převod měny si Stripe bere zhruba 2 %. Bez převodu: přidej ve Stripe bankovní účet i v ${up(converted)} (Settings → Bank accounts and currencies).`,
    });
  }
  checks.push({
    id: 'webhook',
    ok: f.webhook
      ? f.webhook.status === 'enabled' && f.webhook.missing.length === 0 && f.webhook.exact !== false
      : f.keyMode === 'test' || f.keyMode === 'live'
        ? false
        : null,
    title: 'Webhook /api/donate/webhook se všemi událostmi',
    detail: !f.webhook
      ? 'U Stripe není - vytvoř ho tlačítkem níž (nebo Developers → Webhooks).'
      : f.webhook.exact === false
        ? `Webhook vede na ${f.webhook.url}, ale web je na jiné adrese - Stripe přesměrování nenásleduje a platby by se nepropsaly. Oprav tlačítkem níž.`
        : f.webhook.status !== 'enabled'
          ? 'Webhook je vypnutý - zapni ho tlačítkem níž.'
          : f.webhook.missing.length > 0
            ? `Chybí události: ${f.webhook.missing.join(', ')} - doplň tlačítkem níž.`
            : undefined,
  });
  if (f.probe) {
    const st = f.probe.status;
    checks.push({
      id: 'webhook-reachable',
      ok: st === 400 ? true : st === null ? null : false,
      title: 'Adresa webhooku na webu odpovídá',
      detail:
        st === 400
          ? undefined
          : st === null
            ? `Nepodařilo se ověřit${f.probe.error ? ` (${f.probe.error})` : ''}.`
            : st >= 300 && st < 400
              ? `Adresa přesměrovává${f.probe.location ? ` na ${f.probe.location}` : ''} - Stripe přesměrování nenásleduje. Nastav ve Vercelu NEXT_PUBLIC_SITE_URL na hlavní adresu webu, Redeploy a webhook oprav tlačítkem níž.`
              : st === 404
                ? 'Na adrese webhooku nic není (404) - je nahraná poslední verze webu?'
                : `Webhook odpověděl ${st} místo 400 (bez podpisu) - ochrana nasazení ve Vercelu, nebo chyba na webu.`,
    });
  }
  checks.push({
    id: 'webhook-secret',
    ok: f.webhookSecretSet,
    title: 'Podpisový klíč webhooku STRIPE_WEBHOOK_SECRET (whsec_…)',
    detail: f.webhookSecretSet
      ? 'Patří jen k webhooku, u kterého vznikl - po přechodu na ostrý klíč (nový webhook) ho vyměň.'
      : 'Chybí ve Vercelu - bez něj Kine nepozná, že někdo zaplatil.',
  });
  if (f.failedDeliveries) {
    const n = f.failedDeliveries.count;
    const when = f.failedDeliveries.latestAt ? new Date(f.failedDeliveries.latestAt * 1000).toISOString().slice(0, 16).replace('T', ' ') : null;
    checks.push({
      id: 'deliveries',
      ok: n === 0,
      title: n === 0 ? 'Stripe doručuje události webhooku (za poslední týden nic nevisí)' : `Stripe nedoručil ${n} ${n === 1 ? 'událost' : n < 5 ? 'události' : 'událostí'} za poslední týden`,
      detail:
        n === 0
          ? undefined
          : `Poslední: ${f.failedDeliveries.latestType ?? '?'}${when ? ` (${when} UTC)` : ''}. Nejčastěji je STRIPE_WEBHOOK_SECRET z jiného webhooku nebo režimu, nebo adresa přesměrovává. Oprav, Redeploy - Stripe to zkouší znovu až 3 dny; starší pošli znovu ve Stripe (Developers → Webhooks → událost → Resend).`,
    });
  }
  for (const tier of ['kine', 'clips', 'all'] as const) {
    const p = f.prices[tier];
    const name = tier === 'kine' ? 'Kine Plus' : tier === 'clips' ? 'Klipy Plus' : 'Kine Plus + Klipy';
    checks.push({
      id: `price-${tier}`,
      ok: p.id ? p.problems.length === 0 && !!p.label : null,
      title: `Cena ${name}`,
      detail: !p.id ? 'Bez ceny se varianta nedá koupit (ukáže „Brzy“) - vytvoř ceny tlačítkem níž.' : p.problems.length > 0 ? p.problems.join(' ') : !p.label ? 'Chybí popisek ceny (NEXT_PUBLIC_PLUS_…_PRICE_LABEL).' : p.label,
    });
  }
  checks.push({
    id: 'portal',
    ok: f.portalDefault,
    title: 'Zákaznický portál (zrušení a změna předplatného)',
    detail:
      f.portalDefault === false
        ? 'Ve Stripe: Settings → Billing → Customer portal → Save (stačí jednou).'
        : f.portalDefault && f.portalSwitching === false
          ? 'Zrušení a změna karty jdou. Přechod na jinou variantu je vypnutý (zákazník zruší a koupí jinou) - zapnout: Customer portal → Subscriptions → Customers can switch plans + přidat tři produkty Kine.'
          : undefined,
  });
  if (typeof f.storageHours === 'number') {
    const h = f.storageHours;
    const plusH = h * (f.plusMultiplier ?? 3);
    const cost = (hours: number) => Math.round(hours * 60 * CF_STORAGE_KC_PER_MIN);
    checks.push({
      id: 'storage',
      ok: h === 0 ? false : h <= RECOMMENDED_STORAGE_HOURS ? true : null,
      title: h === 0 ? 'Úložiště účtu bez stropu' : `Úložiště účtu ${h} h (Kine Plus ${plusH} h)`,
      detail:
        h === 0
          ? `Bez stropu může jeden účet na Cloudflare stát libovolně moc - nastav ve Vercelu UPLOAD_STORAGE_HOURS=${RECOMMENDED_STORAGE_HOURS}.`
          : h > RECOMMENDED_STORAGE_HOURS
            ? `Plný účet stojí na Cloudflare ~${cost(h)} Kč, s Plus ~${cost(plusH)} Kč měsíčně - víc, než předplatné vynese. Do přechodu na levnější úložiště doporučuju ve Vercelu UPLOAD_STORAGE_HOURS=${RECOMMENDED_STORAGE_HOURS}.`
            : `Plný účet ~${cost(h)} Kč, s Plus ~${cost(plusH)} Kč měsíčně na Cloudflare.`,
    });
  }
  checks.push({
    id: 'operator',
    ok: f.operatorName && f.operatorIco,
    title: 'Provozovatel na webu (jméno, IČO, místo podnikání)',
    detail: f.operatorName && f.operatorIco ? undefined : 'NEXT_PUBLIC_OPERATOR_NAME, NEXT_PUBLIC_OPERATOR_ICO, NEXT_PUBLIC_OPERATOR_ADDRESS - zákon je chce u prodeje vidět.',
  });
  checks.push({
    id: 'payments-flag',
    ok: f.paymentsFlag,
    title: 'Placení zapnuté (NEXT_PUBLIC_PAYMENTS=1)',
    detail: f.paymentsFlag ? (f.creatorFlag ? 'Zapnuté i peníze pro tvůrce (NEXT_PUBLIC_CREATOR_PAYMENTS=1).' : 'Peníze pro tvůrce zatím vypnuté (správně - až s Connect a účetní).') : 'Až bude všechno výš zelené: přidej do Vercelu a Redeploy.',
  });
  return checks;
}
