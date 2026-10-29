import Stripe from 'stripe';

// Tento klient se používá jen na serveru (API routes), protože obsahuje
// tajný klíč - ten se nikdy nesmí dostat do prohlížeče.
// Mezera / nový řádek na konci hodnoty z Vercelu by rozbil každé volání - pryč.
export const stripeServer = new Stripe(process.env.STRIPE_SECRET_KEY?.trim()!, {
  apiVersion: '2024-06-20',
});
