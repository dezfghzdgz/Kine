/**
 * Rozdělení výdělků mezi tvůrce a Kine.
 *
 * Nováček startuje na 25 % a po dosažení cíle se posouvá na 55 %. Nad rámec
 * toho může moderátor nastavit vlastní procento - nahoru pro speciální
 * partnery, dolů jako sankci.
 *
 * Čísla jsou schválně na jednom místě, ať se dají měnit bez hledání po
 * celé appce.
 */

export type PartnerStatus = 'standard' | 'partner' | 'sanctioned';

export type RevenueTier = { minSubscribers: number; creatorPercent: number };

/**
 * Podíl tvůrce v procentech na jednotlivých stupních.
 * Stupně musí být seřazené od nejnižšího počtu odběratelů.
 */
export const REVENUE_TIERS: RevenueTier[] = [
  { minSubscribers: 0, creatorPercent: 25 },
  { minSubscribers: 1000, creatorPercent: 55 },
];

export const DEFAULT_CREATOR_PERCENT = REVENUE_TIERS[0].creatorPercent;

export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  standard: 'Běžný tvůrce',
  partner: 'Speciální partner',
  sanctioned: 'Snížený podíl (sankce)',
};

/** Podíl, na který má tvůrce nárok jen podle počtu odběratelů. */
export function tierPercentFor(subscriberCount: number): number {
  let percent = DEFAULT_CREATOR_PERCENT;
  for (const tier of REVENUE_TIERS) {
    if (subscriberCount >= tier.minSubscribers) percent = tier.creatorPercent;
  }
  return percent;
}

/** Nejbližší vyšší stupeň, kterého tvůrce ještě nedosáhl. */
export function nextTierFor(subscriberCount: number) {
  return REVENUE_TIERS.find((tier) => subscriberCount < tier.minSubscribers) ?? null;
}

/**
 * Kolik procent tvůrci opravdu náleží.
 *
 * Buď - anebo, žádné míchání:
 *  - dokud do podílu nikdo nesáhl (manual = false), řídí se sám podle
 *    počtu odběratelů, takže povýšení nemusí nikdo hlídat ručně;
 *  - jakmile ho moderátor jednou nastaví (manual = true), platí přesně to
 *    jeho číslo - i když je nižší, protože přesně tak vypadá sankce.
 *
 * Dřív se tu bralo maximum z obou, takže snížený podíl se tiše zahodil
 * a v appce svítila jiná čísla, než jaká moderátor uložil.
 */
export function effectiveCreatorPercent(
  storedPercent: number | null | undefined,
  isManual: boolean | null | undefined,
  subscriberCount: number
): number {
  if (isManual) return storedPercent ?? DEFAULT_CREATOR_PERCENT;
  return tierPercentFor(subscriberCount);
}
