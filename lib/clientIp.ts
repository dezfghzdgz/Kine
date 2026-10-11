/**
 * IP adresa návštěvníka pro limity (přihlašování, zhlédnutí, oznámení).
 *
 * Na Vercelu ji spolehlivě nastavuje sám Vercel v x-real-ip
 * a x-vercel-forwarded-for - co by poslal klient, přepíše. Hlavičku
 * x-forwarded-for si naopak může klient poslat vlastní a mimo Vercel (jiný
 * hosting, vývoj) by v ní byla jeho vymyšlená hodnota. Proto se bere až
 * jako poslední možnost.
 */
export function clientIp(headers: Headers): string {
  const candidates = [
    headers.get('x-real-ip'),
    headers.get('x-vercel-forwarded-for')?.split(',')[0],
    headers.get('x-forwarded-for')?.split(',')[0],
  ];
  for (const raw of candidates) {
    const ip = (raw ?? '').trim();
    if (ip && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip)) return ip;
  }
  return 'unknown';
}
