/**
 * Veřejná adresa webu pro odkazy ven (návrat ze Stripe, portál předplatného,
 * propojení tvůrce se Stripe, webhook ve Stripe).
 *
 * Pořadí: NEXT_PUBLIC_SITE_URL, pak produkční adresa od Vercelu
 * (VERCEL_PROJECT_PRODUCTION_URL). Adresa z požadavku (x-forwarded-host / Host)
 * se použije, jen když je to jedna z adres, které o sobě ví server sám
 * (produkční, nebo adresa tohohle nasazení od Vercelu - náhledová nasazení
 * tak po zaplacení zůstanou na své adrese). Dřív se při chybějící proměnné
 * bralo x-forwarded-host, který si mimo Vercel může poslat kdokoli.
 */

type Env = Record<string, string | undefined>;

/** "https://kine.cz" z hodnoty proměnné (s https:// i bez, bez cesty); null = neplatná. */
function originOf(value: string | undefined, assumeHttps = false): string | null {
  let v = String(value ?? '').trim().replace(/\/+$/, '');
  if (!v) return null;
  if (assumeHttps && !/^https?:\/\//i.test(v)) v = `https://${v}`;
  if (!/^https?:\/\/[^\s/?#]+$/i.test(v)) return null;
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return '';
  }
}

export function siteUrlFrom(req: Request, env: Env = process.env): string {
  const site = originOf(env.NEXT_PUBLIC_SITE_URL);
  if (site) return site;

  const production = originOf(env.VERCEL_PROJECT_PRODUCTION_URL, true);
  // Adresy tohohle nasazení - nastavuje je Vercel, ne klient.
  const trusted = [production, originOf(env.VERCEL_BRANCH_URL, true), originOf(env.VERCEL_URL, true)].filter((o): o is string => !!o);

  let requestHost = '';
  let requestOrigin: string | null = null;
  try {
    const url = new URL(req.url);
    requestOrigin = url.host ? `${url.protocol}//${url.host}` : null;
    requestHost = (req.headers.get('x-forwarded-host') ?? url.host).split(',')[0].trim().toLowerCase();
  } catch {
    // nic - níž výchozí
  }
  const match = trusted.find((o) => hostOf(o) === requestHost);
  if (match) return match;
  if (production) return production;
  // Nic nastaveného (vývoj): adresa požadavku - bez hlaviček, které posílá klient.
  return requestOrigin ?? 'http://localhost:3000';
}
