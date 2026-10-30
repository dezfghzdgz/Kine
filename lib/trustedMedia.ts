/**
 * Obrázky od lidí (profilovky, bannery, obrázky v komentářích a příspěvcích)
 * se ukazují jen z míst, která Kine zná: úložiště Kine (Supabase), náhledy
 * od Cloudflare Stream a GIFy z Giphy. Adresu si člověk může do databáze
 * zapsat sám - kdyby šla libovolná, stačilo by vložit obrázek z vlastního
 * serveru a ten by zjistil IP adresu každého, kdo stránku otevře.
 *
 * Úložiště Kine = jen vlastní projekt Supabase (NEXT_PUBLIC_SUPABASE_URL).
 *
 * Čistá logika (tests/trustedMedia.test.mjs).
 */

function supabaseHost(): string | null {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? new URL(url).host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Další hosty obrázků navíc (NEXT_PUBLIC_EXTRA_IMAGE_HOSTS, čárkou oddělené) -
 * třeba starý projekt Supabase po stěhování, aby staré profilovky nezmizely.
 */
function extraHosts(): string[] {
  return String(process.env.NEXT_PUBLIC_EXTRA_IMAGE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9.-]+$/.test(h));
}

export function isTrustedImageHost(host: string, ownSupabaseHost: string | null = supabaseHost(), extra: readonly string[] = extraHosts()): boolean {
  const h = host.toLowerCase();
  if (ownSupabaseHost && h === ownSupabaseHost) return true;
  if (extra.includes(h)) return true;
  // Jen vlastní projekt Supabase: cizí projekt (zdarma ho má kdokoli) by v logu viděl IP diváků.
  // Bez nastavené adresy (testy, vývoj) jakýkoli *.supabase.co jako dřív.
  if (!ownSupabaseHost && /^[a-z0-9-]+\.supabase\.co$/.test(h)) return true;
  if (/^customer-[a-z0-9]+\.cloudflarestream\.com$/.test(h) || h === 'videodelivery.net' || h === 'imagedelivery.net') return true;
  if (/^media[0-9]*\.giphy\.com$/.test(h) || h === 'i.giphy.com') return true;
  return false;
}

/** Adresa obrázku, když je z důvěryhodného místa (nebo relativní na Kine), jinak null. */
export function trustedImageUrl(url: string | null | undefined, ownSupabaseHost: string | null = supabaseHost()): string | null {
  if (typeof url !== 'string') return null;
  const value = url.trim();
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (value.startsWith('data:image/') || value.startsWith('blob:')) return value;
  try {
    const parsed = new URL(value);
    const host = parsed.host.toLowerCase();
    // Vývoj a testy: vlastní Supabase / localhost i přes http.
    if (parsed.protocol === 'http:') return (ownSupabaseHost && host === ownSupabaseHost) || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? value : null;
    if (parsed.protocol !== 'https:') return null;
    return isTrustedImageHost(host, ownSupabaseHost) ? value : null;
  } catch {
    return null;
  }
}
