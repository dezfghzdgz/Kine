/**
 * Placení na Kine se zapíná po krocích (Vercel -> Settings -> Environment
 * Variables, pak Redeploy):
 *
 *   NEXT_PUBLIC_PAYMENTS = 1           Kine Plus / Klipy Plus a "Podpořit Kine".
 *                                      Kine prodává samo za sebe - jednoduché.
 *   NEXT_PUBLIC_CREATOR_PAYMENTS = 1   Navíc peníze pro tvůrce: předplatné kanálu
 *                                      a podpory ve vysílání (Stripe Connect -
 *                                      peníze jdou tvůrcům, Kine si nechá
 *                                      poplatek). Až po zapnutí Connect ve Stripe
 *                                      a poradě s účetní; bez PAYMENTS nic.
 *
 * Kde se ještě neplatí, je "Připravujeme" a platební cesty na serveru odpoví
 * 503 (nic se nezaplatí ani omylem). Kód zůstal celý - jen se zapne.
 */
export const PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS === '1';

/** Peníze pro tvůrce (předplatné kanálu, podpory ve vysílání, výplaty) - až s vlastním přepínačem. */
export const CREATOR_PAYMENTS_ENABLED = PAYMENTS_ENABLED && process.env.NEXT_PUBLIC_CREATOR_PAYMENTS === '1';

/** Odpověď platebních cest, dokud placení neběží. */
export const PAYMENTS_OFF = { error: 'Platby na Kine připravujeme - brzy to půjde.', comingSoon: true } as const;

/** Odpověď cest pro tvůrce (předplatné kanálu, podpory), dokud neběží výplaty tvůrcům. */
export const CREATOR_PAYMENTS_OFF = { error: 'Předplatné kanálů a podpory tvůrcům připravujeme - brzy to půjde.', comingSoon: true } as const;
