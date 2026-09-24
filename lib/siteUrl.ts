/**
 * Veřejná adresa webu pro odkazy ven (návrat ze Stripe, portál předplatného,
 * propojení tvůrce se Stripe). Bere se NEXT_PUBLIC_SITE_URL; když na Vercelu
 * chybí, adresa, na kterou přišel požadavek - dřív se v tom případě posílalo
 * na http://localhost:3000 a zákazník po zaplacení skončil na neexistující
 * stránce.
 */
export function siteUrlFrom(req: Request): string {
  const env = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s/]+$/i.test(env)) return env;
  try {
    const url = new URL(req.url);
    const host = req.headers.get('x-forwarded-host') ?? url.host;
    const proto = (req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')).split(',')[0].trim();
    if (host) return `${proto === 'http' ? 'http' : 'https'}://${host}`;
  } catch {
    // nic - níž výchozí
  }
  return 'http://localhost:3000';
}
