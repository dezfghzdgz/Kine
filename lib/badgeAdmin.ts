import { supabaseServer } from './supabaseServer';

/**
 * Kdo smí spravovat odznaky (/admin/badges): tým Kine - moderátor nebo
 * správce (role, nebo is_admin). `admin` = správce (jen ten přiděluje
 * odznak Majitel Kine). null = nesmí.
 */
export async function requireBadgeStaff(req: Request): Promise<{ id: string; admin: boolean } | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return null;
  const { data: profile } = await supabaseServer.from('profiles').select('is_admin, role').eq('id', userData.user.id).maybeSingle();
  const p = profile as { is_admin?: boolean | null; role?: string | null } | null;
  const admin = p?.is_admin === true || p?.role === 'admin';
  const staff = admin || p?.role === 'moderator';
  return staff ? { id: userData.user.id, admin } : null;
}

/** Obrázky vlastních odznaků leží ve veřejném úložišti Kine (bucket thumbnails, složka badges/). */
export const BADGE_IMAGE_BUCKET = 'thumbnails';
export const BADGE_IMAGE_FOLDER = 'badges';

/** Začátek veřejné adresy obrázků odznaků - jiné adresy se k odznaku nepřijmou. */
export function badgeImageBase(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  return `${url.replace(/\/+$/, '')}/storage/v1/object/public/${BADGE_IMAGE_BUCKET}/${BADGE_IMAGE_FOLDER}/`;
}

/** Cesta souboru v úložišti z veřejné adresy (jen obrázky odznaků); null = cizí adresa. */
export function badgeImagePath(url: string | null | undefined): string | null {
  const base = badgeImageBase();
  if (!url || !base || !url.startsWith(base)) return null;
  const name = url.slice(base.length);
  return /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/i.test(name) ? `${BADGE_IMAGE_FOLDER}/${name}` : null;
}
