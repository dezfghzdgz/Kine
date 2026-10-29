import { NextRequest, NextResponse } from 'next/server';
import { PAYMENTS_ENABLED, PAYMENTS_OFF } from '@/lib/payments';
import { stripeServer } from '@/lib/stripeServer';
import { siteUrlFrom } from '@/lib/siteUrl';
import { userFromRequest } from '@/lib/apiUser';
import { paymentAllowedNow, TEST_MODE_OFF } from '@/lib/paymentsServer';

// Vytvoří appce jednorázovou platební relaci na podporu appky Kine (ne
// appky konkrétního tvůrce - to appka řešit později v rámci většího
// systému předplatných).
export async function POST(req: NextRequest) {
  // Placení zatím neběží (lib/payments.ts) - nic se nezaplatí ani omylem.
  if (!PAYMENTS_ENABLED) return NextResponse.json(PAYMENTS_OFF, { status: 503 });
  try {
    const { amountEur, amountCzk } = await req.json();

    // Komu se dar připíše (odznak podporovatele), určuje přihlášení - ne
    // pole v požadavku. Dřív šlo poslat cizí userId a přidělit odznak
    // i zápis daru libovolnému účtu. Bez přihlášení je dar anonymní.
    const user = await userFromRequest(req);
    const userId = user?.id ?? null;
    // Testovací klíč Stripe: zkouší jen správce (lib/paymentsServer.ts).
    if (!(await paymentAllowedNow(userId))) return NextResponse.json(TEST_MODE_OFF, { status: 503 });

    // Dřív se pole jmenovalo amountCzk, ale účtovalo se v eurech - kdo
    // napsal "200" v domnění, že jde o koruny, zaplatil 200 EUR. Starý název
    // se tu přijímá dál, aby po nasazení neselhala rozdělaná platba.
    const amount = Math.round(Number(amountEur ?? amountCzk) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 1 || amount > 2000) {
      return NextResponse.json({ error: 'Neplatná částka.' }, { status: 400 });
    }

    const siteUrl = siteUrlFrom(req);

    const sessionParams: any = {
      mode: 'payment',
      metadata: userId ? { userId } : undefined,
      // Nová funkce Stripe "Managed Payments" u jednorázového daru
      // vyžaduje daňový kód produktu, který se sem nehodí - pro tenhle
      // konkrétní požadavek ji proto vypínáme.
      managed_payments: { enabled: false },
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Podpora appky Kine',
              description: 'Jednorázový dobrovolný příspěvek na vývoj appky Kine.',
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/donate/thank-you`,
      cancel_url: `${siteUrl}/donate`,
    };

    const session = await stripeServer.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Něco se pokazilo.' }, { status: 500 });
  }
}
