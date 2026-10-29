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
