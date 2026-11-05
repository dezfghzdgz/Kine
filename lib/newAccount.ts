import { hasPlus } from './plus';

/**
 * Čerstvý účet.
 *
 * Účet založený před méně než UPLOAD_NEW_ACCOUNT_HOURS hodinami (výchozí 24,
 * 0 = vypnuto), bez Kine Plus a bez role v týmu. Tam, kde každá akce stojí
 * peníze u Cloudflare (nahrávání - lib/uploadLimits.ts, živé vysílání -
 * app/api/live/me, klipy - app/api/videos/clip), má čerstvý účet přísnější
 * strop. Kdo si založí účet jen proto, aby platformu zatížil, narazí hned
 * první den; kdo si ji přišel vyzkoušet, si toho nevšimne.
 *
 * Čistá logika bez databáze (tests/newAccount.test.mjs).
 */
export type NewAccountProfile = {
  plan?: string | null;
  plan_until?: string | null;
  is_admin?: boolean | null;
  role?: string | null;
};

export function newAccountHours(env: Record<string, string | undefined> = process.env): number {
  const hours = Number(env.UPLOAD_NEW_ACCOUNT_HOURS ?? 24);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

export function isNewAccount(
  createdAt: string | null | undefined,
  profile: NewAccountProfile | null | undefined,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): boolean {
  if (profile?.is_admin || profile?.role === 'admin' || profile?.role === 'moderator') return false;
  if (hasPlus(profile?.plan, profile?.plan_until, now)) return false;
  const hours = newAccountHours(env);
  if (hours <= 0) return false;
  const created = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(created) && now - created < hours * 3600 * 1000;
}
