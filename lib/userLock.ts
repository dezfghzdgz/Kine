import { supabaseServer } from './supabaseServer';

/**
 * Zámek na jednoho uživatele (tabulka kine_user_locks z migrace
 * supabase-migration-statistiky-prispevky-zamky.sql, část A).
 *
 * Proč: limity nahrávání (počet za den, rozpracovaná nahrávání, úložiště)
 * a klipů se kontrolují "spočítej -> povol -> založ u Cloudflare". Když
 * někdo pošle 20 požadavků naráz, všechny by spočítaly stejný stav, všechny
 * prošly a u Cloudflare by vzniklo 20 nahrávání (= peníze). Se zámkem jdou
 * požadavky jednoho uživatele za sebou - druhý počká, až první zapíše lístek,
 * a teprve pak počítá.
 *
 * Zámek = řádek s primárním klíčem: vložení uspěje jen jednomu. Kdo nedostane
 * zámek, chvíli čeká a zkouší znovu (nejvýš `waitMs`). Zámek starší než minuta
 * (spadlá funkce) se převezme. Uvolňuje se jen vlastní zámek (podle času
 * založení), takže převzatý zámek nikdo omylem nesmaže.
 *
 * Bez migrace (tabulka chybí) se jede bez zámku jako dřív - nic se nerozbije.
 */

const STALE_MS = 60 * 1000;
const RETRY_MIN_MS = 150;
const RETRY_MAX_MS = 400;

export type UserLockResult<T> = { ok: true; value: T; locked: boolean } | { ok: false; busy: true };

type Attempt = { state: 'ok'; lockedAt: string } | { state: 'busy' } | { state: 'unavailable' };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chybí tabulka (migrace neproběhla)? Pak se jede bez zámku. */
export function lockTableMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /kine_user_locks|schema cache|does not exist/i.test(error.message ?? '');
}

/** Klíč zámku: krátký, jen bezpečné znaky (tabulka bere nejvýš 120 znaků). */
export function lockKey(scope: string, userId: string): string {
  return `${scope}:${userId}`.replace(/[^\w:.-]/g, '').slice(0, 120);
}

async function tryAcquire(key: string): Promise<Attempt> {
  const first = await supabaseServer.from('kine_user_locks').insert({ key }).select('locked_at').maybeSingle();
  if (!first.error && first.data) return { state: 'ok', lockedAt: String((first.data as { locked_at: string }).locked_at) };
  if (lockTableMissing(first.error)) return { state: 'unavailable' };
  if (first.error?.code !== '23505') {
    // Jiná chyba databáze: nahrávání kvůli zámku neblokujeme (limity dál hlídá kontrola za ním).
    console.warn('Kine: zámek se nepodařilo založit -', first.error?.message);
    return { state: 'unavailable' };
  }
  // Zámek drží někdo jiný. Je starý (spadlá funkce)? Pak ho převezmeme.
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const stale = await supabaseServer.from('kine_user_locks').delete().eq('key', key).lt('locked_at', cutoff).select('key');
  if (!stale.error && Array.isArray(stale.data) && stale.data.length > 0) {
    const again = await supabaseServer.from('kine_user_locks').insert({ key }).select('locked_at').maybeSingle();
    if (!again.error && again.data) return { state: 'ok', lockedAt: String((again.data as { locked_at: string }).locked_at) };
  }
  return { state: 'busy' };
}

async function release(key: string, lockedAt: string) {
  const { error } = await supabaseServer.from('kine_user_locks').delete().eq('key', key).eq('locked_at', lockedAt);
  if (error) console.warn('Kine: zámek se nepodařilo uvolnit (sám vyprší za minutu) -', error.message);
}

/**
 * Spustí `fn` pod zámkem `key`. Když zámek do `waitMs` nedostane, vrátí
 * { ok: false, busy: true } a `fn` vůbec nespustí.
 */
export async function withUserLock<T>(key: string, fn: () => Promise<T>, opts: { waitMs?: number } = {}): Promise<UserLockResult<T>> {
  const deadline = Date.now() + Math.max(0, opts.waitMs ?? 6000);
  let lockedAt: string | null = null;
  for (;;) {
    const attempt = await tryAcquire(key);
    if (attempt.state === 'ok') {
      lockedAt = attempt.lockedAt;
      break;
    }
    if (attempt.state === 'unavailable') break;
    if (Date.now() >= deadline) return { ok: false, busy: true };
    await sleep(RETRY_MIN_MS + Math.random() * (RETRY_MAX_MS - RETRY_MIN_MS));
  }
  try {
    return { ok: true, value: await fn(), locked: lockedAt !== null };
  } finally {
    if (lockedAt) await release(key, lockedAt);
  }
}
