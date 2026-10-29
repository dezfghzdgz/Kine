/**
 * Texty na platební stránce Stripe u Kine Plus (app/api/plus/checkout) -
 * česky pro češtinu a slovenštinu, jinak anglicky. Čistá logika
 * (tests/plusCheckout.test.mjs).
 *
 *  - consent: u zaškrtávátka (Stripe ho ukáže jen s adresou podmínek
 *    v nastavení): souhlas s podmínkami a začátek hned - spotřebitel pak při
 *    odstoupení do 14 dnů zaplatí poměrnou část (občanský zákoník § 1834).
 *  - consentPlain: totéž bez odkazu (text u tlačítka, když zaškrtávátko nejde).
 *  - renewal: obnovuje se každý měsíc, jak zrušit.
 */
export type CheckoutTexts = { locale: 'cs' | 'sk' | 'en' | 'auto'; consent: string; consentPlain: string; renewal: string };

export function checkoutTexts(lang: unknown, siteUrl: string): CheckoutTexts {
  const l = typeof lang === 'string' ? lang.toLowerCase().slice(0, 2) : '';
  const terms = `${siteUrl.replace(/\/+$/, '')}/terms`;
  // Bez odkazu (text u tlačítka): adresa bez https://, ať je vidět, kam jít.
  const termsShort = terms.replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (l === 'cs' || l === 'sk') {
    return {
      locale: l === 'sk' ? 'sk' : 'cs',
      consent: `Souhlasím s [podmínkami Kine](${terms}) a chci, aby předplatné začalo hned. Beru na vědomí, že když do 14 dnů odstoupím, vrátí se mi platba snížená o poměrnou část za dny, kdy předplatné běželo.`,
      consentPlain: `Zaplacením souhlasíš s podmínkami Kine (${termsShort}) a s tím, že předplatné začne hned; při odstoupení do 14 dnů se ti vrátí platba snížená o poměrnou část.`,
      renewal: 'Předplatné se obnovuje každý měsíc. Zrušit ho můžeš kdykoliv v Kine → Kine Plus → Spravovat předplatné; platí do konce zaplaceného období.',
    };
  }
  return {
    locale: l === 'en' ? 'en' : 'auto',
    consent: `I agree to the [Kine Terms](${terms}) and want the subscription to start right away. I understand that if I withdraw within 14 days, I get a refund reduced by the share for the days the subscription was active.`,
    consentPlain: `By paying you agree to the Kine Terms (${termsShort}) and to the subscription starting right away; if you withdraw within 14 days, you get a refund reduced by the share for the days it was active.`,
    renewal: 'Renews every month. Cancel any time in Kine → Kine Plus → Manage subscription; it stays active until the end of the paid period.',
  };
}
