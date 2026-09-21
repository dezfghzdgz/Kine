/**
 * Kine Plus - placená verze. Jedno místo pro pravidla, ať je web i appka
 * do PC čtou stejně.
 *
 * Základ (zdarma): klipování v appce bez omezení, klipy do 60 s, nahrání
 * na Kine ručně - se stejnými pravidly jako každé video.
 * Plus: appka nahrává klipy automaticky (po hře, nikdy během ní), klipy
 * až 5 minut, odznak PLUS u jména.
 */
export type Plan = 'free' | 'plus';

export const FREE_CLIP_MAX_SECONDS = 60;
export const PLUS_CLIP_MAX_SECONDS = 300;

/** Je Plus platné právě teď? (null plan_until = bez konce) */
export function hasPlus(plan: string | null | undefined, planUntil: string | null | undefined, now = Date.now()): boolean {
  if (plan !== 'plus') return false;
  if (!planUntil) return true;
  const until = new Date(planUntil).getTime();
  return Number.isFinite(until) && until > now;
}

/** Cena, jak se ukazuje lidem - text z prostředí, ať jde měnit bez nasazení kódu. */
export function plusPriceLabel(): string | null {
  return process.env.NEXT_PUBLIC_PLUS_PRICE_LABEL || null;
}
