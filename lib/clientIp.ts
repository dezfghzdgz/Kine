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

/** IPv6 adresa na 8 čísel (0-65535); null = nesmysl. Umí "::" i IPv4 na konci (::ffff:1.2.3.4). */
function ipv6Groups(ip: string): number[] | null {
  let s = ip;
  let tail: number[] = [];
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const p = v4.slice(1).map(Number);
    if (p.some((n) => n > 255)) return null;
    tail = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
    s = s.slice(0, s.length - v4[0].length);
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const num = (h: string) => (/^[0-9a-f]{1,4}$/i.test(h) ? parseInt(h, 16) : NaN);
  const head = parts[0] ? parts[0].split(':').map(num) : [];
  let groups: number[];
  if (parts.length === 1) {
    groups = [...head, ...tail];
    if (groups.length !== 8) return null;
  } else {
    const rest = parts[1] ? parts[1].split(':').map(num) : [];
    const fill = 8 - head.length - rest.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest, ...tail];
  }
  return groups.every((n) => Number.isFinite(n)) ? groups : null;
}

/**
 * Klíč do limitů podle adresy: IPv4 celá, IPv6 jen síť /64. Jeden domácí
 * připojení (i levný server) dostane od poskytovatele celou /64 - adres
 * v ní je 2^64 a s každou novou by šlo limit (zhlédnutí, pokusy) obejít.
 * IPv4 zabalená v IPv6 (::ffff:1.2.3.4) se bere jako obyčejná IPv4.
 */
export function ipBucket(ip: string): string {
  const raw = String(ip ?? '').trim().toLowerCase();
  if (!raw) return 'unknown';
  if (!raw.includes(':')) return raw;
  const g = ipv6Groups(raw);
  if (!g) return raw;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  }
  return `${g.slice(0, 4).map((n) => n.toString(16)).join(':')}::/64`;
}

/** IP návštěvníka rovnou jako klíč do limitů (lib/clientIp.ts - ipBucket). */
export function clientIpKey(headers: Headers): string {
  return ipBucket(clientIp(headers));
}
