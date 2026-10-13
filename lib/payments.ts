/**
 * Placení na Kine (Kine Plus, podpora Kine, předplatné kanálů, podpory ve
 * vysílání, výplaty tvůrcům) zatím neběží - živnost se teprve zakládá. Kde by
 * se platilo, je "Připravujeme" a platební cesty na serveru odpoví 503 (nic
 * se nezaplatí ani omylem).
 *
 * ZAPNUTÍ: Vercel -> Settings -> Environment Variables:
 *   NEXT_PUBLIC_PAYMENTS = 1   (a Redeploy)
 * Pak se všechno vrátí tak, jak to bylo - kód zůstal.
 */
export const PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS === '1';

/** Odpověď platebních cest, dokud placení neběží. */
export const PAYMENTS_OFF = { error: 'Platby na Kine připravujeme - brzy to půjde.', comingSoon: true } as const;
