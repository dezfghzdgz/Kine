import { NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/linkPreview';

/**
 * Konfigurace pro appku Kine do PC (kine-desktop).
 *
 * Appka nemá nic zadrátovaného: při startu si odsud vezme adresu
 * Supabase a veřejný "anon" klíč - ten samý, který má každý návštěvník
 * webu v JavaScriptu, žádné tajemství. Díky tomu se dá appka přepnout
 * na jinou instalaci Kine (vývoj na localhostu) bez nové verze a klíče
 * jdou kdykoliv vyměnit na jednom místě.
 */
// Vždy živě - hodnoty se berou z prostředí serveru, ne z doby sestavení.
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase není nakonfigurovaná.' }, { status: 500 });
  }
  return NextResponse.json(
    {
      supabaseUrl,
      supabaseAnonKey,
      siteUrl: SITE_URL,
      // Kdyby bylo někdy potřeba staré verze appky odstavit.
      minDesktopVersion: '0.1.0',
    },
    {
      headers: { 'Access-Control-Allow-Origin': '*' },
    }
  );
}
