import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';

// Vytvoří appce jednorázovou platební relaci na podporu appky Kine (ne
// appky konkrétního tvůrce - to appka řešit později v rámci většího
// systému předplatných).
export async function POST(req: NextRequest) {
  try {
    const { amountCzk, userId } = await req.json();

    const amount = Number(amountCzk);
    if (!amount || amount < 1 || amount > 2000) {
      return NextResponse.json({ error: 'Neplatná částka.' }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

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
