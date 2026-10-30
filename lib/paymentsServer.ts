import { supabaseServer } from './supabaseServer';
import { keyMode } from './stripeSetup';

/**
 * Testovací klíč Stripe (sk_test_…) na ostrém webu: zaplatit (testovací
 * kartou 4242 4242 4242 4242) smí jen správce. Jinak by si kdokoliv, kdo
 * testovací kartu zná, „koupil“ Kine Plus nebo odznak podporovatele zadarmo.
 * S ostrým klíčem (sk_live_…) bez omezení. Jen pro server.
 */
export function stripeTestMode(): boolean {
  return keyMode(process.env.STRIPE_SECRET_KEY) === 'test';
}

export async function paymentAllowedNow(userId: string | null | undefined): Promise<boolean> {
  if (!stripeTestMode()) return true;
  if (!userId) return false;
  const { data } = await supabaseServer.from('profiles').select('is_admin').eq('id', userId).maybeSingle();
  return (data as { is_admin?: boolean | null } | null)?.is_admin === true;
}

/** Odpověď platebních cest, dokud se platby zkouší (testovací klíč) a neplatí správce. */
export const TEST_MODE_OFF = { error: 'Platby na Kine právě zkoušíme - za chvíli to půjde.', comingSoon: true, code: 'test-mode' } as const;

/**
 * Chyba pro prohlížeč: zpráva Stripe / databáze bez id účtů, zákazníků a klíčů
 * (acct_…, cus_…, sk_…), zkrácená. Celá zpráva jde jen do logu serveru (Vercel).
 */
export function publicError(e: unknown, fallback: string, where = 'Kine'): string {
  const raw = String((e as { message?: unknown } | null)?.message ?? '').trim();
  if (!raw) return fallback;
  console.error(`${where}:`, raw);
  return raw
    .replace(/\b(acct|cus|sub|pi|ch|price|prod|cs_live|cs_test|whsec|sk_live|sk_test|rk_live|rk_test)_[A-Za-z0-9]+/g, '$1_…')
    .slice(0, 220);
}

/**
 * Jednoduchá brzda na adresu (v paměti instance serveru): kolik pokusů za okno.
 * Proti zkoušení kradených karet přes anonymní dary - víc instancí ji obejde
 * jen částečně, hlavní ochranu má Stripe (Radar); tohle ubere nejhrubší nápor.
 */
const recentAttempts = new Map<string, number[]>();
export function allowAttempt(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const list = (recentAttempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    recentAttempts.set(key, list);
    return false;
  }
  list.push(now);
  recentAttempts.set(key, list);
  // Paměť nesmí růst donekonečna.
  if (recentAttempts.size > 5000) {
    for (const [k, v] of recentAttempts) if (!v.some((t) => now - t < windowMs)) recentAttempts.delete(k);
  }
  return true;
}

